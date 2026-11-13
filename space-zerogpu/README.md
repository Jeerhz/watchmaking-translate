---
title: GMT MT
emoji: ⌚
colorFrom: yellow
colorTo: gray
sdk: gradio
app_file: app.py
pinned: false
---

Private inference Space (ZeroGPU) for GMT Publishing's fine-tuned French → English / German
watchmaking translation model. The web desk calls `/translate` through the Gradio API with
a Hugging Face token; the Space secret `HF_TOKEN` lets it read the private model repo, and
the variable `MODEL_ID` picks the model.
