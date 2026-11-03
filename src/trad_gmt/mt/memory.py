"""Translation memory: BM25 retrieval of already-translated French sentences.

Two pools per target language:

* ``style`` — GMT Publishing's own translations (WorldTempus editorial articles,
  ``type:maison-*``, GMT Magazine). These carry the house voice the output must match.
* ``domain`` — FH Berner examples, FHH, Patek and brand sites (and, for German, the only
  editorial German we have). They anchor phrasing of technical passages.

Patent claims (``epo``) are excluded: their register is the opposite of magazine prose.
"""

import math
from collections.abc import Iterable, Sequence

import numpy as np
from pydantic import BaseModel
from scipy import sparse

from trad_gmt.mt.textnorm import content_tokens


class Example(BaseModel):
    fr: str
    tgt: str
    source: str
    pool: str  # "style" | "domain"
    score: float = 0.0


class BM25Index:
    """Okapi BM25 with the weighted doc×term matrix precomputed (fast column sums)."""

    def __init__(self, docs: Sequence[str], k1: float = 1.4, b: float = 0.75) -> None:
        vocab: dict[str, int] = {}
        rows: list[int] = []
        cols: list[int] = []
        for i, doc in enumerate(docs):
            for tok in content_tokens(doc):
                rows.append(i)
                cols.append(vocab.setdefault(tok, len(vocab)))
        tf = sparse.csr_matrix(
            (np.ones(len(rows), dtype=np.float32), (rows, cols)), shape=(len(docs), len(vocab))
        )
        tf.sum_duplicates()
        dl = np.asarray(tf.sum(axis=1)).ravel()
        avgdl = float(dl.mean()) if len(dl) else 1.0
        df = np.bincount(tf.indices, minlength=len(vocab))
        idf = np.log1p((len(docs) - df + 0.5) / (df + 0.5)).astype(np.float32)
        tf = tf.tocoo()
        norm = k1 * (1 - b + b * dl[tf.row] / avgdl)
        weights = tf.data * (k1 + 1) / (tf.data + norm) * idf[tf.col]
        self.matrix = sparse.csc_matrix((weights, (tf.row, tf.col)), shape=tf.shape)
        self.vocab = vocab

    def search(self, query: str, k: int) -> list[tuple[int, float]]:
        ids = sorted({self.vocab[t] for t in content_tokens(query) if t in self.vocab})
        if not ids:
            return []
        scores = np.asarray(self.matrix[:, ids].sum(axis=1)).ravel()
        k = min(k, int((scores > 0).sum()))
        if k == 0:
            return []
        top = np.argpartition(-scores, k - 1)[:k]
        return [(int(i), float(scores[i])) for i in top[np.argsort(-scores[top])]]


class MemoryPool:
    def __init__(self, name: str, examples: list[Example]) -> None:
        self.name = name
        self.examples = examples
        self.index = BM25Index([e.fr for e in examples])

    def search(self, query: str, k: int) -> list[Example]:
        return [
            self.examples[i].model_copy(update={"score": round(s, 2)})
            for i, s in self.index.search(query, k)
        ]


class TranslationMemory:
    """Per-sentence retrieval with de-duplication and a per-document budget."""

    def __init__(self, pools: dict[str, MemoryPool], per_query: dict[str, int]) -> None:
        self.pools = pools
        self.per_query = per_query

    def retrieve(self, queries: Iterable[str], budget: int = 40) -> list[Example]:
        seen: set[str] = set()
        picked: list[Example] = []
        for query in queries:
            for name, k in self.per_query.items():
                pool = self.pools.get(name)
                if pool is None:
                    continue
                added = 0
                for ex in pool.search(query, k * 3):
                    key = ex.fr.casefold()
                    if key in seen:
                        continue
                    seen.add(key)
                    picked.append(ex)
                    added += 1
                    if added == k:
                        break
        # keep the strongest matches when over budget, but always keep some house style
        if len(picked) > budget:
            style = [e for e in picked if e.pool == "style"]
            other = [e for e in picked if e.pool != "style"]
            keep_style = sorted(style, key=lambda e: -e.score)[: math.ceil(budget * 0.7)]
            keep_other = sorted(other, key=lambda e: -e.score)[: budget - len(keep_style)]
            keep = {id(e) for e in keep_style + keep_other}
            picked = [e for e in picked if id(e) in keep]
        return picked
