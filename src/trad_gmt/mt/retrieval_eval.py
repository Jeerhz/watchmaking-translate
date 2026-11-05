"""Model-free comparison of example-retrieval methods: BM25, dense embeddings, hybrid.

Each held-out French sentence (``test`` split, so its article is not in the memory) is used
as a query against the ``train`` memory pools. What a retrieved example is worth to the
translator is what its *target side* contributes, so the main metrics compare the union of
the top-k retrieved targets with the published reference translation of the query:

* ``tgt_uni`` / ``tgt_bi`` — recall of the reference's content unigrams / bigrams
  (lower-cased, function words removed): how much of the wording the model needs is shown.
* ``terms`` — share of the query's multi-word glossary terms whose approved equivalent
  appears in a retrieved target: does the evidence show the terminology in context?
* ``src_bi`` — French bigram coverage of the query, the classic n-gram coverage signal.

Methods: ``bm25`` (the production index), ``dense`` (cosine on normalised embeddings),
``hybrid`` (reciprocal-rank fusion of both), ``bm25>dense`` (BM25 top-50 re-ranked by
cosine). No model call is made, so the experiment is free to re-run.
"""

import json
import logging
import re
from collections.abc import Callable, Sequence
from pathlib import Path

import numpy as np
import pandas as pd
from pydantic import BaseModel

from trad_gmt.io import DATA
from trad_gmt.mt.memory import BM25Index
from trad_gmt.mt.resources import (
    ResourceConfig,
    build_resources,
    load_segments,
    select_pool,
)
from trad_gmt.mt.textnorm import content_tokens

log = logging.getLogger(__name__)

EMB_DIR = DATA / "index" / "emb"
_WORD = re.compile(r"[^\W\d_]{3,}", re.UNICODE)
_STOP_TGT = frozenset(
    """the and for with its this that from are was has have which their into been also
    more than but not all one can will when where while who whose our your his her they
    them these those there what after before over under about between through der die das
    und mit von den dem des ein eine einer eines einem ist sich auf für bei aus wird sind
    nicht auch als wie oder zum zur durch nach über unter ihre ihr sein seine dieser diese
    dieses""".split()
)


class RetrievalEvalConfig(BaseModel):
    pools: list[str] = ["en/style", "en/domain", "de/domain"]
    n_queries: int = 600
    k: int = 3
    rrf_k: int = 60
    rerank_depth: int = 50
    model_name: str = "intfloat/multilingual-e5-small"
    seed: int = 0
    out: Path = DATA / "eval" / "retrieval.json"


class Embedder:
    """Sentence embeddings with an on-disk cache per (model, pool)."""

    def __init__(self, model_name: str) -> None:
        from sentence_transformers import SentenceTransformer

        self.name = model_name
        self.model = SentenceTransformer(model_name)
        # e5 models expect a prefix; "query: " is the symmetric-similarity setting
        self.prefix = "query: " if "e5" in model_name else ""

    def encode(self, texts: Sequence[str], cache: Path | None = None) -> np.ndarray:
        if cache is not None and cache.exists():
            arr = np.load(cache)
            if len(arr) == len(texts):
                return arr
        vecs = self.model.encode(
            [self.prefix + t for t in texts],
            batch_size=128,
            normalize_embeddings=True,
            show_progress_bar=len(texts) > 5000,
            convert_to_numpy=True,
        ).astype(np.float16)
        if cache is not None:
            cache.parent.mkdir(parents=True, exist_ok=True)
            np.save(cache, vecs)
        return vecs


def target_ngrams(text: str) -> tuple[set[str], set[str]]:
    words = [w for w in _WORD.findall(text.casefold()) if w not in _STOP_TGT]
    return set(words), {f"{a} {b}" for a, b in zip(words, words[1:], strict=False)}


def source_bigrams(text: str) -> set[str]:
    toks = content_tokens(text)
    return {f"{a} {b}" for a, b in zip(toks, toks[1:], strict=False)}


def _recall(ref: set[str], got: set[str]) -> float | None:
    return len(ref & got) / len(ref) if ref else None


def rrf(rankings: Sequence[Sequence[int]], k: int, depth: int) -> list[int]:
    scores: dict[int, float] = {}
    for ranking in rankings:
        for rank, doc in enumerate(ranking):
            scores[doc] = scores.get(doc, 0.0) + 1.0 / (k + rank + 1)
    return sorted(scores, key=lambda d: -scores[d])[:depth]


def dense_topk(query: np.ndarray, matrix: np.ndarray, k: int) -> list[int]:
    sims = matrix @ query
    top = np.argpartition(-sims, k - 1)[:k]
    return [int(i) for i in top[np.argsort(-sims[top])]]


def evaluate_pool(
    lang: str,
    pool: str,
    cfg: RetrievalEvalConfig,
    embedder: Embedder,
    glossary_find: Callable[[str, str], list],
) -> dict:
    res_cfg = ResourceConfig()
    memory = select_pool(load_segments(res_cfg, "train"), lang, pool, res_cfg).reset_index()
    queries = select_pool(load_segments(res_cfg, "test"), lang, pool, res_cfg)
    queries = queries.sample(min(cfg.n_queries, len(queries)), random_state=cfg.seed)
    log.info("%s/%s: %d queries against %d memory sentences", lang, pool, len(queries), len(memory))

    bm25 = BM25Index(memory.fr.tolist())
    tag = cfg.model_name.split("/")[-1]
    mem_vecs = embedder.encode(memory.fr.tolist(), EMB_DIR / f"{tag}-{lang}-{pool}.npy")
    q_vecs = embedder.encode(queries.fr.tolist())

    methods: dict[str, Callable[[str, np.ndarray], list[int]]] = {
        "bm25": lambda q, v: [i for i, _ in bm25.search(q, cfg.k)],
        "dense": lambda q, v: dense_topk(v, mem_vecs, cfg.k),
        "hybrid": lambda q, v: rrf(
            [
                [i for i, _ in bm25.search(q, cfg.rerank_depth)],
                dense_topk(v, mem_vecs, cfg.rerank_depth),
            ],
            cfg.rrf_k,
            cfg.k,
        ),
        "bm25>dense": lambda q, v: _rerank(
            [i for i, _ in bm25.search(q, cfg.rerank_depth)], v, mem_vecs, cfg.k
        ),
    }
    rows: list[dict] = []
    for (q, ref), vec in zip(zip(queries.fr, queries[lang], strict=True), q_vecs, strict=True):
        ref_uni, ref_bi = target_ngrams(ref)
        q_bi = source_bigrams(q)
        terms = [h for h in glossary_find(q, lang) if len(h.entry.key) > 1]
        for name, fn in methods.items():
            ids = fn(q, vec.astype(np.float32))
            tgt = " ".join(memory[lang].iloc[ids]) if ids else ""
            src = " ".join(memory.fr.iloc[ids]) if ids else ""
            got_uni, got_bi = target_ngrams(tgt)
            low = tgt.casefold()
            rows.append(
                {
                    "method": name,
                    "tgt_uni": _recall(ref_uni, got_uni),
                    "tgt_bi": _recall(ref_bi, got_bi),
                    "src_bi": _recall(q_bi, source_bigrams(src)),
                    "terms": (
                        sum(any(t.term.casefold() in low for t in h.targets(lang)) for h in terms)
                        / len(terms)
                        if terms
                        else None
                    ),
                    "exact": float(any(memory.fr.iloc[i].casefold() == q.casefold() for i in ids)),
                }
            )
    df = pd.DataFrame(rows)
    summary = df.groupby("method").mean(numeric_only=True).round(4)
    return {
        "pool": f"{lang}/{pool}",
        "memory_size": len(memory),
        "queries": len(queries),
        "k": cfg.k,
        "model": cfg.model_name,
        "results": summary.reset_index().to_dict("records"),
    }


def _rerank(candidates: list[int], query: np.ndarray, matrix: np.ndarray, k: int) -> list[int]:
    if not candidates:
        return []
    sims = matrix[candidates] @ query
    return [candidates[i] for i in np.argsort(-sims)[:k]]


def run(cfg: RetrievalEvalConfig | None = None) -> list[dict]:
    cfg = cfg or RetrievalEvalConfig()
    glossary = build_resources(ResourceConfig()).glossary
    embedder = Embedder(cfg.model_name)
    reports = []
    for spec in cfg.pools:
        lang, pool = spec.split("/")
        reports.append(evaluate_pool(lang, pool, cfg, embedder, glossary.find))
        log.info("%s", json.dumps(reports[-1], indent=1))
    cfg.out.parent.mkdir(parents=True, exist_ok=True)
    existing = json.loads(cfg.out.read_text()) if cfg.out.exists() else []
    keep = [r for r in existing if r.get("model") != cfg.model_name]
    cfg.out.write_text(json.dumps(keep + reports, indent=2), encoding="utf-8")
    return reports
