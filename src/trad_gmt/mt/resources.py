"""Load the dataset (local ``data/processed`` or the Hub) into a glossary and memory pools."""

import logging
import pickle
from pathlib import Path

import pandas as pd
from pydantic import BaseModel

from trad_gmt.hub import DEFAULT_REPO
from trad_gmt.io import DATA, PROCESSED
from trad_gmt.mt.glossary import Glossary, generic_words_from
from trad_gmt.mt.memory import Example, MemoryPool, TranslationMemory
from trad_gmt.mt.style import HOUSE_TERMS
from trad_gmt.text import guess_lang

log = logging.getLogger(__name__)

INDEX_DIR = DATA / "index"
TARGETS: tuple[str, ...] = ("en", "de")
DOMAIN_SOURCES: dict[str, tuple[str, ...]] = {
    "en": ("berner", "fhh", "patek", "brands", "rolex"),
    "de": ("berner", "brands", "rolex"),
}
# examples retrieved per French sentence, by pool
PER_SENTENCE: dict[str, dict[str, int]] = {
    "en": {"style": 2, "domain": 1},
    "de": {"domain": 3},
}


class ResourceConfig(BaseModel):
    data_dir: Path = PROCESSED
    repo_id: str = DEFAULT_REPO
    min_score: float = 0.80
    min_chars: int = 25
    max_chars: int = 500


def ensure_data(cfg: ResourceConfig) -> Path:
    """Use ``data/processed`` if present, else download the dataset from the Hub (HF_TOKEN)."""
    if (cfg.data_dir / "terms").exists() and (cfg.data_dir / "segments").exists():
        return cfg.data_dir
    from huggingface_hub import snapshot_download

    log.info("downloading %s → %s", cfg.repo_id, cfg.data_dir)
    snapshot_download(cfg.repo_id, repo_type="dataset", local_dir=str(cfg.data_dir))
    return cfg.data_dir


def load_terms(cfg: ResourceConfig) -> pd.DataFrame:
    df = pd.read_parquet(ensure_data(cfg) / "terms" / "train.parquet")
    return df.astype(object).where(df.notna(), None)


def load_segments(cfg: ResourceConfig, split: str = "train") -> pd.DataFrame:
    cols = ["id", "source", "doc_id", "fr", "en", "de", "score_en", "score_de", "tags"]
    return pd.read_parquet(ensure_data(cfg) / "segments" / f"{split}.parquet", columns=cols)


def is_house_style(tags: list[str]) -> bool:
    """GMT editorial content (not brand press releases) on WorldTempus."""
    return any(t.startswith("type:maison") or t == "folder:GMT Magazine" for t in tags)


def select_pool(seg: pd.DataFrame, lang: str, pool: str, cfg: ResourceConfig) -> pd.DataFrame:
    score = seg[f"score_{lang}"]
    ok = seg[lang].notna() & (score.isna() | (score >= cfg.min_score))
    ok &= seg.fr.str.len().between(cfg.min_chars, cfg.max_chars)
    if pool == "style":
        ok &= (seg.source == "worldtempus") & seg.tags.map(lambda t: is_house_style(list(t)))
    else:
        ok &= seg.source.isin(DOMAIN_SOURCES[lang])
    out = seg[ok]
    # drop rows whose target is visibly in the wrong language (alignment noise)
    return out[out[lang].map(lambda t: guess_lang(t) in (None, lang))]


def to_examples(df: pd.DataFrame, lang: str, pool: str) -> list[Example]:
    return [
        Example(fr=fr, tgt=tgt, source=src, pool=pool)
        for fr, tgt, src in zip(df.fr, df[lang], df.source, strict=True)
    ]


class Resources(BaseModel, arbitrary_types_allowed=True):
    glossary: Glossary
    memories: dict[str, TranslationMemory]


def build_resources(cfg: ResourceConfig) -> Resources:
    seg = load_segments(cfg)
    style_fr = seg.loc[seg.source == "worldtempus", "fr"].dropna()
    generic = generic_words_from(style_fr.sample(min(len(style_fr), 200_000), random_state=0))
    house = [{**t, "source": "gmt", "priority": 0} for t in HOUSE_TERMS]
    rows = house + load_terms(cfg).to_dict("records")
    glossary = Glossary.from_rows(rows, generic_words=generic)
    log.info(
        "glossary: %d French keys (%d generic one-word keys skipped)", len(glossary), len(generic)
    )
    memories: dict[str, TranslationMemory] = {}
    for lang in TARGETS:
        pools: dict[str, MemoryPool] = {}
        for pool in PER_SENTENCE[lang]:
            df = select_pool(seg, lang, pool, cfg)
            pools[pool] = MemoryPool(pool, to_examples(df, lang, pool))
            log.info("memory %s/%s: %d examples", lang, pool, len(df))
        memories[lang] = TranslationMemory(pools, PER_SENTENCE[lang])
    return Resources(glossary=glossary, memories=memories)


def load_resources(cfg: ResourceConfig | None = None, rebuild: bool = False) -> Resources:
    """Build once, then reuse the pickled indexes from ``data/index/``."""
    cfg = cfg or ResourceConfig()
    path = INDEX_DIR / "resources.pkl"
    if path.exists() and not rebuild:
        with path.open("rb") as fh:
            return pickle.load(fh)
    res = build_resources(cfg)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as fh:
        pickle.dump(res, fh, protocol=pickle.HIGHEST_PROTOCOL)
    return res
