"""CPU sanity checks before spending GPU time: SFTConfig args and attention setup per model."""

import dataclasses
import sys

import torch
from accelerate import init_empty_weights
from transformers import AutoConfig, AutoModelForCausalLM, TrainingArguments
from trl import SFTConfig

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from train import attn_impl, sft_kwargs  # noqa: E402

names = {f.name for f in dataclasses.fields(SFTConfig)}
print("warmup fields:", sorted(n for n in names if "warmup" in n))
kw = sft_kwargs("/tmp/x", epochs=1.0, max_steps=-1, batch=8, accum=4, lr=1e-4, max_len=1024)
print("unknown SFTConfig args:", sorted(set(kw) - names))
cfg = SFTConfig(**{**kw, "bf16": torch.cuda.is_available()})  # CPU node: no bf16
print("SFTConfig ok, warmup:", getattr(cfg, "warmup_steps", None), getattr(cfg, "warmup_ratio", None))
for m in sys.argv[1:]:
    c = AutoConfig.from_pretrained(m)
    impl = attn_impl(c)
    with init_empty_weights():
        AutoModelForCausalLM.from_config(c, dtype=torch.bfloat16, attn_implementation=impl)
    print(m, "init ok with", impl)
