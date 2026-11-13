#!/bin/bash
#SBATCH --job-name=gmt-ft
#SBATCH --partition=gpu
#SBATCH --gres=gpu:1
#SBATCH --constraint=a100|h100|h200
#SBATCH --cpus-per-task=8
#SBATCH --mem=120G
#SBATCH --time=20:00:00
#SBATCH --output=/scratch/abensale/gmt-mt/logs/%x-%j.log
# usage: sbatch train.sbatch RUN_NAME [extra train.py args]
set -euo pipefail
source /scratch/abensale/gmt-mt/env.sh
cd $GMT
RUN=${1:-gemma4-12b-lora}; shift || true
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv
python code/train.py --data data/train.jsonl --out runs/$RUN "$@"
python code/merge.py --adapter runs/$RUN/final --out runs/$RUN/merged
python code/generate.py --model runs/$RUN/merged --test data/test.jsonl --out runs/$RUN/test.ft.jsonl
