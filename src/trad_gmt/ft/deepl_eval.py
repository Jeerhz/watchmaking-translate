"""Run DeepL on the fine-tuning test passages, under the configurations of docs/deepl-system.md.

  raw       EN-GB / DE-CH, quality model, nothing else
  context   + the preceding French sentences of the article (free, not translated)
  glossary  + the GMT glossary (hard terms attested in GMT's own translations)
  full      + house style (EN style rule list / DE inline rules) + soft term instructions

Outputs data/ft/v2/deepl-<config>.jsonl ({"id", "hyp"}), resumable; scored like every system.
"""

import json
import logging
import random
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from pydantic import BaseModel

from trad_gmt.ft.data import FT_DIR
from trad_gmt.mt import deepl
from trad_gmt.mt.resources import ResourceConfig, load_resources, load_segments

log = logging.getLogger(__name__)

CONFIGS = ("raw", "context", "glossary", "full")


class DeepLEvalConfig(BaseModel):
    test: Path = FT_DIR / "v2" / "test.jsonl"
    config: str = "full"
    subset: int | None = None  # per language, magazine passages only (ablations)
    context_sentences: int = 3
    threads: int = 4
    seed: int = 0


def _previous_sentences(n: int) -> dict[str, str]:
    """Segment id → the n French sentences before it in its document."""
    out: dict[str, str] = {}
    for split in ("validation", "test"):
        seg = load_segments(ResourceConfig(), split=split)
        for _, doc in seg.groupby("doc_id", sort=False):
            fr = list(doc.fr)
            for i, sid in enumerate(doc.id):
                out[sid] = " ".join(x for x in fr[max(0, i - n) : i] if isinstance(x, str))
    return out


def select(rows: list[dict], cfg: DeepLEvalConfig) -> list[dict]:
    if cfg.subset is None:
        return rows
    rng = random.Random(cfg.seed)
    out = []
    for lang in ("en", "de"):
        mag = [r for r in rows if r["lang"] == lang and r["pool"] == "magazine"]
        out += rng.sample(mag, min(cfg.subset, len(mag)))
    return out


def run(cfg: DeepLEvalConfig | None = None) -> Path:
    cfg = cfg or DeepLEvalConfig()
    assert cfg.config in CONFIGS
    out = cfg.test.parent / f"deepl-{cfg.config}.jsonl"
    rows = select([json.loads(line) for line in cfg.test.open()], cfg)
    done = {json.loads(line)["id"] for line in out.open()} if out.exists() else set()
    todo = [r for r in rows if r["id"] not in done]
    log.info("%s: %d passages to translate (%d done)", cfg.config, len(todo), len(done))
    client = deepl.DeepL()
    gl = load_resources().glossary
    setup = deepl.load_setup()
    hard = {
        lang: deepl.glossary_entries(deepl.attested_terms(gl, lang), lang) for lang in ("en", "de")
    }
    prev = _previous_sentences(cfg.context_sentences) if cfg.config != "raw" else {}

    def one(r: dict) -> dict:
        lang, kw = r["lang"], {}
        if cfg.config != "raw":
            kw["context"] = prev.get(r["id"].split("-", 2)[2]) or None
        if cfg.config in ("glossary", "full"):
            kw["glossary_id"] = setup.glossary_id
        if cfg.config == "full":
            soft = deepl.soft_instructions(gl, r["fr"], lang, hard[lang], limit=5)
            if lang == "en" and setup.style_en:
                kw["style_id"] = setup.style_en
                kw["instructions"] = soft or None
            else:
                kw["instructions"] = deepl.RULES[lang] + soft
        try:
            return {"id": r["id"], "hyp": client.translate(r["fr"], lang, **kw)}
        except RuntimeError as e:
            log.warning("%s: %s", r["id"], e)
            return {"id": r["id"], "hyp": None}

    with out.open("a") as fh, ThreadPoolExecutor(cfg.threads) as pool:
        for res in pool.map(one, todo):
            if res["hyp"]:
                fh.write(json.dumps(res, ensure_ascii=False) + "\n")
                fh.flush()
    log.info("usage %s", client.usage())
    return out


if __name__ == "__main__":
    import sys

    logging.basicConfig(level=logging.INFO)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    args = dict(a.split("=", 1) for a in sys.argv[1:])
    print(run(DeepLEvalConfig(**args)))
