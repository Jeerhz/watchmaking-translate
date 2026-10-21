"""Watch-brand websites with the same page under /fr/, /en/ and /de/ locales.

Editorial pages (news, savoir-faire, manufacture) and product pages written by
the brands' own copywriters/translators — the closest public material to a
luxury watch magazine. Pages are enumerated from the French sitemap, the
locale segment is swapped to get EN/DE, main text is extracted with
trafilatura and sentence-aligned with the LaBSE aligner.
"""

import logging
import re

import trafilatura
from pydantic import BaseModel
from tqdm import tqdm

from trad_gmt.align import SentenceAligner
from trad_gmt.http import CachedFetcher
from trad_gmt.io import RAW, SourceOutput
from trad_gmt.schemas import ParallelSegment, SourceInfo
from trad_gmt.sources.common import align_document
from trad_gmt.text import normalize

log = logging.getLogger(__name__)

NAME = "brands"
BROWSER_HEADERS: dict[str, str] = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Encoding": "gzip, deflate",
    "Accept-Language": "fr-CH,fr;q=0.9,en;q=0.8,de;q=0.7",
}


class BrandSite(BaseModel):
    key: str
    name: str
    sitemap_fr: str
    locale: dict[str, str]  # lang → locale path segment, e.g. {"fr": "/ch-fr/"}
    include: list[str]  # regexes on the path after the locale segment
    concurrency: int = 2
    delay_s: float = 1.0
    timeout_s: float = 60.0


SITES: tuple[BrandSite, ...] = (
    BrandSite(
        key="jlc",
        name="Jaeger-LeCoultre",
        sitemap_fr="https://www.jaeger-lecoultre.com/ch-fr/sitemap.xml",
        locale={"fr": "/ch-fr/", "en": "/ch-en/", "de": "/ch-de/"},
        include=[r"^news/", r"^our-maison/", r"^watches/"],
    ),
    BrandSite(
        key="lange",
        name="A. Lange & Söhne",
        sitemap_fr="https://www.alange-soehne.com/ch-fr/sitemap.xml",
        locale={"fr": "/ch-fr/", "en": "/ch-en/", "de": "/ch-de/"},
        include=[r"^manufacture/", r"^timepieces/(?!foobar)"],
    ),
    BrandSite(
        key="ap",
        name="Audemars Piguet",
        sitemap_fr="https://www.audemarspiguet.com/ch/fr/sitemap.xml",
        locale={"fr": "/ch/fr/", "en": "/ch/en/", "de": "/ch/de/"},
        include=[r"^news/", r"^about/", r"^watch-collection/"],
        concurrency=1,
        timeout_s=90.0,
    ),
)


def extract_paragraphs(page_html: str) -> list[str]:
    text = trafilatura.extract(
        page_html, include_comments=False, include_tables=False, favor_precision=True
    )
    return [p for line in (text or "").split("\n") if (p := normalize(line))]


def site_urls(site: BrandSite, sitemap_xml: str) -> list[str]:
    locs = re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", sitemap_xml)
    fr = site.locale["fr"]
    keep: list[str] = []
    for loc in locs:
        if fr not in loc:
            continue
        rest = loc.split(fr, 1)[1]
        if any(re.search(p, rest) for p in site.include):
            keep.append(loc)
    return sorted(set(keep))


def collect_site(site: BrandSite, aligner: SentenceAligner) -> list[ParallelSegment]:
    fetcher = CachedFetcher(
        cache_dir=RAW / NAME / site.key,
        concurrency=site.concurrency,
        delay_s=site.delay_s,
        timeout_s=site.timeout_s,
        headers=BROWSER_HEADERS,
    )
    sitemap = fetcher.fetch_all_sync([site.sitemap_fr], desc=f"{site.key} sitemap")
    fr_urls = site_urls(site, next(iter(sitemap.values())).text or "")
    log.info("%s: %d French pages", site.name, len(fr_urls))
    triples = {
        u: {lang: u.replace(site.locale["fr"], loc, 1) for lang, loc in site.locale.items()}
        for u in fr_urls
    }
    pages = fetcher.fetch_all_sync(
        [u for t in triples.values() for u in t.values()], desc=f"{site.key} pages"
    )
    segments: list[ParallelSegment] = []
    for fr_url, urls in tqdm(triples.items(), desc=f"{site.key} align"):
        paragraphs = {
            lang: extract_paragraphs(text) for lang, u in urls.items() if (text := pages[u].text)
        }
        paragraphs = {lang: p for lang, p in paragraphs.items() if p}
        slug = fr_url.split(site.locale["fr"], 1)[1].strip("/")
        segments += align_document(
            NAME, f"{NAME}:{site.key}:{slug}", paragraphs, aligner, url=fr_url
        )
        aligner.clear_cache()
    return segments


def collect(sites: list[str] | None = None) -> SourceOutput:
    aligner = SentenceAligner()
    segments: list[ParallelSegment] = []
    for site in SITES:
        if sites is None or site.key in sites:
            segments += collect_site(site, aligner)
    info = SourceInfo(
        name=NAME,
        title="Watch brand websites: " + ", ".join(s.name for s in SITES),
        url=", ".join(s.sitemap_fr for s in SITES),
        license="© respective brands — research use only, robots.txt respected",
        notes="Same page in ch-fr/ch-en/ch-de locales; trafilatura extraction; LaBSE alignment.",
    )
    return SourceOutput(info=info, segments=segments)
