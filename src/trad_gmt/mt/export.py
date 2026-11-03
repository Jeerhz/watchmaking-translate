"""Export a compact glossary + memory bundle and the prompts for the browser demo (web/)."""

import json
import logging
from pathlib import Path

import pandas as pd
from pydantic import BaseModel

from trad_gmt.io import ROOT
from trad_gmt.mt import prompts
from trad_gmt.mt.resources import (
    PER_SENTENCE,
    TARGETS,
    ResourceConfig,
    Resources,
    load_segments,
    select_pool,
)
from trad_gmt.mt.style import SWISS_DE, style_guide
from trad_gmt.mt.textnorm import FR_STOPWORDS

log = logging.getLogger(__name__)

WEB_DIR = ROOT / "web"


class ExportConfig(BaseModel):
    out: Path = WEB_DIR / "bundle.json"
    # sentences per pool in the browser (BM25 runs client-side)
    sizes: dict[str, int] = {"en/style": 16_000, "en/domain": 6_000, "de/domain": 14_000}
    min_score: float = 0.85
    seed: int = 0


def _sample(df: pd.DataFrame, n: int, seed: int) -> pd.DataFrame:
    """Prefer GMT Magazine rows, then a random sample of the rest."""
    gmt = df[df.tags.map(lambda t: "folder:GMT Magazine" in list(t))]
    rest = df.drop(gmt.index)
    take_gmt = gmt.sample(min(len(gmt), n // 3), random_state=seed)
    take_rest = rest.sample(min(len(rest), n - len(take_gmt)), random_state=seed)
    return pd.concat([take_gmt, take_rest])


def export_web(res: Resources, cfg: ExportConfig | None = None) -> Path:
    cfg = cfg or ExportConfig()
    seg = load_segments(ResourceConfig())
    pool_cfg = ResourceConfig(min_score=cfg.min_score, max_chars=350)
    memory: dict[str, dict[str, list[list[str]]]] = {}
    for lang in TARGETS:
        memory[lang] = {}
        for pool in PER_SENTENCE[lang]:
            df = _sample(
                select_pool(seg, lang, pool, pool_cfg), cfg.sizes[f"{lang}/{pool}"], cfg.seed
            )
            memory[lang][pool] = [
                [fr, tgt, src] for fr, tgt, src in zip(df.fr, df[lang], df.source, strict=True)
            ]
            log.info("web memory %s/%s: %d", lang, pool, len(df))

    glossary = [
        {
            "fr": e.fr,
            "key": list(e.key),
            **{
                lang: [[t.term, t.source, t.priority, t.definition] for t in getattr(e, lang)]
                for lang in TARGETS
            },
        }
        for e in res.glossary.entries.values()
    ]
    bundle = {
        "prompts": {
            "translate_system": prompts.TRANSLATE_SYSTEM,
            "translate_user": prompts.TRANSLATE_USER,
            "review_system": prompts.REVIEW_SYSTEM,
            "review_user": prompts.REVIEW_USER,
        },
        "style": {lang: style_guide(lang) for lang in TARGETS},
        "swiss_de": SWISS_DE,
        "per_sentence": PER_SENTENCE,
        "stopwords": sorted(FR_STOPWORDS),
        "glossary": glossary,
        "memory": memory,
    }
    cfg.out.parent.mkdir(parents=True, exist_ok=True)
    cfg.out.write_text(
        json.dumps(bundle, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    log.info("bundle → %s (%.1f MB)", cfg.out, cfg.out.stat().st_size / 1e6)
    return cfg.out
