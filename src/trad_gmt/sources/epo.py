"""European patents in IPC class G04 (horology) — trilingual claims FR / DE / EN.

A granted European patent (kind B1) publishes its claims in the three EPO
official languages, aligned by claim number. The list of G04 B1 publications
comes from the EPO linked-data SPARQL endpoint; full texts from the
publication server. The register is legal, but the terminology (balancier-spiral
↔ Unruh-Spirale ↔ balance spring…) is precise and abundant.
"""

import csv
import io
import logging
import re
import time
import xml.etree.ElementTree as ET

import httpx
from pydantic import BaseModel

from trad_gmt.http import CachedFetcher
from trad_gmt.io import RAW, SourceOutput
from trad_gmt.schemas import ParallelSegment, SourceInfo, TermEntry
from trad_gmt.text import normalize

log = logging.getLogger(__name__)

NAME = "epo"
SPARQL = "https://data.epo.org/linked-data/query"
DOC_URL = "https://data.epo.org/publication-server/rest/v1.2/patents/EP{num}NWB1/document.xml"
QUERY = """PREFIX patent: <http://data.epo.org/linked-data/def/patent/>
SELECT DISTINCT ?num ?date WHERE {{
  ?pub a patent:Publication ; patent:classificationIPCInventive ?ipc ;
       patent:publicationKind patent:publicationKind_B1 ;
       patent:publicationNumber ?num ; patent:publicationDate ?date .
  FILTER(STRSTARTS(STR(?ipc), "http://data.epo.org/linked-data/def/ipc/G04"))
}} ORDER BY DESC(?date) ?num LIMIT {limit} OFFSET {offset}"""

# reference numerals such as "(12)", "(18a, 18b)", "(20, 22)" carry no linguistic content
_REF_NUMERALS = re.compile(r"\s*\((?:\s*\d+[a-z']*\s*(?:,|;|-|et|and|und)?\s*)+\)")


class Publication(BaseModel):
    num: str
    date: str


class Patent(BaseModel):
    num: str
    procedure_lang: str | None
    titles: dict[str, str] = {}
    claims: dict[str, dict[str, str]] = {}  # lang → claim num → text


def list_publications(max_docs: int | None = None, page: int = 2000) -> list[Publication]:
    pubs: list[Publication] = []
    with httpx.Client(timeout=120) as client:
        while max_docs is None or len(pubs) < max_docs:
            for attempt in range(8):
                resp = client.post(
                    SPARQL,
                    data={"query": QUERY.format(limit=page, offset=len(pubs))},
                    headers={"Accept": "text/csv"},
                )
                if resp.status_code not in (429, 502, 503, 504):
                    break
                time.sleep(10 * (attempt + 1))
            resp.raise_for_status()
            rows = list(csv.DictReader(io.StringIO(resp.text)))
            pubs += [Publication(num=r["num"], date=r["date"]) for r in rows]
            if len(rows) < page:
                break
    unique = list({p.num: p for p in pubs}.values())
    return unique[:max_docs] if max_docs else unique


def clean_claim(text: str) -> str:
    return normalize(_REF_NUMERALS.sub("", " ".join(text.split())))


def parse_patent(xml_text: str, num: str) -> Patent:
    root = ET.fromstring(xml_text.encode())
    patent = Patent(num=num, procedure_lang=root.get("lang"))
    b540 = root.find(".//B540")
    if b540 is not None:
        langs = [e.text or "" for e in b540.findall("B541")]
        titles = [e.text or "" for e in b540.findall("B542")]
        patent.titles = {lang: normalize(t) for lang, t in zip(langs, titles, strict=False)}
    for claims in root.iter("claims"):
        lang = claims.get("lang") or ""
        patent.claims[lang] = {
            c.get("num", str(k)): clean_claim("".join(c.itertext()))
            for k, c in enumerate(claims.findall("claim"))
        }
    return patent


def collect(max_docs: int | None = None) -> SourceOutput:
    pubs = list_publications(max_docs)
    log.info("EPO: %d G04 B1 publications", len(pubs))
    fetcher = CachedFetcher(cache_dir=RAW / NAME, concurrency=1, delay_s=2.0, retries=10)
    urls = [DOC_URL.format(num=p.num) for p in pubs]
    pages = fetcher.fetch_all_sync(urls, desc="epo patents")

    terms: list[TermEntry] = []
    segments: list[ParallelSegment] = []
    for pub in pubs:
        page = pages[DOC_URL.format(num=pub.num)]
        if not page.text:
            continue
        try:
            patent = parse_patent(page.text, pub.num)
        except ET.ParseError:
            log.warning("unparsable XML for EP%s", pub.num)
            continue
        doc_id = f"{NAME}:EP{pub.num}"
        url = f"https://data.epo.org/publication-server/document?pn={pub.num}&ki=B1"
        fr_claims = patent.claims.get("fr", {})
        for cnum, fr_text in fr_claims.items():
            row = {lang: patent.claims.get(lang, {}).get(cnum) for lang in ("en", "de")}
            if not any(row.values()):
                continue
            segments.append(
                ParallelSegment(
                    id=f"{doc_id}:claim{cnum}",
                    source=NAME,
                    doc_id=doc_id,
                    granularity="paragraph",
                    url=url,
                    fr=fr_text,
                    **row,
                )
            )
    info = SourceInfo(
        name=NAME,
        title="European Patent Office — granted patents in IPC G04 (claims fr/de/en)",
        url="https://data.epo.org/publication-server/",
        license="EPO data — free reuse with attribution (EPO terms of use)",
        notes="Claims aligned by claim number; reference numerals removed. Newest first.",
    )
    return SourceOutput(info=info, terms=terms, segments=segments)
