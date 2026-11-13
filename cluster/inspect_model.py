"""Check, without loading weights, which class loads a model and which layers LoRA targets."""

import re
import sys

import torch
from accelerate import init_empty_weights
from transformers import AutoConfig, AutoModelForCausalLM, AutoTokenizer

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from train import LM_TARGETS  # noqa: E402

name = sys.argv[1]
cfg = AutoConfig.from_pretrained(name)
with init_empty_weights():
    model = AutoModelForCausalLM.from_config(cfg, dtype=torch.bfloat16)
print(type(model).__name__, f"{sum(p.numel() for p in model.parameters()) / 1e9:.2f}B params")
names = [n for n, m in model.named_modules() if isinstance(m, torch.nn.Linear)]
hit = [n for n in names if re.fullmatch(LM_TARGETS, n)]
print(len(names), "linear layers;", len(hit), "targeted, e.g.", hit[:2], "| not targeted e.g.", [n for n in names if n not in hit][:4])
tok = AutoTokenizer.from_pretrained(name)
msgs = [{"role": "user", "content": "Traduis: bonjour"}, {"role": "assistant", "content": "Hello"}]
print(repr(tok.apply_chat_template(msgs, tokenize=False)))
print(repr(tok.apply_chat_template(msgs[:1], tokenize=False, add_generation_prompt=True)))
