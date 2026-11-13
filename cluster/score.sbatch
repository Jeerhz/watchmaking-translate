#!/bin/bash
#SBATCH --job-name=gmt-score
#SBATCH --partition=gpu
#SBATCH --gres=gpu:1
#SBATCH --cpus-per-task=4
#SBATCH --mem=32G
#SBATCH --time=1:00:00
#SBATCH --output=/scratch/abensale/gmt-mt/logs/%x-%j.log
# usage: sbatch score.sbatch OUT.json name=hyps.jsonl [name=hyps.jsonl ...]
set -euo pipefail
source /scratch/abensale/gmt-mt/env.sh
deactivate 2>/dev/null || true
cd $GMT
out=$1; shift
args=(); for s in "$@"; do args+=(--sys "$s"); done
.venv-comet/bin/python code/score.py --test data/test.jsonl --out "$out" "${args[@]}" ${SCORE_FLAGS:-}
