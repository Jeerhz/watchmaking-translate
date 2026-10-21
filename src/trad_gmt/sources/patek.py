"""Patek Philippe glossary (patek.com/en/glossary, /fr/glossaire) — FR / EN.

The 315 entries are embedded in the Next.js ``__NEXT_DATA__`` payload. Each
language is sorted in its own alphabetical order and has no shared id, so the
entries are paired by an optimal one-to-one assignment on LaBSE similarity of
``title: definition``; low-confidence pairs are dropped.
"""

import json
import logging
import re

from pydantic import BaseModel

from trad_gmt.align import SentenceAligner
from trad_gmt.http import CachedFetcher
from trad_gmt.io import RAW, SourceOutput
from trad_gmt.schemas import ParallelSegment, SourceInfo, TermEntry
from trad_gmt.sources.brands import BROWSER_HEADERS
from trad_gmt.sources.common import align_document
from trad_gmt.text import normalize

log = logging.getLogger(__name__)

NAME = "patek"
URLS: dict[str, str] = {
    "en": "https://www.patek.com/en/glossary",
    "fr": "https://www.patek.com/fr/glossaire",
}
MIN_MATCH = 0.6


class GlossaryItem(BaseModel):
    title: str
    definition: str


def _find_glossary(node: object) -> list[dict[str, str]] | None:
    if isinstance(node, dict):
        if node.get("componentName") == "Glossary":
            return node.get("fields", {}).get("items", [])
        children: list[object] = list(node.values())
    elif isinstance(node, list):
        children = node
    else:
        return None
    for child in children:
        if (found := _find_glossary(child)) is not None:
            return found
    return None


def parse_glossary(page_html: str) -> list[GlossaryItem]:
    match = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', page_html, re.DOTALL)
    if not match:
        return []
    items = _find_glossary(json.loads(match.group(1))) or []
    return [
        GlossaryItem(title=normalize(i["title"]), definition=normalize(i["definition"]))
        for i in items
        if i.get("title") and i.get("definition")
    ]


def collect() -> SourceOutput:
    fetcher = CachedFetcher(cache_dir=RAW / NAME, concurrency=1, headers=BROWSER_HEADERS)
    pages = fetcher.fetch_all_sync(list(URLS.values()), desc="patek")
    items = {lang: parse_glossary(pages[u].text or "") for lang, u in URLS.items()}
    log.info("Patek: %s entries", {k: len(v) for k, v in items.items()})

    aligner = SentenceAligner()
    keyed = {lang: [f"{i.title}: {i.definition}" for i in v] for lang, v in items.items()}
    matches = aligner.match_bijective(keyed["fr"], keyed["en"])
    terms: list[TermEntry] = []
    segments: list[ParallelSegment] = []
    for r, c, score in matches:
        if score < MIN_MATCH:
            continue
        fr, en = items["fr"][r], items["en"][c]
        doc_id = f"{NAME}:{r}"
        terms.append(
            TermEntry(
                id=doc_id,
                source=NAME,
                source_id=str(r),
                url=URLS["fr"],
                fr=fr.title,
                en=en.title,
                definition_fr=fr.definition,
                definition_en=en.definition,
            )
        )
        segments += align_document(
            NAME, doc_id, {"fr": [fr.definition], "en": [en.definition]}, aligner, URLS["fr"]
        )
    log.info("Patek: kept %d/%d matched entries", len(terms), len(matches))
    info = SourceInfo(
        name=NAME,
        title="Patek Philippe — Glossaire / Glossary",
        url=URLS["fr"],
        license="© Patek Philippe SA — research use only",
        notes="FR/EN only; entries paired by bijective LaBSE matching (score ≥ 0.6).",
    )
    return SourceOutput(info=info, terms=terms, segments=segments)
