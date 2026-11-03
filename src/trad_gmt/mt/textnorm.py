"""French matching normalisation shared by the glossary matcher and the memory index.

The rules are deliberately simple so the web demo (``web/app.js``) can mirror them
exactly: per-character accent folding (keeps string offsets), lower-casing,
alphanumeric tokens (elisions such as ``l'`` split off), and a light plural stemmer.
"""

import re
import unicodedata
from functools import lru_cache

_TOKEN = re.compile(r"[a-z0-9œæ]+")

# Function words ignored by retrieval and never matched as one-word glossary terms.
FR_STOPWORDS: frozenset[str] = frozenset(
    """a afin ai ainsi alors au aucun aussi autre aux avant avec avoir c ca car ce ceci cela
    celle celles celui ces cet cette chaque chez comme comment d dans de des deja depuis donc
    dont du elle elles en encore entre est et etait etre eux fait faire ici il ils j je jusqu l
    la le les leur leurs lui m ma mais me meme mes moi moins mon n ne ni non nos notre nous on
    ont ou par parce pas peu peut plus pour pourquoi qu quand que quel quelle quelles quels qui
    s sa sans se ses si sien son sont sous sur t ta te tes toi ton toujours tous tout toute
    toutes tres tu un une unes uns vers via vos votre vous y""".split()
)


@lru_cache(maxsize=4096)
def _fold_char(ch: str) -> str:
    base = unicodedata.normalize("NFD", ch)[0].lower()
    return base if len(base) == 1 else ch


def fold(text: str) -> str:
    """Accent-fold and lower-case, one output character per input character."""
    return "".join(_fold_char(c) for c in text.replace("’", "'"))


def stem(token: str) -> str:
    """Strip French plural marks: cristaux→cristal, aiguilles→aiguille, prix→pri."""
    if len(token) > 4 and token.endswith("aux"):
        return token[:-3] + "al"
    if len(token) > 3 and token[-1] in "sx" and not token.endswith("ss"):
        return token[:-1]
    return token


def tokens(text: str) -> list[str]:
    return [stem(m.group()) for m in _TOKEN.finditer(fold(text))]


def token_spans(text: str) -> list[tuple[str, int, int]]:
    """Stemmed tokens with their character offsets in ``text``."""
    return [(stem(m.group()), m.start(), m.end()) for m in _TOKEN.finditer(fold(text))]


def content_tokens(text: str) -> list[str]:
    """Stemmed tokens minus function words (checked before stemming: nous, dans, plus)."""
    return [
        stem(t)
        for m in _TOKEN.finditer(fold(text))
        if (t := m.group()) not in FR_STOPWORDS and len(t) > 1
    ]
