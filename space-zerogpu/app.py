"""ZeroGPU inference Space for GMT's fine-tuned FR→EN/DE watchmaking translation model.

API (gradio): /translate(text, lang, terms) streams the translation. ``terms`` is one
"French → target" pair per line, the termbase hits to enforce (may be empty). The prompt
matches training exactly (src/trad_gmt/ft/prompt.py in the trad-gmt repository).
"""

import os
from threading import Thread

import gradio as gr
import spaces
import torch
from transformers import AutoConfig, AutoModelForCausalLM, AutoTokenizer, TextIteratorStreamer

MODEL = os.environ.get("MODEL_ID", "AdleBenSalem/gmt-mt-gemma4-e4b")
# "de-ch": GMT's own German (Swiss: ss, «»); "de": brand-site German (ß)
LANG_NAMES = {
    "en": "British English",
    "de": "German",
    "de-ch": "Swiss Standard German (ss, never ß; «» quotes)",
}

config = AutoConfig.from_pretrained(MODEL)
attn = {"": "sdpa", **{k: ("sdpa" if k == "text_config" else "eager") for k in (config.sub_configs or {})}}
tok = AutoTokenizer.from_pretrained(MODEL)
model = AutoModelForCausalLM.from_pretrained(MODEL, dtype=torch.bfloat16, attn_implementation=attn).to("cuda")
model.eval()


def user_prompt(src: str, lang: str, terms: list[tuple[str, str]]) -> str:
    lines = [
        f"Translate the following French watchmaking text into {LANG_NAMES[lang]}, "
        "in the house style of a haute horlogerie magazine."
    ]
    if terms:
        lines.append("Use this terminology:")
        lines.extend(f"- {fr} → {tgt}" for fr, tgt in terms)
    lines += ["", src]
    return "\n".join(lines)


def parse_terms(text: str) -> list[tuple[str, str]]:
    out = []
    for line in (text or "").splitlines():
        if "→" in line:
            fr, tgt = (p.strip(" -\t") for p in line.split("→", 1))
            if fr and tgt:
                out.append((fr, tgt))
    return out[:10]


@spaces.GPU(duration=60)
def translate(text: str, lang: str, terms: str):
    if lang not in LANG_NAMES or not text.strip():
        raise gr.Error("Give French text and a target language (en, de or de-ch).")
    prompt = user_prompt(text.strip(), lang, parse_terms(terms))
    ids = tok.apply_chat_template(
        [{"role": "user", "content": prompt}], add_generation_prompt=True, return_tensors="pt", return_dict=True
    ).to("cuda")
    streamer = TextIteratorStreamer(tok, skip_prompt=True, skip_special_tokens=True)
    kwargs = dict(**ids, max_new_tokens=1024, do_sample=False, streamer=streamer)
    Thread(target=model.generate, kwargs=kwargs).start()
    out = ""
    for piece in streamer:
        out += piece
        yield out.strip()


demo = gr.Interface(
    fn=translate,
    inputs=[
        gr.Textbox(label="French", lines=8),
        gr.Radio(["en", "de-ch", "de"], value="en", label="Target (de-ch = GMT Swiss German)"),
        gr.Textbox(label="Terminology (one 'français → target' per line, optional)", lines=3),
    ],
    outputs=gr.Textbox(label="Translation", lines=8),
    title="GMT watchmaking translation — fine-tuned Gemma 4",
    api_name="translate",
    flagging_mode="never",
)
demo.queue(max_size=20).launch()
