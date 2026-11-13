#!/bin/bash
#SBATCH --job-name=gmt-gen
#SBATCH --partition=gpu
#SBATCH --gres=gpu:1
#SBATCH --constraint=a100|h100|h200
#SBATCH --cpus-per-task=8
#SBATCH --mem=96G
#SBATCH --time=2:00:00
#SBATCH --output=/scratch/abensale/gmt-mt/logs/%x-%j.log
# usage: sbatch generate.sbatch MODEL OUT [--hints auto|oracle|none]
set -euo pipefail
source /scratch/abensale/gmt-mt/env.sh
cd $GMT
python code/generate.py --model "$1" --test data/test.jsonl --out "$2" "${@:3}"
