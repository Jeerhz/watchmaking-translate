"""GMT Magazine PDFs: the French and German editions, each printed with the English beside it.

Every issue exists as a French edition (French + English) and a German edition (German +
the same English), page for page. French and German are aligned page by page; English, which
an article may print on the facing page, is aligned within a window of neighbouring pages.
Rows are GMT's own translations: the first GMT German, and more GMT Magazine English.
"""

import logging
import re
from collections import Counter
from pathlib import Path

from pydantic import BaseModel
from tqdm import tqdm

from trad_gmt.align import SentenceAligner
from trad_gmt.io import SourceOutput
from trad_gmt.schemas import ParallelSegment, SourceInfo
from trad_gmt.sources.common import align_document
from trad_gmt.text import guess_lang

log = logging.getLogger(__name__)

NAME = "gmt"
PDF_DIR = Path.home() / "Downloads" / "transfer-01a1d040"
EN_WINDOW = 1  # English looked up on pages p-1 … p+1 of the French edition


class Issue(BaseModel):
    label: str
    fr: Path
    de: Path


def issues(pdf_dir: Path = PDF_DIR) -> list[Issue]:
    """Pair the French and German PDFs of each issue by their number (or WEB / Lady label)."""
    by_key: dict[str, dict[str, Path]] = {}
    for p in sorted(pdf_dir.glob("*.pdf")):
        lang = (
            "fr"
            if re.search(r"[_ ]FR[_ -]", p.name)
            else "de"
            if re.search(r"[_ ]DE[_ -]", p.name)
            else None
        )
        num = re.search(
            r"(\d{2,3})", p.name.replace("150", "").replace("300", "").replace("2025", "")
        )
        key = num.group(1) if num else "web-2025-03"
        if lang:
            by_key.setdefault(key, {})[lang] = p
    return [
        Issue(label=k, fr=v["fr"], de=v["de"]) for k, v in sorted(by_key.items()) if len(v) == 2
    ]


def _clean(text: str) -> str:
    text = text.replace("­", "")
    return re.sub(r"(?m)^\s*([A-ZÀ-ÝÄÖÜ])\s*\n\s*(?=[a-zà-ÿäöüß])", r"\1", text)  # drop capitals


def _dehyphenate(text: str, vocab: Counter[str]) -> str:
    """Join words split at a line end, keeping the hyphen when the corpus spells it hyphenated."""

    def join(m: re.Match[str]) -> str:
        a, b = m.group(1), m.group(2)
        whole, hyph = (a + b).lower(), f"{a}-{b}".lower()
        return f"{a}-{b}" if vocab[hyph] > vocab[whole] else a + b

    return re.sub(r"(\w+)-\s*\n\s*(\w+)", join, text)


def _restore_capital(
    t: str, x: float, y: float, caps: list[tuple[float, float, str]], vocab: Counter[str]
) -> str:
    """Put back a drop capital: the nearest separate capital block, else the letter the
    corpus vocabulary suggests ("haque" → "Chaque") when the cap is a graphic."""
    word = re.match(r"\w+", t)
    if word is None or vocab[word.group().lower()] > 2:
        return t
    near = sorted((abs(y - cy) + abs(x - cx) / 4, c) for cx, cy, c in caps if abs(y - cy) < 130)
    rest = word.group().lower()
    best = max("abcdefghijklmnopqrstuvwxyzéàäöü", key=lambda c: vocab[c + rest])
    if near and vocab[near[0][1].lower() + rest] >= vocab[best + rest]:
        best = near[0][1].lower()
    return best.upper() + t if vocab[best + rest] else t


def _blocks(page, vocab: Counter[str]) -> list[tuple[float, float, str]]:  # noqa: ANN001 - pymupdf page
    """Readable text blocks as (x0, y0, text), drop capitals re-attached, garbage removed."""
    raw = [(b[0], b[1], b[4]) for b in page.get_text("blocks") if b[6] == 0]
    # a block may hold both languages of a paragraph, separated by a `` mark
    raw = [(x, y, part) for x, y, t in raw for part in t.split("``") if part.strip()]
    caps = [(x, y, t.strip()) for x, y, t in raw if re.fullmatch(r"[A-ZÀ-ÝÄÖÜ]", t.strip())]
    out: list[tuple[float, float, str]] = []
    for x, y, t in raw:
        t = _clean(t).lstrip()
        if sum(c.isprintable() or c == "\n" for c in t) < 0.9 * len(t):
            continue
        if re.fullmatch(r"\s*[A-ZÀ-ÝÄÖÜ]\s*", t):
            continue
        if t[:1].islower():  # an article's first word, its drop capital set apart
            t = _restore_capital(t, x, y, caps, vocab)
        out.append((x, y, _dehyphenate(t, vocab)))
    width = page.rect.width
    return sorted(out, key=lambda b: (int(b[0] // (width / 4)), b[1]))


def _paragraphs(blocks: list[tuple[float, float, str]], lang: str) -> list[str]:
    paras = []
    for _, _, t in blocks:
        t = re.sub(r"\s+", " ", t).strip()
        if len(t.split()) >= 6 and guess_lang(t) == lang:
            paras.append(t)
    return paras


MIN_SCORE = 0.70  # page-level alignment is noisier than article-level: stricter than the aligner
_SPLIT = re.compile(r"(\w+)- (?!(?:und|oder|bzw|sowie|bis|et|ou|and|or|to)\b)([a-zà-ÿäöüß]\w*)")
_START = re.compile(r"[A-ZÀ-ÝÄÖÜ0-9«“‘\"'(]")
_END = re.compile(r"[.!?…»”\"’)]\s*$")


def _join_splits(text: str, vocab: Counter[str]) -> str:
    """Words split across two text blocks ("unse- re"): rejoin unless the corpus hyphenates them."""

    def join(m: re.Match[str]) -> str:
        a, b = m.group(1), m.group(2)
        return f"{a}-{b}" if vocab[f"{a}-{b}".lower()] > vocab[(a + b).lower()] else a + b

    return _SPLIT.sub(join, text)


def _usable(fr: str, tgt: str, score: float | None) -> bool:
    """Whole sentences on both sides, no merged columns or glyph garbage, plausible lengths."""
    if score is None or score < MIN_SCORE:
        return False
    for t in (fr, tgt):
        if re.search(r"\s{3,}", t) or not _START.match(t.strip()) or not _END.search(t):
            return False
        if sum(c.isalpha() for c in t) < 0.7 * sum(not c.isspace() for c in t):
            return False
    a, b = len(fr), len(tgt)
    return max(a, b) / max(1, min(a, b)) <= 1.6


def polish(seg: ParallelSegment, vocab: Counter[str]) -> ParallelSegment | None:
    """Clean a magazine segment: rejoin split words, drop unusable targets; None if none left."""
    fr = _join_splits(seg.fr or "", vocab)
    update: dict[str, str | float | None] = {"fr": re.sub(r"\s+", " ", fr).strip()}
    for lang in ("en", "de"):
        t = getattr(seg, lang)
        t = _join_splits(t, vocab) if t else None
        ok = t is not None and _usable(fr, t, getattr(seg, f"score_{lang}"))
        update[lang] = re.sub(r"\s+", " ", t).strip() if ok and t else None
        if not ok:
            update[f"score_{lang}"] = None
    return seg.model_copy(update=update) if update["en"] or update["de"] else None


def _vocab(docs: list) -> Counter[str]:  # noqa: ANN001 - pymupdf documents
    words: Counter[str] = Counter()
    for d in docs:
        for page in d:
            words.update(w.lower() for w in re.findall(r"\w+(?:-\w+)*", page.get_text()))
    return words


def collect(pdf_dir: Path = PDF_DIR) -> SourceOutput:
    import pymupdf

    aligner = SentenceAligner()
    segments: list[ParallelSegment] = []
    for issue in issues(pdf_dir):
        fr_doc, de_doc = pymupdf.open(issue.fr), pymupdf.open(issue.de)
        vocab = _vocab([fr_doc, de_doc])
        fr_pages = [_blocks(p, vocab) for p in fr_doc]
        de_pages = [_blocks(p, vocab) for p in de_doc]
        en_pages = [_paragraphs(b, "en") for b in fr_pages]
        for p in tqdm(range(min(len(fr_pages), len(de_pages))), desc=f"GMT {issue.label}"):
            fr = _paragraphs(fr_pages[p], "fr")
            if not fr:
                continue
            window = range(max(0, p - EN_WINDOW), min(len(en_pages), p + EN_WINDOW + 1))
            paragraphs = {
                "fr": [" ".join(fr)],
                "de": [" ".join(_paragraphs(de_pages[p], "de"))],
                "en": [" ".join(x for q in window for x in en_pages[q])],
            }
            paragraphs = {k: v for k, v in paragraphs.items() if v[0]}
            aligned = align_document(
                NAME,
                f"{NAME}:{issue.label}:p{p + 1}",
                paragraphs,
                aligner,
                tags=["folder:GMT Magazine", "type:magazine", f"issue:{issue.label}"],
            )
            segments += [s for s in (polish(a, vocab) for a in aligned) if s]
            aligner.clear_cache()
        log.info("GMT %s: %d segments so far", issue.label, len(segments))
    info = SourceInfo(
        name=NAME,
        title="GMT Magazine — French and German editions (each with the English text), PDFs",
        url="https://gmtpublishing.com/en/our-brands/gmt-magazine-en/",
        license="© GMT Publishing — internal use only",
        notes="Text layer of the print PDFs; FR↔DE page by page, FR↔EN within ±1 page; LaBSE.",
    )
    return SourceOutput(info=info, segments=segments)
