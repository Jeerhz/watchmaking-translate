"""Text normalisation and lightweight multilingual sentence splitting."""

import re
import unicodedata

from selectolax.lexbor import LexborNode as Node

SUPERSCRIPTS = str.maketrans("0123456789+-=()n", "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿ")
SUBSCRIPTS = str.maketrans("0123456789+-=()n", "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₙ")

# Abbreviations after which a period does not end a sentence (fr / en / de).
ABBREVIATIONS: frozenset[str] = frozenset(
    {
        # fr
        "p.ex",
        "ex",
        "env",
        "cf",
        "etc",
        "av",
        "apr",
        "J.-C",
        "chap",
        "fig",
        "vol",
        "réf",
        "M",
        "MM",
        "Mme",
        "Mlle",
        "Dr",
        "St",
        "Ste",
        "No",
        "n°",
        "resp",
        "max",
        "min",
        "approx",
        # en
        "e.g",
        "i.e",
        "vs",
        "Mr",
        "Mrs",
        "Ms",
        "Prof",
        "Inc",
        "Ltd",
        "Co",
        "Nos",
        "ca",
        # de
        "z.B",
        "d.h",
        "u.a",
        "usw",
        "bzw",
        "vgl",
        "Nr",
        "Abb",
        "evtl",
        "ggf",
        "inkl",
        "sog",
        "u.ä",
        "z.T",
        "s.u",
        "s.o",
        "Jh",
        "Chr",
        "v",
        "n",
    }
)

_SPACES = re.compile(r"[ \t   ]+")
_SENT_END = re.compile(r"([.!?…](?:\s?[\"»”’)])*)\s+(?=(?:[\"«“‘(\[]\s?)?[A-ZÀ-ÖØ-ÞŒ0-9])")


def normalize(text: str) -> str:
    """NFC, unify whitespace (keeps French narrow no-break spaces out), strip."""
    text = unicodedata.normalize("NFC", text)
    text = text.replace("­", "")  # soft hyphen
    text = _SPACES.sub(" ", text)
    return text.strip()


def node_text(node: Node) -> str:
    """Flatten an HTML node to text, rendering <sup>/<sub> and dropping images."""
    for img in node.css("img"):
        img.decompose()
    for sup in node.css("sup"):
        sup.replace_with((sup.text() or "").translate(SUPERSCRIPTS))
    for sub in node.css("sub"):
        sub.replace_with((sub.text() or "").translate(SUBSCRIPTS))
    for br in node.css("br"):
        br.replace_with("\n")
    return node.text(separator="", strip=False)


def _is_abbreviation(chunk: str) -> bool:
    last = chunk.rstrip().rsplit(" ", 1)[-1].rstrip(".")
    last = last.lstrip('([«"')
    return last in ABBREVIATIONS or (len(last) == 1 and last.isalpha())


def split_sentences(text: str) -> list[str]:
    """Split a paragraph into sentences, protecting common fr/en/de abbreviations."""
    text = normalize(text)
    if not text:
        return []
    pieces: list[str] = []
    start = 0
    for match in _SENT_END.finditer(text):
        candidate = text[start : match.end(1)]
        if _is_abbreviation(candidate.rstrip('"»”’) ')):
            continue
        pieces.append(candidate.strip())
        start = match.end()
    pieces.append(text[start:].strip())
    return [p for p in pieces if p]


_FUNCTION_WORDS: dict[str, frozenset[str]] = {
    "fr": frozenset(
        "le la les un une des du de et est en dans pour par sur avec qui que au aux ce cette "
        "ses son sa il elle ne pas plus".split()
    ),
    "en": frozenset(
        "the a an of and is in to for by on with which that this its it are was be as from "
        "or at".split()
    ),
    "de": frozenset(
        "der die das ein eine und ist in zu für mit von den dem des sich auf im nicht auch "
        "als wird werden".split()
    ),
}
_WORD = re.compile(r"[a-zà-öø-ÿœß]+")


def guess_lang(text: str, min_words: int = 6) -> str | None:
    """Cheap fr/en/de identification from function words; None when too short/unsure."""
    words = _WORD.findall(text.lower())
    if len(words) < min_words:
        return None
    counts = {lang: sum(w in fw for w in words) for lang, fw in _FUNCTION_WORDS.items()}
    best = max(counts, key=counts.__getitem__)
    ranked = sorted(counts.values(), reverse=True)
    return best if ranked[0] >= 2 and ranked[0] > ranked[1] else None
