"""System S3: per passage, keep the candidate CometKiwi (reference-free QE) rates highest.

usage: python select_qe.py --test test.jsonl --sys name=path.jsonl [--sys ...] --out selected.jsonl
Only passages every candidate system translated are selected. Writes {"id", "hyp", "from", "qe"}.
"""

import argparse
import json
from collections import Counter
from pathlib import Path

from comet import download_model, load_from_checkpoint
from score import device_kwargs


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--test", type=Path, required=True)
    ap.add_argument("--sys", action="append", required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--qe", default="Unbabel/wmt22-cometkiwi-da")
    args = ap.parse_args()

    rows = {r["id"]: r for r in map(json.loads, args.test.open())}
    systems = {
        spec.split("=", 1)[0]: {h["id"]: h["hyp"] for h in map(json.loads, open(spec.split("=", 1)[1])) if h.get("hyp")}
        for spec in args.sys
    }
    ids = sorted(set.intersection(*(set(h) for h in systems.values())) & set(rows))
    model = load_from_checkpoint(download_model(args.qe))
    qe: dict[str, list[float]] = {}
    for name, hyps in systems.items():
        data = [{"src": rows[i]["fr"], "mt": hyps[i]} for i in ids]
        qe[name] = model.predict(data, batch_size=16, progress_bar=False, **device_kwargs()).scores
    picked: Counter[str] = Counter()
    with args.out.open("w") as fh:
        for k, i in enumerate(ids):
            best = max(systems, key=lambda n: qe[n][k])
            picked[best] += 1
            scores = {n: round(qe[n][k], 4) for n in systems}
            fh.write(json.dumps({"id": i, "hyp": systems[best][i], "from": best, "qe": scores}, ensure_ascii=False) + "\n")
    print(f"{len(ids)} passages; picked {dict(picked)}")
    for n in systems:
        print(f"  mean QE {n}: {100 * sum(qe[n]) / len(ids):.1f}")


if __name__ == "__main__":
    main()
