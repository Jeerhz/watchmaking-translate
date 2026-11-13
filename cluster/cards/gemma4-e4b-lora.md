---
base_model: google/gemma-4-E4B-it
license: apache-2.0
language: [fr, en, de]
pipeline_tag: translation
tags: [translation, watchmaking, horology, lora, gemma4]
---

# GMT MT — Gemma 4 E4B fine-tuned for French → English / German watchmaking translation

Private model for GMT Publishing. `google/gemma-4-E4B-it` + LoRA, merged (bf16). The LoRA
adapter alone is in `lora/`; GGUF builds (Q4_K_M, Q8_0) in `AdleBenSalem/gmt-mt-gemma4-e4b-GGUF`.

## Recipe
- LoRA r=64, α=64, dropout 0.05 on all attention + MLP projections of the language model
  (1.7 % of weights); vision/audio towers frozen. 1 epoch, AdamW, lr 2e-4, cosine, 3 % warm-up,
  effective batch 32, bf16, loss on the translation only. One H100, 3 h 23 (Inria CLEPS).
- Data: 149,805 passages of 1–5 consecutive aligned sentences — 87k GMT editorial FR→EN
  (WorldTempus, press releases excluded), 19k FR→EN domain (FH Berner, FHH, Patek, brand sites,
  Rolex), 14.6k FR→DE domain passages ×3. Patents excluded. Held-out articles never in training.
- Prompt lists termbase hits (half the samples: terms the reference uses; half: raw termbase
  hits as served), so the model applies the termbase where it fits.

## Prompt (must match training)

```
Translate the following French watchmaking text into British English, in the house style of a haute horlogerie magazine.
Use this terminology:
- réserve de marche → power reserve

La réserve de marche atteint 70 heures.
```
(`German` instead of `British English`; omit the terminology block when there are no hits.)

## Use
- vLLM: `vllm serve AdleBenSalem/gmt-mt-gemma4-e4b` (OpenAI-compatible, greedy decoding).
- llama.cpp / Ollama / LM Studio: the GGUF repo, e.g.
  `llama-server -hf AdleBenSalem/gmt-mt-gemma4-e4b-GGUF:Q4_K_M --jinja`.
- Hosted: the private ZeroGPU Space `AdleBenSalem/gmt-mt` (used by the GMT translation desk).

Training texts belong to their owners (GMT Publishing, FH, FHH, brands); internal use only.
