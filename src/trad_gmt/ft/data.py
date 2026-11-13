"""Build the fine-tuning and evaluation sets: passages of consecutive aligned sentences.

Training samples are passages of 1–5 consecutive sentences from one document, so the model
learns paragraph-level translation (how GMT copy is translated) rather than isolated lines.
Glossary entries whose target the reference actually uses are given in the prompt
(terminology-aware training), so the model learns to follow the termbase at inference.
Sources match the Claude system's memory pools: GMT editorial (WorldTempus house style and
GMT Magazine) and the domain sources for English; GMT Magazine's German edition (Swiss
German, prompted as "de-ch") and the domain sources for German. Patent claims are left out.

v2 test = the v1 test passages unchanged (comparability) + GMT Magazine issues 97–98
("magazine" pools). Training passages sharing a French sentence with the test are dropped
(GMT articles are republished on WorldTempus).
"""

import json
import logging
import random
import re
from pathlib import Path

import pandas as pd
from pydantic import BaseModel

from trad_gmt.ft.prompt import TermHint, user_prompt
from trad_gmt.io import DATA
from trad_gmt.mt.glossary import Glossary
from trad_gmt.mt.resources import ResourceConfig, load_resources, load_segments, select_pool
from trad_gmt.mt.textnorm import fold

log = logging.getLogger(__name__)

FT_DIR = DATA / "ft"


class FtDataConfig(BaseModel):
    out_dir: Path = FT_DIR / "v2"
    v1_test: Path = FT_DIR / "test.jsonl"
    max_sentences: int = 5
    max_src_words: int = 220
    max_hints: int = 10
    # prompt hints per training sample: the terms the reference uses / raw termbase hits as
    # served / none — so the model learns to apply the termbase where it fits
    hint_mix: dict[str, float] = {"oracle": 0.45, "auto": 0.45, "none": 0.10}
    upsample: dict[str, int] = {"en/style": 1, "en/domain": 1, "de/style": 4, "de/domain": 2}
    magazine_eval: dict[str, int] = {"en": 300, "de": 300}  # issues 97–98
    seed: int = 0


class Passage(BaseModel):
    id: str
    lang: str
    pool: str
    source: str
    doc_id: str
    fr: str
    ref: str
    target: str = ""  # prompt language: en | de | de-ch (GMT's Swiss German)
    hints: list[TermHint]  # glossary terms the reference uses (training, term accuracy)
    auto_hints: list[TermHint] = []  # what serving sees: top termbase target per hit
    sentences: list[str] = []  # the French sentences, for leakage checks


def swiss(text: str) -> str:
    return text.replace("ß", "ss")


def uses_term(ref: str, term: str) -> bool:
    """Whole-word (plural-tolerant) occurrence of ``term`` in ``ref``, accents folded."""
    pattern = rf"(?<!\w){re.escape(swiss(fold(term)))}(?:s|es|e|n|en)?(?!\w)"
    return re.search(pattern, swiss(fold(ref))) is not None


def _hints(gl: Glossary, fr: str, ref: str, lang: str, limit: int, ch: bool) -> list[TermHint]:
    """Glossary targets that the reference translation uses — the terms worth enforcing."""
    out: list[TermHint] = []
    for hit in gl.find(fr, lang):
        for t in hit.targets(lang):
            if uses_term(ref, t.term):
                out.append(TermHint(fr=hit.surface, tgt=swiss(t.term) if ch else t.term))
                break
        if len(out) == limit:
            break
    return out


def passages(
    seg: pd.DataFrame,
    lang: str,
    pool: str,
    gl: Glossary,
    cfg: FtDataConfig,
    rng: random.Random,
    exclude: set[str] | None = None,
) -> list[Passage]:
    """Cut each document's run of consecutive usable sentences into passages."""
    picked = select_pool(seg, lang, pool, ResourceConfig())
    if exclude:
        picked = picked[~picked.fr.map(lambda x: fold(x) in exclude)]
    ok = set(picked.index)
    ch = lang == "de" and pool == "style"  # GMT Magazine German is Swiss
    out: list[Passage] = []
    run: list[int] = []

    def flush() -> None:
        i = 0
        while i < len(run):
            n = rng.randint(1, cfg.max_sentences)
            rows = seg.loc[run[i : i + n]]
            i += n
            fr = " ".join(rows.fr)
            if len(fr.split()) > cfg.max_src_words:
                continue
            ref = " ".join(rows[lang])
            first = rows.iloc[0]
            out.append(
                Passage(
                    id=f"{lang}-{pool}-{first.id}",
                    lang=lang,
                    pool=pool,
                    target="de-ch" if ch else lang,
                    source=first.source,
                    doc_id=str(first.doc_id),
                    fr=fr,
                    ref=ref,
                    hints=_hints(gl, fr, ref, lang, cfg.max_hints, ch),
                    sentences=list(rows.fr),
                )
            )
        run.clear()

    prev_doc = None
    for idx, doc in zip(seg.index, seg.doc_id, strict=True):
        if idx not in ok or doc != prev_doc:
            flush()
        if idx in ok:
            run.append(idx)
        prev_doc = doc
    flush()
    return out


def auto_hints(
    gl: Glossary, fr: str, lang: str, limit: int = 10, ch: bool = False
) -> list[TermHint]:
    """Inference-time hints: the top-ranked termbase target of each term found, no reference."""
    hits = gl.find(fr, lang, limit)
    return [
        TermHint(fr=h.surface, tgt=(swiss if ch else str)(h.targets(lang)[0].term)) for h in hits
    ]


def _chat(p: Passage, hints: list[TermHint] | None) -> dict[str, object]:
    return {
        "id": p.id,
        "messages": [
            {"role": "user", "content": user_prompt(p.fr, p.target or p.lang, hints)},
            {"role": "assistant", "content": p.ref},
        ],
    }


def _sample_hints(
    p: Passage, gl: Glossary, cfg: FtDataConfig, rng: random.Random
) -> list[TermHint] | None:
    mode = rng.choices(list(cfg.hint_mix), weights=list(cfg.hint_mix.values()))[0]
    if mode == "oracle":
        return p.hints or None
    if mode == "auto":
        return auto_hints(gl, p.fr, p.lang, cfg.max_hints, p.target == "de-ch") or None
    return None


def _test_set(gl: Glossary, cfg: FtDataConfig, rng: random.Random) -> list[Passage]:
    """v1 test passages unchanged, plus GMT Magazine issues 97–98 (validation + test splits)."""
    evals = [Passage.model_validate_json(line) for line in cfg.v1_test.open()]
    for split in ("validation", "test"):
        seg = load_segments(ResourceConfig(), split=split)
        seg = seg[seg.source == "gmt"]
        for lang in ("en", "de"):
            ps = [p for p in passages(seg, lang, "style", gl, cfg, rng) if len(p.fr.split()) >= 25]
            for p in ps:
                p.id, p.pool = p.id.replace("-style-", "-magazine-"), "magazine"
            evals.extend(ps)
    mag = [p for p in evals if p.pool == "magazine"]
    keep: list[Passage] = []
    for lang, n in cfg.magazine_eval.items():
        cand = [p for p in mag if p.lang == lang]
        keep.extend(rng.sample(cand, min(n, len(cand))))
    for p in keep:
        p.auto_hints = auto_hints(gl, p.fr, p.lang, cfg.max_hints, p.target == "de-ch")
    return [p for p in evals if p.pool != "magazine"] + keep


def build(cfg: FtDataConfig | None = None) -> dict[str, int]:
    cfg = cfg or FtDataConfig()
    rng = random.Random(cfg.seed)
    gl = load_resources().glossary
    cfg.out_dir.mkdir(parents=True, exist_ok=True)
    evals = _test_set(gl, cfg, rng)
    counts: dict[str, int] = {}
    for p in evals:
        counts[f"test:{p.lang}/{p.pool}"] = counts.get(f"test:{p.lang}/{p.pool}", 0) + 1
    # every French sentence of the test passages, also as WorldTempus republishes them
    held = {fold(x) for p in evals for x in (p.sentences or re.split(r"(?<=[.!?…])\s+", p.fr))}
    seg = load_segments(ResourceConfig(), split="train")
    train: list[dict[str, object]] = []
    for key, times in cfg.upsample.items():
        lang, pool = key.split("/")
        ps = passages(seg, lang, pool, gl, cfg, rng, exclude=held)
        counts[f"train:{key}"] = len(ps)
        for _ in range(times):
            train.extend(_chat(p, _sample_hints(p, gl, cfg, rng)) for p in ps)
    rng.shuffle(train)
    with (cfg.out_dir / "test.jsonl").open("w") as fh:
        fh.writelines(p.model_dump_json(exclude={"sentences"}) + "\n" for p in evals)
    with (cfg.out_dir / "train.jsonl").open("w") as fh:
        fh.writelines(json.dumps(r, ensure_ascii=False) + "\n" for r in train)
    counts["train"], counts["test"] = len(train), len(evals)
    log.info("ft data → %s %s", cfg.out_dir, counts)
    return counts
