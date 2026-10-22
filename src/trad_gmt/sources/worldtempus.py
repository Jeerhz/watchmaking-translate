"""WorldTempus (GMT Publishing) — fr.worldtempus.com / en.worldtempus.com.

GMT Publishing's own watch magazine site: its French→English translations are
the house style the MT system must reproduce, so this is the reference source.
Both editions are the same Drupal site and an article keeps its node id in
both URLs (``…/ferveur-83535.html`` ↔ ``…/passion-83535.html``), so pages are
paired exactly on that id, then sentence-aligned with LaBSE.
"""

import logging
import re

from pydantic import BaseModel
from selectolax.lexbor import LexborHTMLParser
from tqdm import tqdm

from trad_gmt.align import SentenceAligner
from trad_gmt.http import CachedFetcher
from trad_gmt.io import RAW, SourceOutput
from trad_gmt.schemas import ParallelSegment, SourceInfo
from trad_gmt.sources.brands import BROWSER_HEADERS
from trad_gmt.sources.common import align_document
from trad_gmt.text import node_text, normalize

log = logging.getLogger(__name__)

NAME = "worldtempus"
HOSTS: dict[str, str] = {"fr": "https://fr.worldtempus.com", "en": "https://en.worldtempus.com"}
SITEMAP_INDEX = "{host}/sitemap.xml"
_NODE_ID = re.compile(r"-(\d+)\.html$")
_BODY = ".field--name-body, .field--name-field-paragraphs"


class Article(BaseModel):
    node_id: str
    lang: str
    title: str | None = None
    standfirst: str | None = None
    paragraphs: list[str] = []
    category: str | None = None
    type: str | None = None
    brands: str | None = None
    folder: str | None = None
    editor: str | None = None
    date: str | None = None


def parse_article(page_html: str) -> Article | None:
    tree = LexborHTMLParser(page_html)
    art = tree.css_first("article[data-id]")
    if art is None:
        return None
    attrs = art.attributes
    meta = tree.css_first('meta[name="description"]')
    paragraphs: list[str] = []
    for body in art.css(_BODY):
        for node in body.css("h2, h3, h4, p, li, blockquote"):
            if node.tag == "p" and node.parent is not None and node.parent.tag == "blockquote":
                continue
            paragraphs += [t for line in node_text(node).split("\n") if (t := normalize(line))]
    return Article(
        node_id=attrs.get("data-id") or "",
        lang=attrs.get("data-lang") or "",
        title=normalize(attrs.get("data-name") or "") or None,
        standfirst=normalize(meta.attributes.get("content") or "") or None if meta else None,
        paragraphs=list(dict.fromkeys(paragraphs)),
        category=attrs.get("data-category-name"),
        type=attrs.get("data-type"),
        brands=attrs.get("data-brands-names"),
        folder=attrs.get("data-folder-name"),
        editor=attrs.get("data-editor"),
        date=attrs.get("data-date"),
    )


def article_urls(fetcher: CachedFetcher, lang: str) -> dict[str, str]:
    """{node id: article URL} from the paginated sitemap of one edition."""
    index_url = SITEMAP_INDEX.format(host=HOSTS[lang])
    index = fetcher.fetch_all_sync([index_url], desc=f"wt {lang} index")[index_url].text or ""
    pages = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", index)
    got = fetcher.fetch_all_sync(pages, desc=f"wt {lang} sitemaps")
    urls: dict[str, str] = {}
    for page in pages:
        for loc in re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", got[page].text or ""):
            if "/article/" in loc and (m := _NODE_ID.search(loc)):
                urls[m.group(1)] = loc
    log.info("WorldTempus %s: %d article URLs", lang, len(urls))
    return urls


def collect(concurrency: int = 4, max_docs: int | None = None) -> SourceOutput:
    fetcher = CachedFetcher(
        cache_dir=RAW / NAME, concurrency=concurrency, delay_s=0.2, headers=BROWSER_HEADERS
    )
    urls = {lang: article_urls(fetcher, lang) for lang in HOSTS}
    ids = sorted(set(urls["fr"]) & set(urls["en"]), key=int, reverse=True)[:max_docs]
    log.info("WorldTempus: %d articles in both editions", len(ids))
    pages = fetcher.fetch_all_sync(
        [urls[lang][i] for i in ids for lang in HOSTS], desc="wt articles"
    )

    aligner = SentenceAligner()
    segments: list[ParallelSegment] = []
    for node_id in tqdm(ids, desc="wt align"):
        arts = {
            lang: a
            for lang in HOSTS
            if (text := pages[urls[lang][node_id]].text) and (a := parse_article(text))
        }
        if len(arts) < 2 or not arts["fr"].paragraphs or not arts["en"].paragraphs:
            continue
        fr = arts["fr"]
        doc_id = f"{NAME}:{node_id}"
        tags = [
            f"{k}:{v}"
            for k, v in (
                ("type", fr.type),
                ("category", fr.category),
                ("folder", fr.folder),
                ("brands", fr.brands),
                ("editor", fr.editor),
                ("date", fr.date),
            )
            if v
        ]
        heads = {lang: [a.title or "", a.standfirst or ""] for lang, a in arts.items()}
        segments += align_document(
            NAME,
            doc_id,
            {lang: [h for h in heads[lang] if h] + a.paragraphs for lang, a in arts.items()},
            aligner,
            url=urls["fr"][node_id],
            tags=tags,
        )
        aligner.clear_cache()

    info = SourceInfo(
        name=NAME,
        title="WorldTempus (GMT Publishing) — FR/EN articles",
        url="https://fr.worldtempus.com",
        license="© GMT Publishing — client data, internal use",
        notes="GMT's own published translations: the reference style. Paired on Drupal node id.",
    )
    return SourceOutput(info=info, segments=segments)
