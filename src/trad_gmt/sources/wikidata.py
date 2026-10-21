"""Wikipedia « Catégorie:Horlogerie » tree → Wikidata labels in fr / en / de.

Walks the French Wikipedia horology category tree, maps each article to its
Wikidata item, and keeps the fr/en/de labels and short descriptions. People,
companies, brands and places are filtered out by ``instance of`` (P31) so
what remains is mostly concepts: complications, components, instruments…
"""

import logging
import time

import httpx
from pydantic import BaseModel

from trad_gmt.io import SourceOutput
from trad_gmt.schemas import LANGS, SourceInfo, TermEntry
from trad_gmt.text import normalize

log = logging.getLogger(__name__)

NAME = "wikidata"
FRWIKI = "https://fr.wikipedia.org/w/api.php"
WIKIDATA = "https://www.wikidata.org/w/api.php"
# Concept categories only: the big mixed ones (portal "articles liés", clock towers,
# companies, watchmakers, museums, paintings…) are deliberately left out.
CATEGORIES: tuple[str, ...] = (
    "Catégorie:Horlogerie",
    "Catégorie:Wikipédia:ébauche horlogerie",
    "Catégorie:Complication en horlogerie",
    "Catégorie:Horloge",
    "Catégorie:Horloge hydraulique",
    "Catégorie:Horloge atomique",
    "Catégorie:Montre",
    "Catégorie:Mouvement de montre",
    "Catégorie:Pièce d'une montre",
    "Catégorie:Type de montre",
    "Catégorie:Modèle de montre",
)
HEADERS = {
    "User-Agent": "trad-gmt/0.1 (https://huggingface.co/AdleBenSalem; terminology research) httpx"
}
EXCLUDED_P31: frozenset[str] = frozenset(
    {
        "Q5",  # human
        "Q4830453",
        "Q6881511",
        "Q783794",
        "Q891723",
        "Q167037",
        "Q658255",  # businesses
        "Q431289",
        "Q2088357",  # brand, musical/other brand
        "Q43229",
        "Q163740",
        "Q1664720",
        "Q3918",
        "Q875538",  # organisations, schools
        "Q33506",
        "Q207694",
        "Q1007870",  # museums
        "Q515",
        "Q486972",
        "Q484170",
        "Q70208",
        "Q747074",  # places
        "Q11424",
        "Q7725634",
        "Q571",
        "Q5398426",
        "Q41298",  # films, books, magazines
        "Q4167836",
        "Q13406463",  # Wikimedia category / list
    }
)


class WikiConfig(BaseModel):
    pause_s: float = 0.5


def _get(client: httpx.Client, url: str, params: dict[str, str]) -> dict:
    for attempt in range(6):
        try:
            resp = client.get(url, params={**params, "format": "json", "formatversion": "2"})
        except httpx.TransportError as exc:
            log.warning("%s on %s, retrying", type(exc).__name__, url)
            time.sleep(5 * (attempt + 1))
            continue
        if resp.status_code == 429:
            time.sleep(float(resp.headers.get("retry-after", 5 * (attempt + 1))))
            continue
        resp.raise_for_status()
        return resp.json()
    raise RuntimeError(f"giving up on {url} {params}")


def _category_members(
    client: httpx.Client, cat: str, cfg: WikiConfig
) -> tuple[list[str], list[str]]:
    pages: list[str] = []
    subcats: list[str] = []
    params = {
        "action": "query",
        "list": "categorymembers",
        "cmtitle": cat,
        "cmlimit": "500",
        "cmtype": "page|subcat",
        "cmnamespace": "0|14",
    }
    while True:
        data = _get(client, FRWIKI, params)
        for m in data.get("query", {}).get("categorymembers", []):
            (subcats if m["ns"] == 14 else pages).append(m["title"])
        if "continue" not in data:
            return pages, subcats
        params.update(data["continue"])
        time.sleep(cfg.pause_s)


def crawl_titles(client: httpx.Client, cfg: WikiConfig) -> list[str]:
    titles: set[str] = set()
    for cat in CATEGORIES:
        pages, _subcats = _category_members(client, cat, cfg)
        titles.update(pages)
        time.sleep(cfg.pause_s)
    log.info("wikipedia: %d categories, %d articles", len(CATEGORIES), len(titles))
    return sorted(titles)


def _qids(client: httpx.Client, titles: list[str], cfg: WikiConfig) -> dict[str, str]:
    out: dict[str, str] = {}
    for i in range(0, len(titles), 50):
        data = _get(
            client,
            FRWIKI,
            {
                "action": "query",
                "prop": "pageprops",
                "ppprop": "wikibase_item",
                "titles": "|".join(titles[i : i + 50]),
            },
        )
        for page in data.get("query", {}).get("pages", []):
            if qid := page.get("pageprops", {}).get("wikibase_item"):
                out[qid] = page["title"]
        time.sleep(cfg.pause_s)
    return out


def collect(cfg: WikiConfig | None = None) -> SourceOutput:
    cfg = cfg or WikiConfig()
    terms: list[TermEntry] = []
    with httpx.Client(headers=HEADERS, timeout=60) as client:
        qids = _qids(client, crawl_titles(client, cfg), cfg)
        ids = sorted(qids)
        for i in range(0, len(ids), 50):
            data = _get(
                client,
                WIKIDATA,
                {
                    "action": "wbgetentities",
                    "ids": "|".join(ids[i : i + 50]),
                    "props": "labels|descriptions|claims",
                    "languages": "|".join(LANGS),
                },
            )
            for qid, ent in data.get("entities", {}).items():
                p31 = {
                    c["mainsnak"].get("datavalue", {}).get("value", {}).get("id")
                    for c in ent.get("claims", {}).get("P31", [])
                }
                if p31 & EXCLUDED_P31:
                    continue
                labels = {k: normalize(v["value"]) for k, v in ent.get("labels", {}).items()}
                descs = {k: normalize(v["value"]) for k, v in ent.get("descriptions", {}).items()}
                if "fr" not in labels or len(labels) < 2:
                    continue
                terms.append(
                    TermEntry(
                        id=f"{NAME}:{qid}",
                        source=NAME,
                        source_id=qid,
                        url=f"https://www.wikidata.org/wiki/{qid}",
                        **{lang: labels.get(lang) for lang in LANGS},
                        **{f"definition_{lang}": descs.get(lang) for lang in LANGS},
                    )
                )
            time.sleep(cfg.pause_s)
    info = SourceInfo(
        name=NAME,
        title="Wikidata labels for French Wikipedia horology categories",
        url="https://fr.wikipedia.org/wiki/Catégorie:Horlogerie",
        license="CC0 (Wikidata)",
        notes="Concept labels only (comparable Wikipedia text not included); "
        "people, companies, places and works filtered via P31.",
    )
    return SourceOutput(info=info, terms=terms)
