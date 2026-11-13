#!/bin/bash
#SBATCH --job-name=gmt-gguf
#SBATCH --partition=cpu_devel
#SBATCH --cpus-per-task=16
#SBATCH --mem=96G
#SBATCH --time=3:00:00
#SBATCH --output=/scratch/abensale/gmt-mt/logs/%x-%j.log
# usage: sbatch gguf.sbatch RUN_NAME [MODEL_DIR]  → runs/RUN/gguf/RUN-{f16,Q8_0,Q4_K_M}.gguf
# (MODEL_DIR defaults to runs/RUN/merged)
set -euo pipefail
source /scratch/abensale/gmt-mt/env.sh
deactivate 2>/dev/null || true
cd $GMT
RUN=$1; SRC=${2:-runs/$RUN/merged}
out=runs/$RUN/gguf; mkdir -p $out
.venv-gguf/bin/python llama.cpp/convert_hf_to_gguf.py $SRC --outtype f16 --outfile $out/$RUN-f16.gguf
for q in Q8_0 Q4_K_M; do
  LD_LIBRARY_PATH=$HOME/miniconda3/lib llama-bin/llama-b12255/llama-quantize $out/$RUN-f16.gguf $out/$RUN-$q.gguf $q $SLURM_CPUS_PER_TASK
done
ls -la $out
