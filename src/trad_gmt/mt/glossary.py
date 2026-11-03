"""Termbase lookup: find the watchmaking terms of a French text and their approved targets.

Entries come from the dataset's ``terms`` config (FH Berner = priority 1, Patek 2, FHH 3,
Wikidata 4). A French designation can map to several concepts (homonyms such as
*pont* or *roue*); every candidate is kept with its source and a short definition so
the model can pick the sense that fits.
"""

import re
from collections import defaultdict
from collections.abc import Iterable

from pydantic import BaseModel

from trad_gmt.mt.textnorm import FR_STOPWORDS, fold, stem, token_spans

_PAREN = re.compile(r"\s*\([^)]*\)")
_FR_ARTICLES = frozenset({"le", "la", "les", "l", "un", "une", "des", "du", "de", "d"})
_FR_ARTICLE = re.compile(r"^(?:les?|la|l['’]|une?|des|du|d['’])\s*(?=\w)", re.I)
_TARGET_ARTICLE = re.compile(r"^(?:the|a|an|der|die|das|ein|eine)\s+(?=\w)", re.I)
_MAX_TERM_TOKENS = 8
SOURCE_LABEL: dict[str, str] = {
    "gmt": "GMT usage",
    "berner": "FH Berner",
    "patek": "Patek Philippe",
    "fhh": "FHH",
    "wikidata": "Wikidata",
}


class Target(BaseModel):
    term: str
    source: str
    priority: int
    definition: str | None = None


class GlossaryEntry(BaseModel):
    """One French designation (match key) with its candidate targets per language."""

    fr: str
    key: tuple[str, ...]
    en: list[Target] = []
    de: list[Target] = []


class Hit(BaseModel):
    surface: str  # as written in the source text
    entry: GlossaryEntry
    count: int = 1

    def targets(self, lang: str) -> list[Target]:
        return getattr(self.entry, lang)


def clean_term(term: str) -> str:
    return _PAREN.sub("", term).strip(" ,;.")


def clean_target(term: str) -> str:
    return _TARGET_ARTICLE.sub("", clean_term(term).strip('"“”«» '))


def term_key(term: str) -> tuple[str, ...]:
    """Stemmed tokens of the French designation, leading articles dropped (le cadran → cadran)."""
    key = [t for t, _, _ in token_spans(clean_term(term))]
    while len(key) > 1 and key[0] in _FR_ARTICLES:
        key.pop(0)
    return tuple(key)


class Glossary:
    def __init__(self, entries: Iterable[GlossaryEntry]) -> None:
        self.entries: dict[tuple[str, ...], GlossaryEntry] = {e.key: e for e in entries}
        self._lengths: dict[str, set[int]] = defaultdict(set)
        for key in self.entries:
            self._lengths[key[0]].add(len(key))

    def __len__(self) -> int:
        return len(self.entries)

    @classmethod
    def from_rows(
        cls, rows: Iterable[dict], generic_words: frozenset[str] = frozenset()
    ) -> "Glossary":
        """Build from ``terms`` rows; ``generic_words`` are one-word keys too common to help."""
        grouped: dict[tuple[str, ...], GlossaryEntry] = {}
        for row in rows:
            fr = row.get("fr")
            # comma lists are FHH spec sheets ("Jour/Nuit, Tourbillon volant"): unreliable pairs
            if not fr or "," in fr:
                continue
            key = term_key(fr)
            if not _usable_key(key, generic_words):
                continue
            display = _FR_ARTICLE.sub("", clean_term(fr))
            entry = grouped.setdefault(key, GlossaryEntry(fr=display, key=key))
            for lang in ("en", "de"):
                if not row.get(lang) or "," in row[lang]:
                    continue
                # an untranslated copy of the French is not a translation (Série limitée)
                if row["source"] != "gmt" and term_key(row[lang]) == key:
                    continue
                definition = row.get(f"definition_{lang}") or row.get("definition_fr")
                target = Target(
                    term=clean_target(row[lang]),
                    source=row["source"],
                    priority=9 if row.get("priority") is None else int(row["priority"]),
                    definition=_short(definition),
                )
                targets: list[Target] = getattr(entry, lang)
                if not any(t.term.casefold() == target.term.casefold() for t in targets):
                    targets.append(target)
        for entry in grouped.values():
            for lang in ("en", "de"):
                setattr(entry, lang, _rank(getattr(entry, lang)))
        return cls(e for e in grouped.values() if e.en or e.de)

    def find(self, text: str, lang: str, limit: int = 150) -> list[Hit]:
        """Greedy longest-match of glossary keys in ``text``; entries lacking ``lang`` skipped."""
        spans = token_spans(text)
        toks = [t for t, _, _ in spans]
        hits: dict[tuple[str, ...], Hit] = {}
        i = 0
        while i < len(toks):
            matched = 0
            for n in sorted(self._lengths.get(toks[i], ()), reverse=True):
                key = tuple(toks[i : i + n])
                entry = self.entries.get(key)
                if len(key) == n and entry is not None and getattr(entry, lang):
                    surface = text[spans[i][1] : spans[i + n - 1][2]]
                    if key in hits:
                        hits[key].count += 1
                    else:
                        hits[key] = Hit(surface=surface, entry=entry)
                    matched = n
                    break
            i += matched or 1
        ranked = sorted(
            hits.values(),
            key=lambda h: (-len(h.entry.key), h.targets(lang)[0].priority, h.entry.fr),
        )
        return ranked[:limit]


def _rank(targets: list[Target]) -> list[Target]:
    """Priority order (GMT usage 0, Berner 1, …); when GMT usage or FH Berner covers the
    term, drop the less reliable FHH / Wikidata candidates."""
    targets = sorted(targets, key=lambda t: t.priority)
    if targets and targets[0].priority <= 1:
        targets = [t for t in targets if t.priority <= 2]
    return targets


def _usable_key(key: tuple[str, ...], generic_words: frozenset[str]) -> bool:
    if not key or len(key) > _MAX_TERM_TOKENS:
        return False
    if len(key) == 1:
        word = key[0]
        return len(word) > 2 and word not in FR_STOPWORDS and word not in generic_words
    return True


def _short(text: str | None, max_chars: int = 140) -> str | None:
    if not text:
        return None
    text = " ".join(text.split())
    return text if len(text) <= max_chars else text[: max_chars - 1].rsplit(" ", 1)[0] + "…"


def generic_words_from(sentences: Iterable[str], max_df: float = 0.015) -> frozenset[str]:
    """Words present in more than ``max_df`` of French sentences (montre, temps, heure…)."""
    df: dict[str, int] = defaultdict(int)
    n = 0
    for s in sentences:
        n += 1
        for tok in {stem(m) for m in re.findall(r"[a-z0-9œæ]+", fold(s))}:
            df[tok] += 1
    return frozenset(t for t, c in df.items() if c / max(n, 1) > max_df)
