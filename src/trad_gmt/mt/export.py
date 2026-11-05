"""Export a compact glossary + memory bundle and the prompts for the web front ends.

* ``web/bundle.json`` — the claude.ai artifact demo (``web/index.html``): BM25 runs in the
  viewer's browser, so the memory is a small sample.
* ``webapp/data/bundle.json.gz`` — the Vercel app (``webapp/``): retrieval runs server-side,
  so the memory is larger and every row carries its provenance (label + article URL).
"""

import gzip
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
from trad_gmt.mt.style import HOUSE_TERMS, SWISS_DE, style_guide
from trad_gmt.mt.textnorm import FR_STOPWORDS

log = logging.getLogger(__name__)

WEB_DIR = ROOT / "web"
APP_DATA = ROOT / "webapp" / "data"
BRAND_NAMES: dict[str, str] = {
    "jlc": "Jaeger-LeCoultre",
    "ap": "Audemars Piguet",
    "lange": "A. Lange & Söhne",
}
SOURCE_NAMES: dict[str, str] = {
    "worldtempus": "WorldTempus",
    "berner": "FH Berner dictionary",
    "fhh": "Fondation Haute Horlogerie",
    "patek": "Patek Philippe",
    "rolex": "Rolex",
    "brands": "Brand site",
}


class ExportConfig(BaseModel):
    out: Path = WEB_DIR / "bundle.json"
    # sentences per pool (BM25 runs client-side for the artifact demo)
    sizes: dict[str, int] = {"en/style": 16_000, "en/domain": 6_000, "de/domain": 14_000}
    min_score: float = 0.85
    max_chars: int = 350
    provenance: bool = False
    seed: int = 0


APP_EXPORT = ExportConfig(
    out=APP_DATA / "bundle.json.gz",
    sizes={"en/style": 90_000, "en/domain": 30_000, "de/domain": 30_000},
    max_chars=420,
    provenance=True,
)


def _sample(df: pd.DataFrame, n: int, seed: int) -> pd.DataFrame:
    """Prefer GMT Magazine rows, then a random sample of the rest."""
    gmt = df[df.tags.map(lambda t: "folder:GMT Magazine" in list(t))]
    rest = df.drop(gmt.index)
    take_gmt = gmt.sample(min(len(gmt), n // 3), random_state=seed)
    take_rest = rest.sample(min(len(rest), n - len(take_gmt)), random_state=seed)
    return pd.concat([take_gmt, take_rest])


def provenance_label(source: str, doc_id: str, tags: list[str]) -> str:
    """Short human label: "WorldTempus · GMT Magazine · 2024", "Jaeger-LeCoultre", …"""
    if source == "brands":
        return BRAND_NAMES.get(doc_id.split(":")[1], SOURCE_NAMES[source])
    parts = [SOURCE_NAMES.get(source, source)]
    tag = dict(t.split(":", 1) for t in tags if ":" in t)
    if source == "worldtempus":
        parts.append(tag.get("folder") or tag.get("category") or "")
        parts.append(tag.get("date", "")[-4:])
    elif source == "rolex":
        parts.append(tag.get("section", "").replace("-", " "))
    return " · ".join(p for p in parts if p)


def export_web(res: Resources, cfg: ExportConfig | None = None) -> Path:
    cfg = cfg or ExportConfig()
    extra = ("url",) if cfg.provenance else ()
    seg = load_segments(ResourceConfig(), extra=extra)
    pool_cfg = ResourceConfig(min_score=cfg.min_score, max_chars=cfg.max_chars)
    memory: dict[str, dict[str, list[list[str]]]] = {}
    for lang in TARGETS:
        memory[lang] = {}
        for pool in PER_SENTENCE[lang]:
            df = _sample(
                select_pool(seg, lang, pool, pool_cfg), cfg.sizes[f"{lang}/{pool}"], cfg.seed
            )
            if cfg.provenance:
                rows = [
                    [fr, tgt, src, provenance_label(src, doc, list(tags)), url or ""]
                    for fr, tgt, src, doc, tags, url in zip(
                        df.fr,
                        df[lang],
                        df.source,
                        df.doc_id,
                        df.tags,
                        df.url.fillna(""),
                        strict=True,
                    )
                ]
            else:
                rows = [
                    [fr, tgt, src] for fr, tgt, src in zip(df.fr, df[lang], df.source, strict=True)
                ]
            memory[lang][pool] = rows
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
            "fix_user": prompts.FIX_USER,
        },
        "schemas": {"review": prompts.REVIEW_SCHEMA, "fix": prompts.FIX_SCHEMA},
        "style": {lang: style_guide(lang) for lang in TARGETS},
        "swiss_de": SWISS_DE,
        "per_sentence": PER_SENTENCE,
        "stopwords": sorted(FR_STOPWORDS),
        "house_terms": list(HOUSE_TERMS),
        "glossary": glossary,
        "memory": memory,
    }
    cfg.out.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(bundle, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    cfg.out.write_bytes(gzip.compress(data, 9) if cfg.out.suffix == ".gz" else data)
    log.info("bundle → %s (%.1f MB)", cfg.out, cfg.out.stat().st_size / 1e6)
    return cfg.out
