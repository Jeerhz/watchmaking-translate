"""System S3: per passage, keep the candidate that several reference-free (QE) metrics prefer.

usage: python select_qe.py --test test.jsonl --sys name=path.jsonl [--sys ...] --out selected.jsonl
           [--qe cometkiwi22,metricx24-qe,xcomet-qe]

!!! EVALUATION RULE — the selected output must NEVER be evaluated with a metric of the same
!!! family as one used to select it. Selecting with CometKiwi and scoring with COMET-22 (or
!!! selecting with MetricX-24 QE and scoring with MetricX-24, or xCOMET-QE with xCOMET)
!!! rewards the selector's own preferences and overstates the gain. Judge the result with a
!!! metric family left out of --qe, with chrF++/term accuracy, or with human ratings.

Selection is never done with a single metric: Kovacs et al. (WMT24) found that reranking with
one QE metric does not beat the greedy output in human MQM, while a rank-averaged ensemble of
metrics does. So, for each passage, the candidates are ranked under each QE metric (1 = best,
ties share the mean rank) and the candidate with the lowest average rank is kept. Remaining
ties (frequent with two candidates and two metrics that disagree) go to the candidate with the
higher mean z-score, each metric standardised over all candidates and signed so that higher is
better. At least two metrics are required.

Only passages every candidate system translated are selected.
Writes {"id", "hyp", "from", "rank": {system: mean rank}, "qe": {metric: {system: score}}};
scores are in each metric's own scale (CometKiwi/xCOMET 0-1 higher = better, MetricX 0-25
lower = better).
"""

import argparse
import json
from collections import Counter
from pathlib import Path
from statistics import fmean, pstdev

from score import LOWER_IS_BETTER, MODELS, QE_METRICS, load_hyps, parse_metrics, run_metric


def ranks(values: list[float]) -> list[float]:
    """Rank of each value, 1 = highest; ties share the mean of their ranks."""
    order = sorted(range(len(values)), key=lambda k: -values[k])
    out = [0.0] * len(values)
    a = 0
    while a < len(order):
        b = a
        while b + 1 < len(order) and values[order[b + 1]] == values[order[a]]:
            b += 1
        for k in order[a : b + 1]:
            out[k] = (a + b) / 2 + 1
        a = b + 1
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--test", type=Path, required=True)
    ap.add_argument("--sys", action="append", required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument(
        "--qe", default="cometkiwi22,metricx24-qe",
        help=f"QE metrics to rank-average, at least two among {QE_METRICS}",
    )
    ap.add_argument("--cometkiwi", default=MODELS["cometkiwi22"])
    ap.add_argument("--metricx", default=MODELS["metricx24"])
    ap.add_argument("--xcomet", default=MODELS["xcomet"])
    ap.add_argument("--batch-size", type=int, default=16)
    args = ap.parse_args()
    metrics = parse_metrics(args.qe, QE_METRICS)
    if len(set(metrics)) < 2:
        raise SystemExit("select_qe needs at least two QE metrics: no single-metric selection")
    models = {"cometkiwi22": args.cometkiwi, "metricx24": args.metricx, "xcomet": args.xcomet}

    rows = {r["id"]: r for r in map(json.loads, args.test.open())}
    systems = dict(load_hyps(spec) for spec in args.sys)
    names = list(systems)
    ids = sorted(set.intersection(*(set(h) for h in systems.values())) & set(rows))
    data = [{"src": rows[i]["fr"], "mt": systems[n][i], "ref": ""} for n in names for i in ids]

    # goodness[metric][system][k]: higher = better; raw[metric][system][k]: the metric's own scale
    raw: dict[str, dict[str, list[float]]] = {}
    good: dict[str, dict[str, list[float]]] = {}
    for m in metrics:
        scores, _ = run_metric(m, data, models, args.batch_size)
        sign = -1.0 if m in LOWER_IS_BETTER else 1.0
        mu, sd = fmean(scores), pstdev(scores) or 1.0
        raw[m] = {n: scores[a * len(ids) : (a + 1) * len(ids)] for a, n in enumerate(names)}
        good[m] = {n: [sign * (s - mu) / sd for s in raw[m][n]] for n in names}
        print(f"scored {m}", flush=True)

    picked: Counter[str] = Counter()
    ties = 0
    with args.out.open("w") as fh:
        for k, i in enumerate(ids):
            per_metric = [ranks([good[m][n][k] for n in names]) for m in metrics]
            rank = {n: fmean(r[a] for r in per_metric) for a, n in enumerate(names)}
            z = {n: fmean(good[m][n][k] for m in metrics) for n in names}
            best = min(names, key=lambda n: (rank[n], -z[n]))
            ties += sum(1 for n in names if rank[n] == rank[best]) > 1
            picked[best] += 1
            fh.write(json.dumps({
                "id": i, "hyp": systems[best][i], "from": best,
                "rank": {n: round(rank[n], 3) for n in names},
                "qe": {m: {n: round(raw[m][n][k], 4) for n in names} for m in metrics},
            }, ensure_ascii=False) + "\n")
    print(f"{len(ids)} passages; picked {dict(picked)}; {ties} rank ties broken by mean z-score")
    for m in metrics:
        for n in names:
            print(f"  mean {m} {n}: {fmean(raw[m][n]):.4f}")
    print("Do not evaluate this output with a metric of the same family as:", ", ".join(metrics))


if __name__ == "__main__":
    main()
