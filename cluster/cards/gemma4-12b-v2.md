---
base_model: google/gemma-4-12B-it
license: apache-2.0
language: [fr, en, de]
pipeline_tag: translation
tags: [translation, watchmaking, horology, lora, gemma4]
---

# GMT MT v2 — Gemma 4 12B fine-tuned for French → English / German watchmaking translation

Private model for GMT Publishing. `google/gemma-4-12B-it` + LoRA, merged (bf16); the adapter alone is in `lora/`.
v2 adds GMT Magazine's own German (Swiss) and English, from the print PDFs of issues 89–96.

## Recipe
- LoRA r=64, α=64, dropout 0.05 on all attention + MLP projections of the language model;
  vision/audio towers frozen. 1 epoch, AdamW, lr 1e-4, cosine, 3 % warm-up, effective batch 32,
  bf16, loss on the translation only. One H200 (Hugging Face Jobs).
- Data (dataset `ft/v2`): passages of 1–5 consecutive aligned sentences — GMT editorial FR→EN
  (WorldTempus + GMT Magazine), FR→EN domain (FH Berner, FHH, Patek, brand sites, Rolex),
  **GMT Magazine FR→DE (Swiss German) ×4**, FR→DE domain ×2. Patents excluded. Training passages
  sharing a French sentence with the test set are removed.
- Prompt hints: 45 % the termbase terms the reference uses, 45 % raw termbase hits as served,
  10 % none.
- Test: the v1 test passages + GMT Magazine issues 97–98 (never in training).

## Prompt (must match training)

```
Translate the following French watchmaking text into British English, in the house style of a haute horlogerie magazine.
Use this terminology:
- réserve de marche → power reserve

La réserve de marche atteint 70 heures.
```
Targets: `British English`; `Swiss Standard German (ss, never ß; «» quotes)` = GMT's German;
`German` = German-German (ß). Omit the terminology block when there are no hits.

## Use
- vLLM: `vllm serve AdleBenSalem/gmt-mt-gemma4-12b` (OpenAI-compatible, greedy decoding).
- Hosted: the private ZeroGPU Space `AdleBenSalem/gmt-mt` (used by the GMT translation desk).

Training texts belong to their owners (GMT Publishing, FH, FHH, brands); internal use only.
