#!/bin/bash
#SBATCH --job-name=gmt-upload
#SBATCH --partition=cpu_devel
#SBATCH --cpus-per-task=4
#SBATCH --mem=16G
#SBATCH --time=4:00:00
#SBATCH --output=/scratch/abensale/gmt-mt/logs/%x-%j.log
# usage: sbatch upload.sbatch RUN_NAME REPO   (e.g. gemma4-e4b-lora AdleBenSalem/gmt-mt-gemma4-e4b)
# → REPO (private): merged bf16 weights + tokenizer, lora/ adapter, model card
#   REPO-GGUF (private): Q4_K_M and Q8_0 GGUF for llama.cpp / Ollama / LM Studio
set -euo pipefail
source /scratch/abensale/gmt-mt/env.sh
cd $GMT
RUN=$1; REPO=$2
hf repos create $REPO --private --exist-ok
cp code/cards/$RUN.md runs/$RUN/merged/README.md 2>/dev/null || true
hf upload $REPO runs/$RUN/merged . --commit-message "Merged fine-tuned weights"
hf upload $REPO runs/$RUN/final lora --exclude "checkpoint-*" --commit-message "LoRA adapter"
if ls runs/$RUN/gguf/*Q4_K_M.gguf >/dev/null 2>&1; then
  hf repos create $REPO-GGUF --private --exist-ok
  hf upload $REPO-GGUF runs/$RUN/gguf . --include "*Q4_K_M.gguf" --include "*Q8_0.gguf" --commit-message "GGUF quantisations"
fi
echo UPLOAD-OK
