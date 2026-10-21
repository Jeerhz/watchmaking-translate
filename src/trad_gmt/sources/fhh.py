"""Fondation de la Haute Horlogerie (hautehorlogerie.org) — FR / EN.

The site's search index is a set of static JSON files per language
(``/json/{lang}/search/{type}-{n}.json``) whose records share a GUID ``Id``
across languages. We join on that id and parse each detail page:

* ``encyclopedia-list`` — glossary, complications, professions, people
  → terms (title + definition) and sentence-aligned definitions
* ``millesimes-list`` — watch novelties: editorial description (closest to
  magazine style) + technical spec sheet (label/value pairs → terms)
* ``article-list`` — library articles → sentence-aligned body text
"""

import html
import json
import logging

from pydantic import BaseModel
from selectolax.lexbor import LexborHTMLParser, LexborNode
from tqdm import tqdm

from trad_gmt.align import SentenceAligner
from trad_gmt.http import CachedFetcher
from trad_gmt.io import RAW, SourceOutput
from trad_gmt.schemas import ParallelSegment, SourceInfo, TermEntry
from trad_gmt.sources.common import align_document
from trad_gmt.text import node_text, normalize

log = logging.getLogger(__name__)

NAME = "fhh"
BASE = "https://www.hautehorlogerie.org"
LANGS_FHH: tuple[str, ...] = ("fr", "en")
TYPES: tuple[str, ...] = ("encyclopedia-list", "millesimes-list", "article-list")
CONFIG_URL = BASE + "/json/{lang}/search/{type}-config.json"
PART_URL = BASE + "/json/{lang}/search/{type}-{n}.json"
ARTICLE_BLOCKS: tuple[str, ...] = ("block--text", "block--imagetext", "block--quote")


class Record(BaseModel):
    id: str
    type: str
    title: str
    url: str


class Page(BaseModel):
    title: str | None = None
    paragraphs: list[str] = []
    specs: list[tuple[str, int, str, str]] = []  # (section, index, label, value)


def _text(node: LexborNode) -> str:
    return normalize(node_text(node))


def parse_page(page_html: str, kind: str) -> Page:
    tree = LexborHTMLParser(page_html)
    main = tree.css_first("main#content")
    if main is None:
        return Page()
    h1 = main.css_first("h1")
    page = Page(title=_text(h1) if h1 else None)
    if kind == "encyclopedia-list":
        desc = main.css_first(".block--headerencyclopedia .description")
        page.paragraphs = [t for p in desc.css("p") if (t := _text(p))] if desc else []
    elif kind == "millesimes-list":
        block = main.css_first(".block--watchcharacteristics")
        if block is None:
            return page
        desc = block.css_first(".description")
        page.paragraphs = [t for p in desc.css("p") if (t := _text(p))] if desc else []
        for section in block.css(".technicalInfo .section"):
            name = (section.attributes.get("class") or "").replace("section", "").strip()
            for k, li in enumerate(section.css("li")):
                label, value = li.css_first(".label"), li.css_first(".value")
                if label and value:
                    page.specs.append((name, k, _text(label), _text(value)))
    else:
        for block in main.css("div.block"):
            cls = block.attributes.get("class") or ""
            if any(b in cls for b in ARTICLE_BLOCKS):
                page.paragraphs += [t for n in block.css("h2, h3, p, li") if (t := _text(n))]
    return page


def _load_index(fetcher: CachedFetcher) -> dict[str, dict[str, Record]]:
    """Return {lang: {id: Record}} over every JSON part of every type."""
    configs = {(lang, t): CONFIG_URL.format(lang=lang, type=t) for lang in LANGS_FHH for t in TYPES}
    got = fetcher.fetch_all_sync(list(configs.values()), desc="fhh configs")
    parts: dict[str, tuple[str, str]] = {}
    for (lang, t), url in configs.items():
        n_files = json.loads(got[url].text or "{}").get("FileNumber", 0)
        for n in range(1, n_files + 1):
            parts[PART_URL.format(lang=lang, type=t, n=n)] = (lang, t)
    got = fetcher.fetch_all_sync(list(parts), desc="fhh index")
    index: dict[str, dict[str, Record]] = {lang: {} for lang in LANGS_FHH}
    for url, (lang, t) in parts.items():
        for item in json.loads(got[url].text or "[]"):
            if item.get("Id") and item.get("url"):
                title = item.get("title") or item.get("watchName") or ""
                index[lang][item["Id"]] = Record(
                    id=item["Id"],
                    type=t,
                    title=normalize(html.unescape(title)),
                    url="".join(item["url"].split()),
                )
    return index


def collect(concurrency: int = 4) -> SourceOutput:
    fetcher = CachedFetcher(cache_dir=RAW / NAME, concurrency=concurrency)
    index = _load_index(fetcher)
    ids = sorted(set(index["fr"]) & set(index["en"]))
    log.info("FHH: %d records aligned fr/en", len(ids))
    urls = [BASE + index[lang][i].url for i in ids for lang in LANGS_FHH]
    pages = fetcher.fetch_all_sync(urls, desc="fhh pages")

    aligner = SentenceAligner()
    terms: list[TermEntry] = []
    segments: list[ParallelSegment] = []
    for rid in tqdm(ids, desc="fhh align"):
        kind = index["fr"][rid].type
        parsed: dict[str, Page] = {}
        for lang in LANGS_FHH:
            rec = index[lang][rid]
            if text := pages[BASE + rec.url].text:
                parsed[lang] = parse_page(text, kind)
        if len(parsed) < 2:
            continue
        doc_id = f"{NAME}:{kind.removesuffix('-list')}:{rid}"
        url_fr = BASE + index["fr"][rid].url
        titles = {lang: p.title or index[lang][rid].title for lang, p in parsed.items()}

        if kind == "encyclopedia-list":
            terms.append(
                TermEntry(
                    id=doc_id,
                    source=NAME,
                    source_id=rid,
                    url=url_fr,
                    **titles,
                    **{
                        f"definition_{lang}": " ".join(p.paragraphs) or None
                        for lang, p in parsed.items()
                    },
                )
            )
        else:
            segments.append(
                ParallelSegment(
                    id=f"{doc_id}:title",
                    source=NAME,
                    doc_id=doc_id,
                    granularity="sentence",
                    url=url_fr,
                    **titles,
                )
            )
        if kind == "millesimes-list":
            en_specs = {(s, k): (lab, val) for s, k, lab, val in parsed["en"].specs}
            for s, k, lab, val in parsed["fr"].specs:
                if (s, k) not in en_specs:
                    continue
                en_lab, en_val = en_specs[(s, k)]
                for j, (fr_t, en_t) in enumerate(((lab, en_lab), (val, en_val))):
                    if fr_t and en_t and not any(ch.isdigit() for ch in fr_t + en_t):
                        terms.append(
                            TermEntry(
                                id=f"{NAME}:spec:{s}:{fr_t}:{en_t}:{j}",
                                source=NAME,
                                source_id=f"spec:{s}",
                                fr=fr_t,
                                en=en_t,
                                url=url_fr,
                            )
                        )
        segments += align_document(
            NAME, doc_id, {lang: p.paragraphs for lang, p in parsed.items()}, aligner, url_fr
        )
        aligner.clear_cache()

    info = SourceInfo(
        name=NAME,
        title="Fondation de la Haute Horlogerie — encyclopédie, millésimes, bibliothèque",
        url=BASE,
        license="© Fondation de la Haute Horlogerie — research use only",
        notes="FR/EN only (no German on the site). Records joined on the search-index GUID.",
    )
    return SourceOutput(info=info, terms=terms, segments=segments)
