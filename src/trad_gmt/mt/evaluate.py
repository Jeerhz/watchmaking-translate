"""Evaluate on held-out documents: chrF against the published translation + term adherence.

Documents come from the ``test`` split (split by document, so neither the article nor its
sentences are in the memory, which is built from ``train``). For English the default is
GMT's own editorial articles — the score then measures closeness to the house translation.
"""

import json
import logging
from pathlib import Path

import pandas as pd
from pydantic import BaseModel
from sacrebleu.metrics import CHRF

from trad_gmt.mt.resources import ResourceConfig, is_house_style, load_segments
from trad_gmt.mt.translator import Translator

log = logging.getLogger(__name__)


class EvalConfig(BaseModel):
    target: str = "en"
    n_docs: int = 10
    min_sentences: int = 6
    max_sentences: int = 30
    seed: int = 0
    out: Path | None = None


def pick_documents(cfg: EvalConfig) -> list[tuple[str, list[str], list[str]]]:
    seg = load_segments(ResourceConfig(), split="test")
    lang = cfg.target
    seg = seg[seg[lang].notna()]
    if lang == "en":
        seg = seg[(seg.source == "worldtempus") & seg.tags.map(lambda t: is_house_style(list(t)))]
    else:
        seg = seg[seg.source.isin(["brands", "rolex"])]
    sizes = seg.groupby("doc_id").size()
    docs = sizes[(sizes >= cfg.min_sentences)].index.to_series()
    docs = docs.sample(min(cfg.n_docs, len(docs)), random_state=cfg.seed)
    out = []
    for doc_id in docs:
        rows = seg[seg.doc_id == doc_id].head(cfg.max_sentences)
        out.append((doc_id, rows.fr.tolist(), rows[lang].tolist()))
    return out


def term_adherence(translator: Translator, source: str, output: str, lang: str) -> float | None:
    """Share of glossary hits whose approved equivalent (any candidate) appears in the output."""
    hits = translator.res.glossary.find(source, lang)
    multiword = [h for h in hits if len(h.entry.key) > 1]
    if not multiword:
        return None
    low = output.casefold()
    ok = sum(any(t.term.casefold() in low for t in h.targets(lang)) for h in multiword)
    return ok / len(multiword)


def evaluate(translator: Translator, cfg: EvalConfig) -> dict:
    chrf = CHRF()
    rows = []
    for doc_id, fr, ref in pick_documents(cfg):
        source = "\n".join(fr)
        result = translator.translate(source, cfg.target)
        hyp = result.translation
        rows.append(
            {
                "doc_id": doc_id,
                "chrf": chrf.sentence_score(hyp, ["\n".join(ref)]).score,
                "chrf_draft": chrf.sentence_score(
                    "\n\n".join(c.draft for c in result.chunks), ["\n".join(ref)]
                ).score,
                "terms": term_adherence(translator, source, hyp, cfg.target),
                "n_changes": sum(len(c.changes) for c in result.chunks),
                "source": source,
                "reference": "\n".join(ref),
                "translation": hyp,
            }
        )
        log.info("%s chrF %.1f (draft %.1f)", doc_id, rows[-1]["chrf"], rows[-1]["chrf_draft"])
    df = pd.DataFrame(rows)
    summary = {
        "target": cfg.target,
        "docs": len(df),
        "chrf": round(df.chrf.mean(), 2),
        "chrf_draft": round(df.chrf_draft.mean(), 2),
        "term_adherence": round(df.terms.dropna().mean(), 3) if df.terms.notna().any() else None,
    }
    if cfg.out:
        cfg.out.parent.mkdir(parents=True, exist_ok=True)
        cfg.out.write_text(
            json.dumps({"summary": summary, "docs": rows}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    return summary
