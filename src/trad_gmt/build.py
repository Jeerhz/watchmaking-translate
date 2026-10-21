"""Merge every collected source into the final multiparallel dataset (Parquet)."""

import hashlib
import logging
import re
from collections import Counter
from pathlib import Path

from datasets import Dataset
from pydantic import BaseModel

from trad_gmt.io import PROCESSED, SourceOutput, available_sources
from trad_gmt.schemas import LANGS, ParallelSegment, SourceInfo, TermEntry

log = logging.getLogger(__name__)

_DIGITS = re.compile(r"\d+")

# FH Berner is the reference glossary; brand/foundation glossaries come next.
TERM_PRIORITY: dict[str, int] = {"berner": 1, "patek": 2, "fhh": 3, "wikidata": 4}


class BuildConfig(BaseModel):
    sources: list[str] | None = None
    min_chars: int = 3
    max_len_ratio: float = 2.6
    valid_pct: float = 2.0
    test_pct: float = 2.0
    out_dir: Path = PROCESSED


class BuildReport(BaseModel):
    sources: list[SourceInfo]
    n_terms: int
    n_segments: dict[str, int]
    n_pairs: dict[str, int]
    dropped: dict[str, int]
    by_source: dict[str, dict[str, int]]


def _key(*texts: str | None) -> str:
    return "\x1f".join((t or "").casefold().strip() for t in texts)


def _split_of(doc_id: str, cfg: BuildConfig) -> str:
    """Deterministic split by document so sentences of one entry never leak across splits."""
    bucket = int(hashlib.md5(doc_id.encode()).hexdigest(), 16) % 10_000 / 100
    if bucket < cfg.test_pct:
        return "test"
    if bucket < cfg.test_pct + cfg.valid_pct:
        return "validation"
    return "train"


def _reject_reason(seg: ParallelSegment, cfg: BuildConfig) -> str | None:
    texts = {lang: getattr(seg, lang) for lang in LANGS if getattr(seg, lang)}
    if "fr" not in texts or len(texts) < 2:
        return "missing_fr_or_target"
    if any(len(t) < cfg.min_chars for t in texts.values()):
        return "too_short"
    if all(t == texts["fr"] for t in texts.values()):
        return "untranslated"
    fr_len = len(texts["fr"])
    for lang, t in texts.items():
        ratio = max(fr_len, len(t)) / max(1, min(fr_len, len(t)))
        if lang != "fr" and ratio > cfg.max_len_ratio and max(fr_len, len(t)) > 30:
            return "length_ratio"
    return None


def _drop_number_mismatches(seg: ParallelSegment) -> tuple[ParallelSegment, int]:
    """Null out targets whose numbers differ from the French (added/changed facts)."""
    if seg.granularity != "sentence" or seg.alignment == "native" or not seg.fr:
        return seg, 0
    fr_digits = Counter(_DIGITS.findall(seg.fr))
    if not fr_digits:
        return seg, 0
    bad = [
        lang
        for lang in ("en", "de")
        if (t := getattr(seg, lang)) and Counter(_DIGITS.findall(t)) != fr_digits
    ]
    update: dict[str, None] = dict.fromkeys(bad)
    update.update({f"score_{lang}": None for lang in bad})
    return (seg.model_copy(update=update) if bad else seg), len(bad)


def _dedupe_terms(terms: list[TermEntry]) -> list[TermEntry]:
    seen: set[str] = set()
    out: list[TermEntry] = []
    for t in terms:
        if not t.fr or t.n_langs < 2:
            continue
        k = _key(t.source, t.fr, t.en, t.de)
        if k not in seen:
            seen.add(k)
            out.append(t)
    return out


def _write(rows: list[BaseModel], path: Path, exclude: set[str] | None = None) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    records = [r.model_dump(exclude=exclude) for r in rows]
    if records:
        Dataset.from_list(records).to_parquet(str(path))
    return len(records)


class PairRow(BaseModel):
    id: str
    source: str
    doc_id: str
    granularity: str
    src: str
    tgt: str


def build(cfg: BuildConfig) -> BuildReport:
    names = cfg.sources or available_sources()
    outputs = [SourceOutput.load(n) for n in names]
    log.info("building from %s", names)

    terms = _dedupe_terms([t for o in outputs for t in o.terms])
    terms = sorted(
        (t.model_copy(update={"priority": TERM_PRIORITY.get(t.source, 9)}) for t in terms),
        key=lambda t: (t.priority, t.id),
    )

    dropped: Counter[str] = Counter()
    seen: set[str] = set()
    splits: dict[str, list[ParallelSegment]] = {"train": [], "validation": [], "test": []}
    for seg in (s for o in outputs for s in o.segments):
        seg, n_bad = _drop_number_mismatches(seg)
        dropped["number_mismatch_target"] += n_bad
        if reason := _reject_reason(seg, cfg):
            dropped[reason] += 1
            continue
        k = _key(seg.fr, seg.en, seg.de)
        if k in seen:
            dropped["duplicate"] += 1
            continue
        seen.add(k)
        splits[_split_of(seg.doc_id, cfg)].append(seg)

    out = cfg.out_dir
    _write(terms, out / "terms" / "train.parquet", exclude={"n_langs"})
    n_segments = {
        split: _write(rows, out / "segments" / f"{split}.parquet", exclude={"n_langs"})
        for split, rows in splits.items()
    }
    n_pairs: dict[str, int] = {}
    for tgt in ("en", "de"):
        for split, rows in splits.items():
            pairs = [
                PairRow(
                    id=s.id,
                    source=s.source,
                    doc_id=s.doc_id,
                    granularity=s.granularity,
                    src=s.fr or "",
                    tgt=getattr(s, tgt),
                )
                for s in rows
                if getattr(s, tgt)
            ]
            n_pairs[f"fr-{tgt}/{split}"] = _write(pairs, out / f"fr-{tgt}" / f"{split}.parquet")

    by_source: dict[str, dict[str, int]] = {}
    for o in outputs:
        by_source[o.info.name] = {
            "terms": sum(1 for t in terms if t.source == o.info.name),
            "segments": sum(1 for r in splits.values() for s in r if s.source == o.info.name),
        }
    report = BuildReport(
        sources=[o.info for o in outputs],
        n_terms=len(terms),
        n_segments=n_segments,
        n_pairs=n_pairs,
        dropped=dict(dropped),
        by_source=by_source,
    )
    (out / "report.json").write_text(report.model_dump_json(indent=2), encoding="utf-8")
    return report
