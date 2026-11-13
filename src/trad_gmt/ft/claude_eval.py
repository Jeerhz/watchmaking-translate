"""Run the deployed Claude desk (draft → editorial review) on the fine-tuning test passages.

Uses the production web desk's API, so the comparison is against exactly what GMT uses:
same termbase, same BM25 references (built from the train split only), same prompts.
"""

import asyncio
import hashlib
import json
import logging
import os
from pathlib import Path

import httpx
from pydantic import BaseModel

from trad_gmt.ft.data import FT_DIR

log = logging.getLogger(__name__)


class ClaudeEvalConfig(BaseModel):
    url: str = "https://gmt-translation-desk.vercel.app"
    test: Path = FT_DIR / "v2" / "test.jsonl"
    out: Path = FT_DIR / "v2" / "claude.jsonl"
    pools: list[str] | None = ["magazine"]  # None = every pool
    effort: str = "high"
    concurrency: int = 6


async def _step(client: httpx.AsyncClient, body: dict[str, object]) -> dict[str, object]:
    async with client.stream("POST", "/api/translate", json=body) as res:
        res.raise_for_status()
        async for line in res.aiter_lines():
            if not line.strip():
                continue
            ev = json.loads(line)
            if ev["t"] == "done":
                return ev
            if ev["t"] == "error":
                raise RuntimeError(ev["message"])
    raise RuntimeError("stream ended without a result")


async def _one(
    client: httpx.AsyncClient, row: dict[str, object], cfg: ClaudeEvalConfig
) -> dict[str, object]:
    base = {
        "lang": row["lang"],
        "source": row["fr"],
        "context": None,
        "swiss": row.get("target") == "de-ch",  # GMT's German edition is Swiss
        "effort": cfg.effort,
    }
    for attempt in range(3):
        try:
            d = await _step(client, {"step": "draft", **base})
            r = await _step(client, {"step": "review", **base, "draft": d["text"]})
            final = json.loads(str(r["text"]))["translation"].strip() or d["text"]
            return {
                "id": row["id"],
                "draft": d["text"],
                "hyp": final,
                "usage": [d["usage"], r["usage"]],
            }
        except Exception as e:  # rate limits, timeouts: back off and retry
            log.warning("%s attempt %d: %s", row["id"], attempt + 1, e)
            await asyncio.sleep(20 * (attempt + 1))
    return {"id": row["id"], "draft": None, "hyp": None, "usage": []}


async def run(cfg: ClaudeEvalConfig | None = None) -> Path:
    cfg = cfg or ClaudeEvalConfig()
    rows = [json.loads(line) for line in cfg.test.open()]
    rows = [r for r in rows if cfg.pools is None or r["pool"] in cfg.pools]
    done: dict[str, dict[str, object]] = {}
    if cfg.out.exists():
        done = {r["id"]: r for r in map(json.loads, cfg.out.open()) if r.get("hyp")}
    todo = [r for r in rows if r["id"] not in done]
    log.info("%d passages to translate (%d already done)", len(todo), len(done))
    code = os.environ["ACCESS_CODE"]
    cookie = hashlib.sha256(f"gmt-desk:{code}".encode()).hexdigest()
    sem = asyncio.Semaphore(cfg.concurrency)
    async with httpx.AsyncClient(
        base_url=cfg.url, cookies={"gmt_access": cookie}, timeout=httpx.Timeout(300)
    ) as client:

        async def guarded(row: dict[str, object]) -> dict[str, object]:
            async with sem:
                return await _one(client, row, cfg)

        with cfg.out.open("a") as fh:
            for fut in asyncio.as_completed([guarded(r) for r in todo]):
                res = await fut
                fh.write(json.dumps(res, ensure_ascii=False) + "\n")
                fh.flush()
    return cfg.out
