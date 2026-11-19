"""Score system outputs on data/ft/test.jsonl: chrF++, COMET-22 and glossary-term accuracy.

usage: python score.py --test test.jsonl --sys name=path.jsonl [--sys ...] --out scores.json
Term accuracy: share of the passage's glossary terms (those the reference uses) whose
target appears in the output — the same terms the fine-tuned model sees as hints.
"""

import argparse
import json
import unicodedata
from collections import defaultdict
from pathlib import Path

import sacrebleu
import torch
from comet import download_model, load_from_checkpoint


def device_kwargs() -> dict:
    """COMET predict() settings: CUDA, else Apple MPS, else CPU (which needs loader workers)."""
    if torch.cuda.is_available():
        return {"gpus": 1}
    if torch.backends.mps.is_available():
        return {"gpus": 1, "accelerator": "mps"}
    return {"gpus": 0, "num_workers": 2}


def fold(s: str) -> str:
    s = unicodedata.normalize("NFKD", s.lower().replace("’", "'").replace("ß", "ss"))
    return "".join(c for c in s if not unicodedata.combining(c))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--test", type=Path, required=True)
    ap.add_argument("--sys", action="append", required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--comet", default="Unbabel/wmt22-comet-da")
    ap.add_argument("--common", action="store_true", help="score only passages every system translated")
    args = ap.parse_args()

    rows = {r["id"]: r for r in map(json.loads, args.test.open())}
    comet = load_from_checkpoint(download_model(args.comet))
    systems = [(spec.split("=", 1)[0], {h["id"]: h["hyp"] for h in map(json.loads, open(spec.split("=", 1)[1])) if h.get("hyp")}) for spec in args.sys]
    if args.common:
        keep = set.intersection(*(set(h) for _, h in systems))
        rows = {i: r for i, r in rows.items() if i in keep}
    report: dict[str, dict[str, dict[str, float]]] = {}
    per_seg: dict[str, dict[str, dict[str, float]]] = defaultdict(dict)
    for name, hyps in systems:
        ids = [i for i in rows if i in hyps]
        scores = comet.predict(
            [{"src": rows[i]["fr"], "mt": hyps[i], "ref": rows[i]["ref"]} for i in ids],
            batch_size=32, progress_bar=False, **device_kwargs(),
        ).scores
        groups: dict[str, list[int]] = defaultdict(list)
        for k, i in enumerate(ids):
            groups[f"{rows[i]['lang']}/{rows[i]['pool']}"].append(k)
        report[name] = {}
        for g, ks in sorted(groups.items()):
            # German: ß and ss are orthographic variants (Swiss vs German), not translation errors
            norm = (lambda t: t.replace("ß", "ss")) if g.startswith("de") else (lambda t: t)
            hyp = [norm(hyps[ids[k]]) for k in ks]
            ref = [norm(rows[ids[k]]["ref"]) for k in ks]
            hit = tot = 0
            for k in ks:
                h = fold(hyps[ids[k]])
                for t in rows[ids[k]]["hints"]:
                    tot += 1
                    hit += fold(t["tgt"]) in h
            report[name][g] = {
                "n": len(ks),
                "missing": sum(1 for i in rows if i not in hyps and f"{rows[i]['lang']}/{rows[i]['pool']}" == g),
                "chrf": sacrebleu.corpus_chrf(hyp, [ref], word_order=2).score,
                "bleu": sacrebleu.corpus_bleu(hyp, [ref]).score,
                "comet": 100 * sum(scores[k] for k in ks) / len(ks),
                "terms": 100 * hit / tot if tot else float("nan"),
                "n_terms": tot,
            }
        for k, i in enumerate(ids):
            per_seg[i][name] = scores[k]
        print(name, json.dumps(report[name], indent=1))
    args.out.write_text(json.dumps({"systems": report, "segments": per_seg}, indent=1))


if __name__ == "__main__":
    main()
