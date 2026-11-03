"""Two-pass Claude translation: draft with glossary + memory, then an editor review pass."""

import json
import logging
import re
from collections.abc import Callable

import anthropic
from pydantic import BaseModel

from trad_gmt.mt import prompts
from trad_gmt.mt.glossary import Hit
from trad_gmt.mt.memory import Example
from trad_gmt.mt.resources import Resources, load_resources
from trad_gmt.mt.style import style_guide
from trad_gmt.text import split_sentences

log = logging.getLogger(__name__)

DEFAULT_MODEL = "claude-opus-5-5"
FALLBACK_BETA = "server-side-fallback-2026-07-01"
_PARAGRAPH_BREAK = re.compile(r"\n\s*\n|\n")


class TranslateConfig(BaseModel):
    model: str = DEFAULT_MODEL
    # quality over speed: Opus 5.5 defaults to "medium"; low|medium|high|xhigh|max
    effort: str = "xhigh"
    review: bool = True
    swiss_german: bool = False
    chunk_words: int = 1200
    max_glossary: int = 120
    max_examples: int = 40
    max_tokens: int = 64_000


class Change(BaseModel):
    before: str
    after: str
    reason: str


class ChunkResult(BaseModel):
    source: str
    draft: str
    translation: str
    changes: list[Change] = []
    glossary: list[Hit] = []
    examples: list[Example] = []


class TranslationResult(BaseModel):
    target: str
    translation: str
    chunks: list[ChunkResult]


def split_paragraphs(text: str) -> list[str]:
    return [p.strip() for p in _PARAGRAPH_BREAK.split(text.strip()) if p.strip()]


def chunk_paragraphs(paragraphs: list[str], max_words: int) -> list[list[str]]:
    """Group paragraphs into chunks of about ``max_words`` without splitting a paragraph."""
    chunks: list[list[str]] = [[]]
    words = 0
    for para in paragraphs:
        n = len(para.split())
        if chunks[-1] and words + n > max_words:
            chunks.append([])
            words = 0
        chunks[-1].append(para)
        words += n
    return [c for c in chunks if c]


class Translator:
    def __init__(
        self,
        resources: Resources | None = None,
        config: TranslateConfig | None = None,
        client: anthropic.Anthropic | None = None,
    ) -> None:
        self.res = resources or load_resources()
        self.cfg = config or TranslateConfig()
        self.client = client or anthropic.Anthropic()

    # --- evidence -------------------------------------------------------------------------

    def evidence(self, source: str, target: str) -> tuple[list[Hit], list[Example]]:
        hits = self.res.glossary.find(source, target, limit=self.cfg.max_glossary)
        sentences = [s for p in split_paragraphs(source) for s in split_sentences(p)]
        examples = self.res.memories[target].retrieve(sentences, budget=self.cfg.max_examples)
        return hits, examples

    def _fields(
        self,
        source: str,
        target: str,
        hits: list[Hit],
        examples: list[Example],
        context: str | None,
    ) -> dict[str, str]:
        return {
            "target": target,
            "target_name": prompts.target_name(target),
            "style_guide": style_guide(target, self.cfg.swiss_german),
            "glossary": prompts.render_glossary(hits, target),
            "examples": prompts.render_examples(examples, target),
            "context": prompts.render_context(context),
            "source": source,
        }

    # --- model calls ------------------------------------------------------------------------

    def _call(
        self,
        system: str,
        user: str,
        json_schema: dict | None = None,
        on_text: Callable[[str], None] | None = None,
    ) -> str:
        output_config: dict = {"effort": self.cfg.effort}
        if json_schema is not None:
            output_config["format"] = {"type": "json_schema", "schema": json_schema}
        with self.client.beta.messages.stream(
            model=self.cfg.model,
            max_tokens=self.cfg.max_tokens,
            # the long, stable system prompt (style guide) is cached across chunks and calls
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": user}],
            output_config=output_config,
            betas=[FALLBACK_BETA],
            fallbacks="default",
        ) as stream:
            if on_text is not None:
                for delta in stream.text_stream:
                    on_text(delta)
            message = stream.get_final_message()
        if message.stop_reason == "refusal":
            raise RuntimeError(f"model declined the request: {message.stop_details}")
        if message.stop_reason == "max_tokens":
            raise RuntimeError("translation truncated (max_tokens): lower chunk_words")
        return "".join(b.text for b in message.content if b.type == "text").strip()

    def translate_chunk(
        self,
        source: str,
        target: str,
        context: str | None = None,
        on_text: Callable[[str], None] | None = None,
    ) -> ChunkResult:
        hits, examples = self.evidence(source, target)
        fields = self._fields(source, target, hits, examples, context)
        draft = self._call(
            prompts.fill(prompts.TRANSLATE_SYSTEM, **fields),
            prompts.fill(prompts.TRANSLATE_USER, **fields),
            on_text=None if self.cfg.review else on_text,
        )
        result = ChunkResult(
            source=source, draft=draft, translation=draft, glossary=hits, examples=examples
        )
        if not self.cfg.review:
            return result
        reviewed = json.loads(
            self._call(
                prompts.fill(prompts.REVIEW_SYSTEM, **fields),
                prompts.fill(prompts.REVIEW_USER, **fields, draft=draft),
                json_schema=prompts.REVIEW_SCHEMA,
            )
        )
        result.translation = reviewed["translation"].strip()
        result.changes = [Change(**c) for c in reviewed.get("changes", [])]
        if on_text is not None:
            on_text(result.translation)
        return result

    def translate(
        self,
        text: str,
        target: str,
        on_chunk: Callable[[int, int, ChunkResult], None] | None = None,
    ) -> TranslationResult:
        if target not in self.res.memories:
            raise ValueError(f"target must be one of {sorted(self.res.memories)}")
        chunks = chunk_paragraphs(split_paragraphs(text), self.cfg.chunk_words)
        results: list[ChunkResult] = []
        context: str | None = None
        for i, paras in enumerate(chunks):
            res = self.translate_chunk("\n\n".join(paras), target, context)
            results.append(res)
            context = "\n\n".join(split_paragraphs(res.translation)[-2:])
            if on_chunk is not None:
                on_chunk(i, len(chunks), res)
        return TranslationResult(
            target=target,
            translation="\n\n".join(r.translation for r in results),
            chunks=results,
        )
