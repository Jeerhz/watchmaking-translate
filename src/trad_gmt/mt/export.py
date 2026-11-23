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
    DOMAIN_SOURCES,
    PER_SENTENCE,
    TARGETS,
    ResourceConfig,
    Resources,
    load_segments,
    select_pool,
)
from trad_gmt.mt.style import GERMANY_DE, HOUSE_TERMS, STYLE_DE, SWISS_DE, style_guide
from trad_gmt.mt.textnorm import (
    EN_STOPWORDS,
    FR_STOPWORDS,
    generic_english,
    tokens,
    tokens_en,
)
from trad_gmt.text import guess_lang

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
    sizes: dict[str, int] = {
        "en/style": 16_000,
        "en/domain": 6_000,
        "de/style": 5_000,
        "de/domain": 14_000,
    }
    min_score: float = 0.85
    max_chars: int = 350
    provenance: bool = False
    seed: int = 0


APP_EXPORT = ExportConfig(
    out=APP_DATA / "bundle.json.gz",
    sizes={"en/style": 90_000, "en/domain": 30_000, "de/style": 5_000, "de/domain": 30_000},
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


def magazine_samples(n: int = 40, seed: int = 0) -> list[dict[str, str]]:
    """Held-out GMT Magazine passages (issues 97–98, never in the memory pools) with GMT's own
    English and German, for blind human comparison of the systems in the desk."""
    import random

    out: list[dict[str, str]] = []
    for split in ("validation", "test"):
        seg = load_segments(ResourceConfig(), split=split)
        seg = seg[seg.source == "gmt"]
        for doc, d in seg.groupby("doc_id", sort=False):
            run: list[tuple[str, str, str]] = []
            for fr, en, de in [*zip(d.fr, d.en, d.de, strict=True), (None, None, None)]:
                if isinstance(fr, str) and isinstance(en, str) and isinstance(de, str):
                    run.append((fr, en, de))
                    if len(run) < 6:
                        continue
                words = sum(len(x[0].split()) for x in run)
                if len(run) >= 3 and 50 <= words <= 220:
                    _, issue, page = str(doc).split(":")
                    out.append(
                        {
                            "id": f"{doc}:{len(out)}",
                            "title": f"GMT Magazine {issue} · {page}",
                            "fr": " ".join(x[0] for x in run),
                            "en": " ".join(x[1] for x in run),
                            "de": " ".join(x[2] for x in run),
                        }
                    )
                run = []
    random.Random(seed).shuffle(out)
    return out[:n]


def english_german_memory(seg: pd.DataFrame, cfg: ExportConfig) -> dict[str, list[list[str]]]:
    """English → German example pairs, for texts whose source is English.

    The dataset is aligned on the French side, so an English–German pair is a row whose French
    sentence has both translations. English → French needs no extra rows: the app reads the
    French → English pools the other way round.
    """
    ok = seg.en.notna() & seg.de.notna()
    for lang in ("en", "de"):
        score = seg[f"score_{lang}"]
        ok &= score.isna() | (score >= cfg.min_score)
    ok &= seg.en.fillna("").str.len().between(25, cfg.max_chars)
    df = seg[ok]
    df = df[df.en.map(lambda t: guess_lang(t) in (None, "en"))]
    df = df[df.de.map(lambda t: guess_lang(t) in (None, "de"))]
    # the magazine PDFs leave control characters in a few rows
    clean = lambda t: not any(ord(ch) < 32 or 127 <= ord(ch) < 160 for ch in t)  # noqa: E731
    df = df[df.en.map(clean) & df.de.map(clean)]
    pools = {"style": df[df.source == "gmt"], "domain": df[df.source.isin(DOMAIN_SOURCES["de"])]}
    out: dict[str, list[list[str]]] = {}
    for pool, d in pools.items():
        d = d.drop_duplicates("en")
        d = d.sample(min(len(d), cfg.sizes[f"de/{pool}"]), random_state=cfg.seed)
        out[pool] = [
            [en, de, src, provenance_label(src, doc, list(tags)), url or ""]
            for en, de, src, doc, tags, url in zip(
                d.en, d.de, d.source, d.doc_id, d.tags, d.url.fillna(""), strict=True
            )
        ]
        log.info("web memory en→de/%s: %d", pool, len(out[pool]))
    return out


def english_glossary(
    glossary: list[dict],
    french: pd.DataFrame,
    german: pd.DataFrame,
    generic: frozenset[str],
    min_seen: int = 20,
    min_share: float = 0.02,
    max_len: int = 6,
) -> list[dict]:
    """The termbase read from its English side, for texts whose source is English.

    Every English equivalent becomes a key; its French equivalent is the entry it came from and
    its German equivalents are that entry's. A dictionary read backwards gives wrong pairs
    ("going train" → "mobiles compteurs"; "gong" → "Klangfarbe" through the French homonym
    "timbre"), so each pair is checked against published sentence pairs: among the sentences
    whose English has the term, the share that have the equivalent. ``french`` (columns en, fr)
    is GMT's own English–French; ``german`` (columns en, de) is every English–German pair.

    For a term seen in at least ``min_seen`` sentences, an equivalent found in under
    ``min_share`` of them is dropped (GMT house rules are kept), and the key is dropped when no
    French equivalent is left. Rarer terms keep the dictionary's word. Equivalents are ranked
    GMT house rules first, then by how often they are attested. One-word keys that are
    everyday English are skipped unless a GMT house rule covers them (as
    ``generic_words_from`` does for French).
    """
    by_key: dict[tuple[str, ...], dict] = {}
    for e in glossary:
        if e["fr"].lower() in FR_STOPWORDS:
            continue
        for term, source, priority, definition in e["en"]:
            key = tuple(tokens_en(term))
            if not key or len(key) > max_len:
                continue
            everyday = key[0] in EN_STOPWORDS or key[0] in generic or len(key[0]) < 3
            if len(key) == 1 and priority > 0 and everyday:
                continue
            inv = by_key.setdefault(key, {"en": term, "key": list(key), "cands": {}})
            inv["cands"].setdefault(
                tuple(e["key"]), {"row": [e["fr"], source, priority, definition], "de": e["de"]}
            )

    def grams(toks: list[str]) -> set[tuple[str, ...]]:
        return {
            tuple(toks[i : i + n]) for n in range(1, max_len + 1) for i in range(len(toks) - n + 1)
        }

    # English → French, on GMT's own pairs
    seen: dict[tuple[str, ...], int] = dict.fromkeys(by_key, 0)
    both: dict[tuple, int] = {}
    for en, fr in zip(french.en, french.fr, strict=True):
        found = [k for k in grams(tokens_en(en)) if k in by_key]
        if not found:
            continue
        fr_grams = grams(tokens(fr))
        for k in found:
            seen[k] += 1
            for fk in by_key[k]["cands"]:
                if fk in fr_grams:
                    both[k, fk] = both.get((k, fk), 0) + 1

    # English → German: a substring test, so compounds and inflected forms count
    seen_de: dict[tuple[str, ...], int] = dict.fromkeys(by_key, 0)
    both_de: dict[tuple, int] = {}
    swiss = lambda t: t.lower().replace("ß", "ss")  # noqa: E731
    for en, de in zip(german.en, german.de, strict=True):
        found = [k for k in grams(tokens_en(en)) if k in by_key]
        if not found:
            continue
        low = swiss(de)
        for k in found:
            seen_de[k] += 1
            for c in by_key[k]["cands"].values():
                for row in c["de"]:
                    if swiss(row[0]) in low:
                        both_de[k, row[0]] = both_de.get((k, row[0]), 0) + 1

    out: list[dict] = []
    dropped = 0
    for key, inv in by_key.items():
        cands = [(both.get((key, fk), 0), c) for fk, c in inv["cands"].items()]
        if seen[key] >= min_seen:
            floor = seen[key] * min_share
            cands = [(n, c) for n, c in cands if n >= floor or c["row"][2] <= 0]
        if not cands:
            dropped += 1
            continue
        cands.sort(key=lambda x: (x[1]["row"][2] > 0, -x[0], x[1]["row"][2]))
        de: dict[str, tuple[int, list]] = {}
        for _, c in cands:
            for row in c["de"]:
                de.setdefault(row[0].lower(), (both_de.get((key, row[0]), 0), row))
        rows = list(de.values())
        if seen_de[key] >= min_seen:
            floor = seen_de[key] * min_share
            rows = [(n, r) for n, r in rows if n >= floor or r[2] <= 0]
        rows.sort(key=lambda x: (x[1][2] > 0, -x[0]))  # stable: dictionary order on ties
        out.append(
            {
                "en": inv["en"],
                "key": inv["key"],
                "fr": [c["row"] for _, c in cands],
                "de": [r for _, r in rows],
            }
        )
    log.info("English-keyed termbase: %d keys (%d dropped: pair not attested)", len(out), dropped)
    return out


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
    house = seg[seg.source.isin(("worldtempus", "gmt")) & seg.en.notna()]
    generic_en = generic_english(house.en.sample(min(len(house), 200_000), random_state=0))
    bundle = {
        "prompts": {
            "translate_system": prompts.TRANSLATE_SYSTEM,
            "translate_user": prompts.TRANSLATE_USER,
            "review_system": prompts.REVIEW_SYSTEM,
            "review_user": prompts.REVIEW_USER,
            "fix_user": prompts.FIX_USER,
        },
        "schemas": {"review": prompts.REVIEW_SCHEMA, "fix": prompts.FIX_SCHEMA},
        "style": {"en": style_guide("en"), "de": STYLE_DE},
        "swiss_de": SWISS_DE,
        "germany_de": GERMANY_DE,
        "per_sentence": PER_SENTENCE,
        "stopwords": sorted(FR_STOPWORDS),
        "house_terms": list(HOUSE_TERMS),
        "glossary": glossary,
        "memory": memory,
        # English as the source: English → German pairs (English → French reuses memory["en"])
        "memory_en": {"de": english_german_memory(seg, cfg)} if cfg.provenance else {},
        "stopwords_en": sorted(EN_STOPWORDS),
        # the termbase keyed on English, checked against GMT's own sentence pairs
        "glossary_en": english_glossary(
            glossary,
            house[["en", "fr"]],
            seg.loc[seg.en.notna() & seg.de.notna() & (seg.source != "epo"), ["en", "de"]],
            generic_en,
        )
        if cfg.provenance
        else [],
        "samples": magazine_samples() if cfg.provenance else [],
    }
    cfg.out.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(bundle, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    cfg.out.write_bytes(gzip.compress(data, 9) if cfg.out.suffix == ".gz" else data)
    log.info("bundle → %s (%.1f MB)", cfg.out, cfg.out.stat().st_size / 1e6)
    return cfg.out
