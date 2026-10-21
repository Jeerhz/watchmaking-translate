"""Polite, disk-cached async HTTP fetching for the collectors."""

import asyncio
import hashlib
import logging
from collections.abc import Callable
from pathlib import Path

import httpx
from pydantic import BaseModel, PrivateAttr
from tqdm.asyncio import tqdm_asyncio

log = logging.getLogger(__name__)

USER_AGENT = "Mozilla/5.0 (compatible; trad-gmt-research/0.1; watchmaking terminology research)"


class FetchResult(BaseModel):
    url: str
    status: int
    text: str | None = None


class CachedFetcher(BaseModel):
    """Fetch URLs with a concurrency cap, a per-request delay, retries and a disk cache.

    Cached responses are reused forever, so a collector can be re-run cheaply
    and a crawl can be resumed after an interruption.
    """

    cache_dir: Path
    concurrency: int = 4
    delay_s: float = 0.25
    timeout_s: float = 30.0
    retries: int = 3
    headers: dict[str, str] = {}
    transform: Callable[[str], str] | None = None  # applied before caching (e.g. keep text only)

    _sem: asyncio.Semaphore | None = PrivateAttr(default=None)

    def _cache_path(self, url: str) -> Path:
        digest = hashlib.sha1(url.encode()).hexdigest()
        return self.cache_dir / digest[:2] / f"{digest}.html"

    def cached(self, url: str) -> str | None:
        path = self._cache_path(url)
        return path.read_text(encoding="utf-8") if path.exists() else None

    async def _fetch_one(self, client: httpx.AsyncClient, url: str) -> FetchResult:
        if (text := self.cached(url)) is not None:
            return FetchResult(url=url, status=200, text=text)
        try:
            httpx.URL(url)
        except httpx.InvalidURL:
            log.warning("invalid URL skipped: %r", url)
            return FetchResult(url=url, status=0)
        assert self._sem is not None
        async with self._sem:
            for attempt in range(1, self.retries + 1):
                try:
                    resp = await client.get(url)
                    await asyncio.sleep(self.delay_s)
                    if resp.status_code == 200:
                        text = self.transform(resp.text) if self.transform else resp.text
                        path = self._cache_path(url)
                        path.parent.mkdir(parents=True, exist_ok=True)
                        path.write_text(text, encoding="utf-8")
                        return FetchResult(url=url, status=200, text=text)
                    if resp.status_code in (404, 410, 403):
                        return FetchResult(url=url, status=resp.status_code)
                    if resp.status_code == 429:  # rate limited: honour Retry-After
                        wait = float(resp.headers.get("retry-after", 0) or 0) or 5.0 * attempt
                        log.debug("429 on %s, sleeping %.0fs", url, wait)
                        await asyncio.sleep(wait)
                        continue
                    log.warning("HTTP %s on %s (attempt %d)", resp.status_code, url, attempt)
                except httpx.HTTPError as exc:
                    log.warning("%s on %s (attempt %d)", type(exc).__name__, url, attempt)
                await asyncio.sleep(2**attempt)
        return FetchResult(url=url, status=0)

    async def fetch_all(self, urls: list[str], desc: str = "fetch") -> dict[str, FetchResult]:
        self._sem = asyncio.Semaphore(self.concurrency)
        headers = {"User-Agent": USER_AGENT, **self.headers}
        async with httpx.AsyncClient(
            headers=headers, timeout=self.timeout_s, follow_redirects=True, http2=False
        ) as client:
            results = await tqdm_asyncio.gather(
                *(self._fetch_one(client, u) for u in urls), desc=desc, leave=False
            )
        return {r.url: r for r in results}

    def fetch_all_sync(self, urls: list[str], desc: str = "fetch") -> dict[str, FetchResult]:
        return asyncio.run(self.fetch_all(urls, desc=desc))
