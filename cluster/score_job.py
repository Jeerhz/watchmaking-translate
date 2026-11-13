# /// script
# requires-python = ">=3.11,<3.13"
# dependencies = [
#   "unbabel-comet>=2.2",
#   "sacrebleu",
#   "setuptools<81",
#   "huggingface_hub>=1.0",
# ]
# ///
"""Score every system's test outputs (ft/<version>/runs/<system>/test.ft.jsonl) on HF Jobs.

  hf jobs uv run --flavor l4x1 --timeout 1h --secrets HF_TOKEN -v ./cluster:/code \\
      cluster/score_job.py ft-e4b-v2 base-e4b ... [--common]

Writes scores.json (all passages) and, with several systems, scores.common.json (passages
every system translated), next to the runs in the dataset repo.
"""

import argparse
import subprocess
import sys
from pathlib import Path

from huggingface_hub import HfApi, snapshot_download

DATASET = "AdleBenSalem/watchmaking-fr-en-de"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("systems", nargs="+")
    ap.add_argument("--data", default="ft/v2")
    ap.add_argument("--code", default="/code")
    ap.add_argument("--name", default="scores")
    args = ap.parse_args()

    pats = [f"{args.data}/test.jsonl", *(f"{args.data}/runs/{s}/test.ft.jsonl" for s in args.systems)]
    root = Path(snapshot_download(DATASET, repo_type="dataset", allow_patterns=pats)) / args.data
    specs = [f"{s}={root / 'runs' / s / 'test.ft.jsonl'}" for s in args.systems]
    api = HfApi()
    for common in ([False, True] if len(specs) > 1 else [False]):
        out = Path(f"/tmp/{args.name}{'.common' if common else ''}.json")
        cmd = [sys.executable, f"{args.code}/score.py", "--test", str(root / "test.jsonl"), "--out", str(out)]
        cmd += [x for s in specs for x in ("--sys", s)] + (["--common"] if common else [])
        print("+", " ".join(cmd), flush=True)
        subprocess.run(cmd, check=True)
        api.upload_file(
            path_or_fileobj=str(out),
            path_in_repo=f"{args.data}/runs/{out.name}",
            repo_id=DATASET,
            repo_type="dataset",
            commit_message=f"scores: {', '.join(args.systems)}",
        )


if __name__ == "__main__":
    main()
