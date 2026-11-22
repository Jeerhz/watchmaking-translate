"""Score system outputs on a test.jsonl: chrF++, BLEU, glossary-term accuracy, neural metrics.

usage: python score.py --test test.jsonl --sys name=path.jsonl [--sys ...] --out scores.json
           [--common] [--metrics comet22,metricx24,...] [--terms-only] [--limit N]

Run with (no project env needed; --terms-only needs neither torch nor comet):
  uv run --no-project --python 3.11 --with 'unbabel-comet>=2.2' --with sacrebleu \
      --with 'setuptools<81' --with simplemma python cluster/score.py ...

Term accuracy — share of the passage's glossary terms (those the reference uses, the same
terms the fine-tuned model sees as hints) found in the output; each term counts at most once
per passage. Four figures are reported:
  terms               exact: accent-folded target is a substring of the output (the figure in
                      all tables before November 2026; note it is a substring test, so "red"
                      is found in "hundred").
  terms_lemma         WMT25 terminology-task rule: exact OR the lemmatised term matches the
                      lemmatised output, word by word, lower-cased (simplemma; ß = ss).
  terms_compound      terms_lemma OR, in German, the term's last word is the head of a
                      compound in the output ("Kaliber" in "Automatikkalibers").
  terms_lemma_strict  lemma match on word boundaries only, without the substring rule.

Metrics (--metrics, comma list; default comet22; "none" = same as --terms-only):
  comet22       Unbabel/wmt22-comet-da, reference-based, x100, higher is better
  cometkiwi22   Unbabel/wmt22-cometkiwi-da, reference-free (QE), x100, higher is better
  metricx24     google/metricx-24-hybrid-large-v2p6 with reference; MQM-style error score
                0-25, LOWER is better, reported as is
  metricx24-qe  same model without the reference (QE); 0-25, lower is better
  xcomet        Unbabel/XCOMET-XL with reference, x100, higher is better; error spans kept
                per segment. Gated on Hugging Face (accept the licence on the model page).
  xcomet-qe     same model without the reference (QE)
"""

import argparse
import json
import re
import unicodedata
from collections import defaultdict
from collections.abc import Callable
from functools import cache
from pathlib import Path

import sacrebleu

METRICS = ["comet22", "cometkiwi22", "metricx24", "metricx24-qe", "xcomet", "xcomet-qe"]
QE_METRICS = ["cometkiwi22", "metricx24-qe", "xcomet-qe"]
LOWER_IS_BETTER = {"metricx24", "metricx24-qe"}
MODELS = {
    "comet22": "Unbabel/wmt22-comet-da",
    "cometkiwi22": "Unbabel/wmt22-cometkiwi-da",
    "metricx24": "google/metricx-24-hybrid-large-v2p6",
    "xcomet": "Unbabel/XCOMET-XL",
}
# MetricX-24 (github.com/google-research/metricx, metricx24/): mT5 whose regression output is
# the logit of <extra_id_10> at the first decoder step, clipped to [0, 25].
METRICX_TOKENIZER = "google/mt5-xl"
METRICX_MAX_LENGTH = 1536
METRICX_SCORE_TOKEN = 250089
COMPOUND_HEAD_MIN = 4

Segment = dict[str, str]  # {"src", "mt", "ref"}
Spans = list[dict[str, object]]


# --- term accuracy -------------------------------------------------------------------------


def fold(s: str) -> str:
    s = unicodedata.normalize("NFKD", s.lower().replace("’", "'").replace("ß", "ss"))
    return "".join(c for c in s if not unicodedata.combining(c))


@cache
def token_keys(token: str, lang: str) -> frozenset[str]:
    """Folded surface form and lemma(s) of one word; two words match if their keys meet."""
    import simplemma

    forms = {token, token.lower()}
    return frozenset(fold(f) for t in forms for f in (t, simplemma.lemmatize(t, lang=lang)))


def text_keys(text: str, lang: str) -> list[frozenset[str]]:
    return [token_keys(t, lang) for t in re.findall(r"\w+", text)]


def find_term(term: list[frozenset[str]], hyp: list[frozenset[str]], compound: bool) -> bool:
    """Is the term a contiguous word sequence of the output (lemma-wise)? With `compound`,
    the term's last word may also be the head (ending) of a longer output word."""

    def last_ok(t: frozenset[str], h: frozenset[str]) -> bool:
        if t & h:
            return True
        return compound and any(
            len(a) >= COMPOUND_HEAD_MIN and len(b) > len(a) and b.endswith(a) for a in t for b in h
        )

    n = len(term)
    return n > 0 and any(
        all(term[k] & hyp[j + k] for k in range(n - 1)) and last_ok(term[-1], hyp[j + n - 1])
        for j in range(len(hyp) - n + 1)
    )


def term_hits(hyp: str, terms: list[str], lang: str) -> list[dict[str, bool]]:
    """Per term: exact (old rule), lemma (WMT25), compound (German head), strict (no substring)."""
    folded, keys = fold(hyp), text_keys(hyp, lang)
    out: list[dict[str, bool]] = []
    for t in terms:
        tk = text_keys(t, lang)
        exact = fold(t) in folded
        strict = find_term(tk, keys, compound=False)
        lemma = exact or strict
        out.append({
            "exact": exact,
            "lemma": lemma,
            "compound": lemma or (lang == "de" and find_term(tk, keys, compound=True)),
            "strict": strict,
        })
    return out


# --- neural metrics ------------------------------------------------------------------------


def torch_device() -> str:
    import torch

    if torch.cuda.is_available():
        return "cuda"
    return "mps" if torch.backends.mps.is_available() else "cpu"


def device_kwargs() -> dict:
    """COMET predict() settings: CUDA, else Apple MPS, else CPU (which needs loader workers)."""
    dev = torch_device()
    if dev == "cuda":
        return {"gpus": 1}
    if dev == "mps":
        return {"gpus": 1, "accelerator": "mps"}
    return {"gpus": 0, "num_workers": 2}


def comet_predict(
    model_name: str, data: list[Segment], use_ref: bool, batch_size: int
) -> tuple[list[float], list[Spans] | None]:
    """Any model of the `comet` library. Returns scores (0-1) and xCOMET error spans if any."""
    from comet import download_model, load_from_checkpoint

    model = load_from_checkpoint(download_model(model_name))
    keys = ("src", "mt", "ref") if use_ref else ("src", "mt")
    out = model.predict(
        [{k: d[k] for k in keys} for d in data],
        batch_size=batch_size, progress_bar=False, **device_kwargs(),
    )
    spans = getattr(getattr(out, "metadata", None), "error_spans", None)
    return list(out.scores), spans


def metricx_predict(
    model_name: str, data: list[Segment], use_ref: bool, batch_size: int
) -> list[float]:
    """MetricX-24: 0 (perfect) to 25 (worst). Same input text, tokenizer, EOS removal and
    read-out as the official predict.py; segments are batched by length (padding is masked)."""
    import torch
    from transformers import AutoTokenizer, MT5ForConditionalGeneration

    dev = torch_device()
    # slow (SentencePiece) tokenizer: the fast one needs a newer protobuf than comet allows
    tok = AutoTokenizer.from_pretrained(METRICX_TOKENIZER, use_fast=False)
    # MT5ForRegression in the official repo is MT5ForConditionalGeneration (same weights) fed
    # one decoder start token (id 0); the score is the logit of <extra_id_10> at that step.
    model = MT5ForConditionalGeneration.from_pretrained(model_name, torch_dtype="auto")
    model.to(dev).eval()
    texts = [
        f"source: {d['src']} candidate: {d['mt']}" + (f" reference: {d['ref']}" if use_ref else "")
        for d in data
    ]
    # the official code drops the final EOS token
    ids = [tok(t, max_length=METRICX_MAX_LENGTH, truncation=True)["input_ids"][:-1] for t in texts]
    order = sorted(range(len(ids)), key=lambda k: len(ids[k]))
    scores = [0.0] * len(ids)
    with torch.no_grad():
        for b in range(0, len(order), batch_size):
            idx = order[b : b + batch_size]
            width = max(len(ids[k]) for k in idx)
            pad = tok.pad_token_id
            input_ids = torch.tensor([ids[k] + [pad] * (width - len(ids[k])) for k in idx])
            mask = torch.tensor([[1] * len(ids[k]) + [0] * (width - len(ids[k])) for k in idx])
            logits = model(
                input_ids=input_ids.to(dev),
                attention_mask=mask.to(dev),
                decoder_input_ids=torch.zeros((len(idx), 1), dtype=torch.long, device=dev),
            ).logits
            preds = torch.clamp(logits[:, 0, METRICX_SCORE_TOKEN].float(), 0, 25).cpu().tolist()
            for k, p in zip(idx, preds, strict=True):
                scores[k] = p
    del model
    if dev == "mps":
        torch.mps.empty_cache()
    return scores


def run_metric(
    metric: str, data: list[Segment], models: dict[str, str] | None = None, batch_size: int = 16
) -> tuple[list[float], list[Spans] | None]:
    """Segment scores in the metric's own scale (COMET family 0-1, MetricX 0-25 lower=better)."""
    names = {**MODELS, **(models or {})}
    use_ref = metric not in QE_METRICS
    if metric.startswith("metricx24"):
        return metricx_predict(names["metricx24"], data, use_ref, batch_size), None
    if metric.startswith("xcomet"):
        return comet_predict(names["xcomet"], data, use_ref, batch_size)
    return comet_predict(names[metric], data, use_ref, batch_size)


def parse_metrics(spec: str, allowed: list[str] = METRICS) -> list[str]:
    metrics = [m.strip() for m in spec.split(",") if m.strip() and m.strip() != "none"]
    if bad := [m for m in metrics if m not in allowed]:
        raise SystemExit(f"unknown metric(s) {bad}; choose among {allowed}")
    return metrics


def load_hyps(spec: str) -> tuple[str, dict[str, str]]:
    name, path = spec.split("=", 1)
    return name, {h["id"]: h["hyp"] for h in map(json.loads, open(path)) if h.get("hyp")}


def report_key(metric: str) -> str:
    return "comet" if metric == "comet22" else metric.replace("-", "_")


# --- main ----------------------------------------------------------------------------------


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--test", type=Path, required=True)
    ap.add_argument("--sys", action="append", required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--metrics", default="comet22", help=f"comma list among {METRICS}, or none")
    ap.add_argument("--terms-only", action="store_true", help="no neural metric (no torch/comet)")
    ap.add_argument("--comet", default=MODELS["comet22"])
    ap.add_argument("--cometkiwi", default=MODELS["cometkiwi22"])
    ap.add_argument("--metricx", default=MODELS["metricx24"])
    ap.add_argument("--xcomet", default=MODELS["xcomet"])
    ap.add_argument("--batch-size", type=int, default=16)
    ap.add_argument("--common", action="store_true", help="only passages every system translated")
    ap.add_argument("--pool", help="only this pool (e.g. magazine)")
    ap.add_argument("--limit", type=int, help="first N passages per lang/pool (smoke tests)")
    args = ap.parse_args()
    metrics = [] if args.terms_only else parse_metrics(args.metrics)
    models = {
        "comet22": args.comet, "cometkiwi22": args.cometkiwi,
        "metricx24": args.metricx, "xcomet": args.xcomet,
    }

    rows = {r["id"]: r for r in map(json.loads, args.test.open())}
    systems = [load_hyps(spec) for spec in args.sys]
    if args.pool:
        rows = {i: r for i, r in rows.items() if r["pool"] == args.pool}
    if args.common:
        keep = set.intersection(*(set(h) for _, h in systems))
        rows = {i: r for i, r in rows.items() if i in keep}
    if args.limit:
        seen: dict[str, int] = defaultdict(int)
        kept: dict[str, dict] = {}
        for i, r in rows.items():
            g = f"{r['lang']}/{r['pool']}"
            if seen[g] < args.limit and all(i in h for _, h in systems):
                seen[g] += 1
                kept[i] = r
        rows = kept

    # one flat list over all systems, so each model is loaded once
    flat = [(name, i) for name, hyps in systems for i in rows if i in hyps]
    hyp_of = dict(systems)
    data = [{"src": rows[i]["fr"], "mt": hyp_of[n][i], "ref": rows[i]["ref"]} for n, i in flat]
    seg: dict[str, dict[str, dict[str, object]]] = defaultdict(lambda: defaultdict(dict))
    for m in metrics:
        scores, spans = run_metric(m, data, models, args.batch_size)
        for k, (n, i) in enumerate(flat):
            seg[i][n][report_key(m)] = scores[k]
            if spans is not None:
                seg[i][n][f"{report_key(m)}_spans"] = spans[k]
        print(f"scored {m}: {len(data)} segments", flush=True)

    report: dict[str, dict[str, dict[str, float]]] = {}
    for name, hyps in systems:
        groups: dict[str, list[str]] = defaultdict(list)
        for i in rows:
            if i in hyps:
                groups[f"{rows[i]['lang']}/{rows[i]['pool']}"].append(i)
        report[name] = {}
        for g, ids in sorted(groups.items()):
            lang = g.split("/")[0]
            # German: ß and ss are orthographic variants (Swiss vs German), not translation errors
            norm: Callable[[str], str] = (
                (lambda t: t.replace("ß", "ss")) if lang == "de" else (lambda t: t)
            )
            hyp = [norm(hyps[i]) for i in ids]
            ref = [norm(rows[i]["ref"]) for i in ids]
            hits: dict[str, int] = defaultdict(int)
            tot = 0
            for i in ids:
                found = term_hits(hyps[i], [t["tgt"] for t in rows[i]["hints"]], lang)
                tot += len(found)
                for f in found:
                    for rule, ok in f.items():
                        hits[rule] += ok
                seg[i][name]["terms"] = [
                    "compound" if not f["lemma"] and f["compound"] else
                    "lemma" if not f["exact"] and f["lemma"] else
                    "exact" if f["exact"] else "missing"
                    for f in found
                ]
            pct = {r: 100 * hits[r] / tot if tot else float("nan") for r in
                   ("exact", "lemma", "compound", "strict")}
            report[name][g] = {
                "n": len(ids),
                "missing": sum(
                    1 for i, r in rows.items()
                    if i not in hyps and f"{r['lang']}/{r['pool']}" == g
                ),
                "chrf": sacrebleu.corpus_chrf(hyp, [ref], word_order=2).score,
                "bleu": sacrebleu.corpus_bleu(hyp, [ref]).score,
                "terms": pct["exact"],
                "terms_lemma": pct["lemma"],
                "terms_compound": pct["compound"],
                "terms_lemma_strict": pct["strict"],
                "n_terms": tot,
            }
            for m in metrics:
                key = report_key(m)
                mean = sum(float(seg[i][name][key]) for i in ids) / len(ids)  # type: ignore[arg-type]
                report[name][g][key] = mean if m in LOWER_IS_BETTER else 100 * mean
        print(name, json.dumps(report[name], indent=1))
    out = {"systems": report, "metrics": metrics, "segment_scores": seg}
    if "comet22" in metrics:  # same shape as before: {id: {system: COMET-22}}
        out["segments"] = {i: {n: v["comet"] for n, v in s.items()} for i, s in seg.items()}
    args.out.write_text(json.dumps(out, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
