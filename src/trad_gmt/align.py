"""Embedding-based sentence alignment (vecalign/bertalign-style monotonic DP).

Used for documents whose translations are not unit-aligned at the source
(brand articles, FHH library, and later the GMT magazines). Sentences are
embedded with LaBSE; a dynamic programme finds the best monotonic path allowing
1-1, 1-2, 2-1, 1-0 and 0-1 links. Three-way rows are obtained by pivoting on
identical French spans of the fr→en and fr→de alignments.
"""

import logging
from functools import cached_property

import numpy as np
from pydantic import BaseModel, ConfigDict, PrivateAttr

log = logging.getLogger(__name__)

MOVES: tuple[tuple[int, int], ...] = ((1, 1), (1, 2), (2, 1), (1, 0), (0, 1))


class Link(BaseModel):
    """src[src_start:src_end] ↔ tgt[tgt_start:tgt_end] with its cosine similarity."""

    src_start: int
    src_end: int
    tgt_start: int
    tgt_end: int
    score: float


class PivotLink(BaseModel):
    """A French span with its aligned translation span in each target language."""

    fr: str
    targets: dict[str, str] = {}
    scores: dict[str, float] = {}


class SentenceAligner(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    model_name: str = "sentence-transformers/LaBSE"
    match_offset: float = 0.35  # a link must beat this similarity to be preferred to a skip
    many_penalty: float = 0.04  # small cost on 1-2 / 2-1 links
    min_score: float = 0.55  # links below this are discarded from the output
    batch_size: int = 64

    _cache: dict[str, np.ndarray] = PrivateAttr(default_factory=dict)

    @cached_property
    def model(self):  # noqa: ANN201 - SentenceTransformer, imported lazily (torch is heavy)
        from sentence_transformers import SentenceTransformer

        log.info("loading %s", self.model_name)
        return SentenceTransformer(self.model_name)

    def embed(self, texts: list[str]) -> np.ndarray:
        """Normalised embeddings, memoised so a document can be warmed in one batch."""
        missing = list(dict.fromkeys(t for t in texts if t not in self._cache))
        if missing:
            vecs = self.model.encode(
                missing,
                batch_size=self.batch_size,
                normalize_embeddings=True,
                show_progress_bar=False,
            )
            self._cache.update(zip(missing, np.asarray(vecs), strict=True))
        if not texts:
            return np.zeros((0, 768), dtype=np.float32)
        return np.stack([self._cache[t] for t in texts])

    @staticmethod
    def span_texts(sents: list[str]) -> list[str]:
        """Every text the DP may embed for a sentence list: singles + adjacent pairs."""
        return sents + [f"{a} {b}" for a, b in zip(sents, sents[1:], strict=False)]

    def warm(self, sentence_lists: list[list[str]]) -> None:
        self.embed([t for sents in sentence_lists for t in self.span_texts(sents)])

    def clear_cache(self) -> None:
        self._cache.clear()

    def _span_embeddings(self, sents: list[str]) -> tuple[np.ndarray, np.ndarray]:
        singles = self.embed(sents)
        pairs = self.embed([f"{a} {b}" for a, b in zip(sents, sents[1:], strict=False)])
        return singles, pairs

    def align(self, src: list[str], tgt: list[str]) -> list[Link]:
        n, m = len(src), len(tgt)
        if n == 0 or m == 0:
            return []
        s1, s2 = self._span_embeddings(src)
        t1, t2 = self._span_embeddings(tgt)

        def span(e1: np.ndarray, e2: np.ndarray, start: int, k: int) -> np.ndarray:
            return e1[start] if k == 1 else e2[start]

        neg = -1e9
        dp = np.full((n + 1, m + 1), neg)
        back = np.zeros((n + 1, m + 1, 3))
        dp[0, 0] = 0.0
        for i in range(n + 1):
            for j in range(m + 1):
                if dp[i, j] == neg:
                    continue
                for a, b in MOVES:
                    ni, nj = i + a, j + b
                    if ni > n or nj > m:
                        continue
                    if a and b:
                        sim = float(span(s1, s2, i, a) @ span(t1, t2, j, b))
                        gain = sim - self.match_offset - (self.many_penalty if a + b > 2 else 0)
                    else:
                        sim, gain = 0.0, 0.0
                    if dp[i, j] + gain > dp[ni, nj]:
                        dp[ni, nj] = dp[i, j] + gain
                        back[ni, nj] = (a, b, sim)
        links: list[Link] = []
        i, j = n, m
        while i > 0 or j > 0:
            a, b, sim = back[i, j]
            a, b = int(a), int(b)
            if a and b and sim >= self.min_score:
                links.append(
                    Link(src_start=i - a, src_end=i, tgt_start=j - b, tgt_end=j, score=sim)
                )
            i, j = i - a, j - b
        return links[::-1]

    def align_pivot(self, fr: list[str], targets: dict[str, list[str]]) -> list[PivotLink]:
        """Align fr→each target, then merge links that share the same French span."""
        per_lang = {
            lang: {(lk.src_start, lk.src_end): lk for lk in self.align(fr, sents)}
            for lang, sents in targets.items()
        }
        keys = sorted({k for links in per_lang.values() for k in links})
        rows: list[PivotLink] = []
        for start, end in keys:
            row = PivotLink(fr=" ".join(fr[start:end]))
            for lang, links in per_lang.items():
                if (lk := links.get((start, end))) is not None:
                    row.targets[lang] = " ".join(targets[lang][lk.tgt_start : lk.tgt_end])
                    row.scores[lang] = round(lk.score, 4)
            rows.append(row)
        return rows

    def match_bijective(self, a: list[str], b: list[str]) -> list[tuple[int, int, float]]:
        """Optimal one-to-one matching of two unordered lists (e.g. glossary definitions)."""
        from scipy.optimize import linear_sum_assignment

        sim = self.embed(a) @ self.embed(b).T
        rows, cols = linear_sum_assignment(-sim)
        return [(int(r), int(c), float(sim[r, c])) for r, c in zip(rows, cols, strict=True)]
