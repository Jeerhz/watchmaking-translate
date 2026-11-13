# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "vllm>=0.33",
#   "transformers>=5.20",
#   "peft>=0.21",
#   "trl>=1.17",
#   "datasets",
#   "accelerate",
#   "huggingface_hub>=1.0",
#   "pydantic",
# ]
# ///
"""Fine-tune → merge → translate the test set → push to the Hub, on Hugging Face Jobs.

The same train / merge / generate scripts as on the cluster (mounted at /code); data comes from
the private dataset repo (ft/<version>/), results go to private model repos, test outputs and
the training log back to the dataset repo. Everything is uploaded even if a later step fails.

  hf jobs uv run --flavor h200 --timeout 8h --secrets HF_TOKEN -v ./cluster:/code \\
      cluster/hf_job.py gemma4-12b-v2 google/gemma-4-12B-it --repo AdleBenSalem/gmt-mt-gemma4-12b --lr 1e-4

Baselines (no training): --generate-only, with --strict for untuned models.
Smoke test: --repo omitted (nothing pushed but the outputs), --max-steps 5 --limit 400 --gen-limit 20.
"""

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

from huggingface_hub import HfApi, snapshot_download

DATASET = "AdleBenSalem/watchmaking-fr-en-de"


def run(*cmd: str) -> None:
    print("+", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("run")
    ap.add_argument("model")
    ap.add_argument("--repo", default=None, help="model repo for the merged weights + LoRA")
    ap.add_argument("--data", default="ft/v2")
    ap.add_argument("--code", default="/code")
    ap.add_argument("--generate-only", action="store_true", help="translate the test set with MODEL as is")
    ap.add_argument("--strict", action="store_true", help="untuned models: translation only, no notes")
    ap.add_argument("--gen-limit", default=None)
    args, train_args = ap.parse_known_args()

    os.environ.setdefault("VLLM_USE_FLASHINFER_SAMPLER", "0")
    api = HfApi()
    data = Path(snapshot_download(DATASET, repo_type="dataset", allow_patterns=[f"{args.data}/*"])) / args.data
    out = Path("/tmp/runs") / args.run
    code = Path(args.code)
    py = sys.executable
    out.mkdir(parents=True, exist_ok=True)
    gen = ["--test", str(data / "test.jsonl"), "--out", str(out / "test.ft.jsonl")]
    gen += ["--strict"] if args.strict else []
    gen += ["--limit", args.gen_limit] if args.gen_limit else []
    try:
        run("nvidia-smi")
        if args.generate_only:
            run(py, str(code / "generate.py"), "--model", args.model, *gen)
            return
        run(py, str(code / "train.py"), "--model", args.model, "--data", str(data / "train.jsonl"), "--out", str(out), *train_args)
        run(py, str(code / "merge.py"), "--adapter", str(out / "final"), "--out", str(out / "merged"))
        if args.repo:
            card = code / "cards" / f"{args.run}.md"
            if card.exists():
                shutil.copy(card, out / "merged" / "README.md")
            api.create_repo(args.repo, private=True, exist_ok=True)
            api.upload_folder(repo_id=args.repo, folder_path=str(out / "merged"), commit_message=f"{args.run}: merged weights")
            api.upload_folder(repo_id=args.repo, folder_path=str(out / "final"), path_in_repo="lora", commit_message=f"{args.run}: LoRA adapter")
        run(py, str(code / "generate.py"), "--model", str(out / "merged"), *gen)
    finally:
        for name in ("test.ft.jsonl", "final/trainer_state.json"):
            f = out / name
            if f.exists():
                api.upload_file(
                    path_or_fileobj=str(f),
                    path_in_repo=f"{args.data}/runs/{args.run}/{f.name}",
                    repo_id=DATASET,
                    repo_type="dataset",
                    commit_message=f"{args.run}: {f.name}",
                )
        states = sorted(out.glob("checkpoint-*/trainer_state.json"), key=lambda p: int(p.parent.name.split("-")[1]))
        if states:
            api.upload_file(
                path_or_fileobj=str(states[-1]),
                path_in_repo=f"{args.data}/runs/{args.run}/trainer_state.json",
                repo_id=DATASET,
                repo_type="dataset",
                commit_message=f"{args.run}: training log",
            )


if __name__ == "__main__":
    main()
