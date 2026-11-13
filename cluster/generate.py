"""Translate data/ft/test.jsonl with vLLM (base or merged fine-tuned model), greedy."""

import argparse
import json
import sys
import time
from pathlib import Path

from vllm import LLM, SamplingParams

sys.path.insert(0, str(Path(__file__).parent))
from prompt import TermHint, user_prompt  # noqa: E402  (copy of trad_gmt.ft.prompt)


def hints(row: dict, mode: str) -> list[TermHint] | None:
    if mode == "none":
        return None
    return [TermHint(**h) for h in row["auto_hints" if mode == "auto" else "hints"]] or None


def strict(prompt: str, on: bool) -> str:
    if not on:
        return prompt
    head, sep, rest = prompt.partition("\n")
    return head + " Output only the translation: no preamble, notes, headings or alternatives." + sep + rest


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--test", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--hints", choices=["auto", "oracle", "none"], default="auto",
                    help="auto = termbase hits as served; oracle = terms the reference uses")
    ap.add_argument("--max-len", type=int, default=4096)
    ap.add_argument("--strict", action="store_true",
                    help="base models: ask for the translation only (they otherwise add options/notes)")
    ap.add_argument("--limit", type=int, default=None, help="first N passages only (smoke tests)")
    args = ap.parse_args()

    rows = [json.loads(line) for line in args.test.open()][: args.limit]
    msgs = [
        [{"role": "user", "content": strict(user_prompt(r["fr"], r.get("target") or r["lang"], hints(r, args.hints)), args.strict)}]
        for r in rows
    ]
    llm = LLM(model=args.model, dtype="bfloat16", max_model_len=args.max_len, gpu_memory_utilization=0.85,
              limit_mm_per_prompt={"image": 0, "audio": 0})
    t0 = time.time()
    outs = llm.chat(msgs, SamplingParams(temperature=0.0, max_tokens=1024))
    dt = time.time() - t0
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w") as fh:
        for r, o in zip(rows, outs, strict=True):
            fh.write(json.dumps({"id": r["id"], "hyp": o.outputs[0].text.strip()}, ensure_ascii=False) + "\n")
    print(f"{len(rows)} passages in {dt:.1f}s → {args.out}")


if __name__ == "__main__":
    main()
