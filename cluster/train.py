"""LoRA fine-tuning of an instruction model on the FR→EN/DE passages (data/ft/train.jsonl).

Loss is on the translation only (prompt/completion format). Runs on one 80 GB GPU in bf16.
"""

import argparse
import json
from pathlib import Path

import torch
from datasets import Dataset
from peft import LoraConfig
from transformers import AutoConfig, AutoModelForCausalLM, AutoTokenizer
from trl import SFTConfig, SFTTrainer

# language-model linear layers only (Gemma 4 also ships vision / audio towers)
LM_TARGETS = r".*language_model.*\.(q_proj|k_proj|v_proj|o_proj|gate_proj|up_proj|down_proj)"


def load_rows(path: Path, tok, limit: int | None) -> Dataset:
    """Plain-text prompt/completion, rendered exactly as at inference.

    Gemma 4's generation prompt ends with an empty thinking block that the full-conversation
    rendering omits, so the prompt is rendered with ``add_generation_prompt`` and the
    completion is the translation plus the end-of-turn marker.
    """
    end = "<turn|>" if "<turn|>" in tok.get_vocab() else tok.eos_token
    bos = tok.bos_token or ""
    rows = []
    with path.open() as fh:
        for line in fh:
            r = json.loads(line)
            user, assistant = r["messages"]
            prompt = tok.apply_chat_template([user], tokenize=False, add_generation_prompt=True)
            if bos and prompt.startswith(bos):
                prompt = prompt[len(bos):]  # the tokenizer adds it
            rows.append({"prompt": prompt, "completion": assistant["content"] + end})
            if limit and len(rows) == limit:
                break
    return Dataset.from_list(rows)


def attn_impl(config) -> str | dict[str, str]:
    """SDPA for the language model; Gemma 4's audio tower only supports eager attention."""
    subs = getattr(config, "sub_configs", {}) or {}
    if not subs:
        return "sdpa"
    return {"": "sdpa", **{k: ("sdpa" if k == "text_config" else "eager") for k in subs}}


def sft_kwargs(out: str, *, epochs: float, max_steps: int, batch: int, accum: int, lr: float, max_len: int) -> dict:
    return dict(
        output_dir=out,
        num_train_epochs=epochs,
        max_steps=max_steps,
        per_device_train_batch_size=batch,
        per_device_eval_batch_size=batch,
        gradient_accumulation_steps=accum,
        learning_rate=lr,
        lr_scheduler_type="cosine",
        warmup_steps=0.03,  # a float below 1 is a ratio of the total steps (transformers 5)
        weight_decay=0.0,
        bf16=True,
        gradient_checkpointing=True,
        max_length=max_len,
        completion_only_loss=True,
        padding_free=False,
        logging_steps=20,
        eval_strategy="steps",
        eval_steps=500,
        save_strategy="steps",
        save_steps=200,  # preemptible nodes: lose at most ~15 min
        save_total_limit=2,
        report_to="none",
        dataloader_num_workers=2,
        seed=0,
    )


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="google/gemma-4-12B-it")
    ap.add_argument("--data", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--rank", type=int, default=64)
    ap.add_argument("--lr", type=float, default=1e-4)
    ap.add_argument("--epochs", type=float, default=1.0)
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--accum", type=int, default=4)
    ap.add_argument("--max-len", type=int, default=1024)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--max-steps", type=int, default=-1)
    ap.add_argument("--targets", default=LM_TARGETS)
    args = ap.parse_args()

    tok = AutoTokenizer.from_pretrained(args.model)
    model = AutoModelForCausalLM.from_pretrained(
        args.model, dtype=torch.bfloat16, attn_implementation=attn_impl(AutoConfig.from_pretrained(args.model))
    )
    ds = load_rows(args.data, tok, args.limit)
    print(repr(ds[0]["prompt"][-200:]), repr(ds[0]["completion"][-60:]))
    split = ds.train_test_split(test_size=min(500, len(ds) // 20), seed=0)

    cfg = SFTConfig(
        **sft_kwargs(
            str(args.out),
            epochs=args.epochs,
            max_steps=args.max_steps,
            batch=args.batch,
            accum=args.accum,
            lr=args.lr,
            max_len=args.max_len,
        )
    )
    peft_cfg = LoraConfig(
        r=args.rank,
        lora_alpha=args.rank,
        lora_dropout=0.05,
        target_modules=args.targets,
        task_type="CAUSAL_LM",
    )
    trainer = SFTTrainer(
        model=model,
        args=cfg,
        train_dataset=split["train"],
        eval_dataset=split["test"],
        processing_class=tok,
        peft_config=peft_cfg,
    )
    trainer.model.print_trainable_parameters()
    # resume after a time-limit kill: sbatch again with the same run name
    resume = any(args.out.glob("checkpoint-*"))
    trainer.train(resume_from_checkpoint=True if resume else None)
    trainer.save_model(str(args.out / "final"))
    tok.save_pretrained(str(args.out / "final"))


if __name__ == "__main__":
    main()
