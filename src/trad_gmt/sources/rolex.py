"""Rolex editorial pages (rolex.com) in FR / EN / DE, read from the Internet Archive.

rolex.com blocks crawlers, but the Wayback Machine holds full server-rendered
copies. English lives at the root, French under ``/fr/`` and German under
``/de/`` with the same path, so every French editorial page (World of Rolex,
watchmaking, Rolex Family, Perpetual, magazine…) gives a natural triple.
Archived pages are ~1.7 MB, so only the extracted paragraphs are cached.
"""

import json
import logging
import re

import httpx
from tqdm import tqdm

from trad_gmt.align import SentenceAligner
from trad_gmt.http import CachedFetcher
from trad_gmt.io import RAW, SourceOutput
from trad_gmt.schemas import ParallelSegment, SourceInfo
from trad_gmt.sources.brands import extract_paragraphs
from trad_gmt.sources.common import align_document

log = logging.getLogger(__name__)

NAME = "rolex"
CDX = "https://web.archive.org/cdx/search/cdx"
SNAPSHOT = "https://web.archive.org/web/2026id_/{url}"
SITE = "https://www.rolex.com"
PREFIX: dict[str, str] = {"fr": "/fr/", "en": "/", "de": "/de/"}
SECTIONS: tuple[str, ...] = (
    "world-of-rolex",
    "rolex-family",
    "magazine",
    "watchmaking",
    "perpetual-initiatives",
    "rolex-and-sports",
    "about-rolex",
    "inside-rolex",
    "about-rolex-watches",
    "every-rolex-tells-a-story",
    "perpetual-arts",
    "perpetual-planet",
    "oyster-story",
    "watch-care-and-service",
    "buying-a-rolex",
    "science-and-exploration",
    "rolex-history",
    "arts-and-culture",
    "watches",
    "rolex-watches",
)
_MODEL_REF = re.compile(r"m\d{5,6}|\d{6}-\d{4}", re.IGNORECASE)


def french_paths(timeout_s: float = 300.0) -> list[str]:
    """Editorial paths (after /fr/) that the archive holds for rolex.com/fr/."""
    params = {
        "url": "rolex.com/fr/*",
        "filter": ["statuscode:200", "mimetype:text/html"],
        "collapse": "urlkey",
        "fl": "original",
    }
    resp = httpx.get(CDX, params=params, timeout=timeout_s)
    resp.raise_for_status()
    paths: set[str] = set()
    for line in resp.text.splitlines():
        m = re.match(r"^https?://(?:www\.)?rolex\.com(?::\d+)?/fr/([^?#]+)$", line.strip())
        if not m:
            continue
        path = m.group(1).rstrip("/")
        if path.split("/")[0] in SECTIONS and not _MODEL_REF.search(path):
            paths.add(path)
    # editorial sections first, watch collection pages last (SECTIONS order)
    return sorted(paths, key=lambda p: (SECTIONS.index(p.split("/")[0]), p))


def _paragraphs_json(page_html: str) -> str:
    return json.dumps(extract_paragraphs(page_html), ensure_ascii=False)


def collect(max_docs: int | None = None) -> SourceOutput:
    paths = french_paths()[:max_docs]
    log.info("Rolex: %d archived French editorial pages", len(paths))
    fetcher = CachedFetcher(
        cache_dir=RAW / NAME,
        concurrency=2,
        delay_s=1.0,
        timeout_s=120.0,
        retries=4,
        transform=_paragraphs_json,
    )
    triples = {
        p: {lang: SNAPSHOT.format(url=f"{SITE}{pre}{p}") for lang, pre in PREFIX.items()}
        for p in paths
    }
    pages = fetcher.fetch_all_sync(
        [u for t in triples.values() for u in t.values()], desc="rolex pages"
    )
    aligner = SentenceAligner()
    segments: list[ParallelSegment] = []
    for path, urls in tqdm(triples.items(), desc="rolex align"):
        paragraphs: dict[str, list[str]] = {}
        for lang, u in urls.items():
            if (text := pages[u].text) and (paras := json.loads(text)):
                paragraphs[lang] = paras
        segments += align_document(
            NAME,
            f"{NAME}:{path}",
            paragraphs,
            aligner,
            url=f"{SITE}/fr/{path}",
            tags=[f"section:{path.split('/')[0]}"],
        )
        aligner.clear_cache()
    info = SourceInfo(
        name=NAME,
        title="Rolex — editorial pages (World of Rolex, watchmaking, Perpetual…) via Wayback",
        url="https://web.archive.org/web/2026/https://www.rolex.com/fr/",
        license="© Rolex SA — research use only (archived copies)",
        notes="Same path under /fr/, / (en) and /de/; latest 2026 snapshot; trafilatura + LaBSE.",
    )
    return SourceOutput(info=info, segments=segments)
