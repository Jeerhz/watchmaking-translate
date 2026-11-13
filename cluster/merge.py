"""Merge a LoRA adapter into its base model and save a standalone bf16 checkpoint."""

import argparse

import torch
from peft import PeftConfig, PeftModel
from transformers import AutoModelForCausalLM, AutoProcessor, AutoTokenizer


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=None, help="default: the adapter's base model")
    ap.add_argument("--adapter", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    args.base = args.base or PeftConfig.from_pretrained(args.adapter).base_model_name_or_path
    # eager: no attention is computed here, and Gemma 4's audio tower has no SDPA path
    model = AutoModelForCausalLM.from_pretrained(args.base, dtype=torch.bfloat16, attn_implementation="eager")
    model = PeftModel.from_pretrained(model, args.adapter).merge_and_unload()
    model.save_pretrained(args.out, max_shard_size="5GB")
    AutoTokenizer.from_pretrained(args.base).save_pretrained(args.out)
    try:
        AutoProcessor.from_pretrained(args.base).save_pretrained(args.out)
    except Exception as e:  # text-only checkpoints need no processor
        print("processor not saved:", e)


if __name__ == "__main__":
    main()
