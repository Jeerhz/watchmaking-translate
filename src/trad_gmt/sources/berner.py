"""FH Berner — Illustrated Professional Dictionary of Horology (dictionary.fhs.swiss).

Every concept has a numeric id shared by its French, English and German entries,
and the definitions are translations of each other. Entries are split into
blocks separated by blank lines; blocks that start with a bold ``<strong>term:</strong>``
introduce sub-entries. Blocks line up across languages, so we get:

* terms  — head entry + every sub-entry, aligned fr/en/de
* segments — definition blocks, sentence-aligned when all three languages split
  into the same number of sentences, paragraph-aligned otherwise.
"""

import logging
import re

from pydantic import BaseModel
from selectolax.lexbor import LexborHTMLParser

from trad_gmt.http import CachedFetcher
from trad_gmt.io import RAW, SourceOutput
from trad_gmt.schemas import LANGS, ParallelSegment, SourceInfo, TermEntry
from trad_gmt.text import node_text, normalize, split_sentences

log = logging.getLogger(__name__)

NAME = "berner"
BASE = "https://dictionary.fhs.swiss"
LIST_URL = BASE + "/xhr/list.php?s=all&lang={lang}"
DEF_URL = BASE + "/xhr/definition.php?id={id}&lang={lang}&i=0"

_BLOCK_SPLIT = re.compile(r"(?:<br\s*/?>\s*){2,}")
_LEAD_TERMS = re.compile(
    r"^\s*((?:<strong>.*?</strong>\s*(?:ou|or|oder|et|and|und|,|;)?\s*)+)", re.DOTALL
)
_STRONG = re.compile(r"<strong>(.*?)</strong>", re.DOTALL)
_JOINERS = re.compile(r"^(ou|or|oder|et|and|und|,|;)$")


class Block(BaseModel):
    terms: list[str] = []
    text: str


class LangEntry(BaseModel):
    lang: str
    headword: str
    pos: str | None
    blocks: list[Block]


def _html_to_text(fragment: str) -> str:
    return normalize(node_text(LexborHTMLParser(f"<div>{fragment}</div>").css_first("div")))


def _split_terms(lead_html: str) -> list[str]:
    """Each <strong> is one designation; variants are joined by ou/or/oder."""
    raw = [_html_to_text(s).strip(" :") for s in _STRONG.findall(lead_html)]
    return [t for t in raw if t and not _JOINERS.match(t)]


def parse_block(fragment: str) -> Block | None:
    if not _html_to_text(fragment):
        return None
    match = _LEAD_TERMS.match(fragment)
    if match and ":" in _html_to_text(match.group(1)):
        lead = match.group(1)
        return Block(terms=_split_terms(lead), text=_html_to_text(fragment[match.end() :]))
    return Block(text=_html_to_text(fragment))


def parse_entry(html: str, entry_id: int, lang: str) -> LangEntry | None:
    """Pick the block of ``entry_id`` among the homographs returned and parse it."""
    marker = f"({entry_id})</span>"
    chunk = next((c for c in html.split("<hr />") if marker in c), None)
    if chunk is None:
        return None
    tree = LexborHTMLParser(chunk)
    h2 = tree.css_first("h2")
    word = h2.css_first("span") if h2 else None
    if h2 is None or word is None:
        return None
    headword = normalize(word.text())
    pos = normalize(h2.text().replace(word.text(), "", 1)) or None

    blocks: list[Block] = []
    for para in tree.css("p"):
        for fragment in _BLOCK_SPLIT.split(para.inner_html or ""):
            if (block := parse_block(fragment)) is not None:
                blocks.append(block)
    return LangEntry(lang=lang, headword=headword, pos=pos, blocks=blocks)


def _aligned_terms(entry_id: int, entries: dict[str, LangEntry]) -> list[TermEntry]:
    head = TermEntry(
        id=f"{NAME}:{entry_id}",
        source=NAME,
        source_id=str(entry_id),
        url=f"{BASE}/?l=fr",
        **{lang: e.headword for lang, e in entries.items()},
        **{f"pos_{lang}": e.pos for lang, e in entries.items()},
        **{
            f"definition_{lang}": " ".join(b.text for b in e.blocks if not b.terms) or None
            for lang, e in entries.items()
        },
    )
    terms = [head]
    n_blocks = {len(e.blocks) for e in entries.values()}
    if len(n_blocks) != 1:
        return terms
    for k in range(n_blocks.pop()):
        blocks = {lang: e.blocks[k] for lang, e in entries.items()}
        n_terms = {len(b.terms) for b in blocks.values()}
        if 0 in n_terms:
            continue
        if len(n_terms) != 1:  # variant counts differ: keep all variants together
            blocks = {
                lang: Block(terms=[" / ".join(b.terms)], text=b.text) for lang, b in blocks.items()
            }
            n_terms = {1}
        for t in range(n_terms.pop()):
            terms.append(
                TermEntry(
                    id=f"{NAME}:{entry_id}:{k}.{t}",
                    source=NAME,
                    source_id=str(entry_id),
                    parent_id=head.id,
                    url=head.url,
                    **{lang: b.terms[t] for lang, b in blocks.items()},
                    **{f"definition_{lang}": b.text for lang, b in blocks.items()},
                )
            )
    return terms


def _aligned_segments(entry_id: int, entries: dict[str, LangEntry]) -> list[ParallelSegment]:
    doc_id = f"{NAME}:{entry_id}"
    segs: list[ParallelSegment] = []
    n_blocks = {len(e.blocks) for e in entries.values()}
    if len(n_blocks) != 1:
        texts = {lang: " ".join(b.text for b in e.blocks) for lang, e in entries.items()}
        return [
            ParallelSegment(
                id=f"{doc_id}:doc", source=NAME, doc_id=doc_id, granularity="document", **texts
            )
        ]
    for k in range(n_blocks.pop()):
        texts = {lang: e.blocks[k].text for lang, e in entries.items()}
        sents = {lang: split_sentences(t) for lang, t in texts.items()}
        n_sents = {len(s) for s in sents.values()}
        n = min(n_sents)
        if len(n_sents) == 1 and n > 1:
            segs.extend(
                ParallelSegment(
                    id=f"{doc_id}:{k}.{j}",
                    source=NAME,
                    doc_id=doc_id,
                    granularity="sentence",
                    alignment="count",
                    **{lang: s[j] for lang, s in sents.items()},
                )
                for j in range(n)
            )
        else:
            segs.append(
                ParallelSegment(
                    id=f"{doc_id}:{k}",
                    source=NAME,
                    doc_id=doc_id,
                    granularity="sentence" if n_sents == {1} else "paragraph",
                    **texts,
                )
            )
    return segs


def collect(concurrency: int = 4) -> SourceOutput:
    fetcher = CachedFetcher(cache_dir=RAW / NAME, concurrency=concurrency)
    listing = fetcher.fetch_all_sync([LIST_URL.format(lang="fr")], desc="berner list")
    list_html = next(iter(listing.values())).text or ""
    ids = sorted({int(i) for i in re.findall(r'data-id="(\d+)"', list_html)})
    log.info("Berner: %d concept ids", len(ids))

    urls = [DEF_URL.format(id=i, lang=lang) for i in ids for lang in LANGS]
    pages = fetcher.fetch_all_sync(urls, desc="berner entries")

    terms: list[TermEntry] = []
    segments: list[ParallelSegment] = []
    for entry_id in ids:
        entries: dict[str, LangEntry] = {}
        for lang in LANGS:
            page = pages[DEF_URL.format(id=entry_id, lang=lang)]
            if page.text and (entry := parse_entry(page.text, entry_id, lang)):
                entries[lang] = entry
        if "fr" not in entries or len(entries) < 2:
            continue
        terms.extend(_aligned_terms(entry_id, entries))
        segments.extend(_aligned_segments(entry_id, entries))

    info = SourceInfo(
        name=NAME,
        title="Berner — Dictionnaire professionnel illustré de l'horlogerie (FH)",
        url=BASE,
        license="© Fédération de l'industrie horlogère suisse FH — research use only",
        notes="Concept-aligned fr/en/de dictionary; definitions and examples are translations.",
    )
    return SourceOutput(info=info, terms=terms, segments=segments)
