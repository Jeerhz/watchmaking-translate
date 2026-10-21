"""Core data models shared by every collector and by the dataset builder."""

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field, computed_field

LANGS: tuple[str, ...] = ("fr", "en", "de")


class Lang(StrEnum):
    FR = "fr"
    EN = "en"
    DE = "de"


Granularity = Literal["term", "sentence", "paragraph", "document"]


class TermEntry(BaseModel):
    """One concept with its designation in each language (glossary row)."""

    id: str = Field(description="Globally unique id: '<source>:<source_id>[:<sub>]'")
    source: str
    source_id: str
    fr: str | None = None
    en: str | None = None
    de: str | None = None
    pos_fr: str | None = None
    pos_en: str | None = None
    pos_de: str | None = None
    definition_fr: str | None = None
    definition_en: str | None = None
    definition_de: str | None = None
    parent_id: str | None = Field(default=None, description="Head entry id for sub-entries")
    url: str | None = None

    @computed_field
    @property
    def n_langs(self) -> int:
        return sum(1 for lang in LANGS if getattr(self, lang))


class ParallelSegment(BaseModel):
    """A multiparallel text unit: the same content in up to three languages."""

    id: str
    source: str
    doc_id: str
    granularity: Granularity
    fr: str | None = None
    en: str | None = None
    de: str | None = None
    url: str | None = None
    alignment: str = Field(
        default="native",
        description="How the languages were aligned: native (same unit in source), "
        "count (same sentence count in aligned blocks), embedding (LaBSE DP aligner)",
    )
    score_en: float | None = Field(default=None, description="fr↔en LaBSE cosine if computed")
    score_de: float | None = Field(default=None, description="fr↔de LaBSE cosine if computed")

    @computed_field
    @property
    def n_langs(self) -> int:
        return sum(1 for lang in LANGS if getattr(self, lang))


class SourceInfo(BaseModel):
    """Provenance metadata written next to every collected source."""

    name: str
    title: str
    url: str
    license: str
    notes: str = ""
    n_terms: int = 0
    n_segments: int = 0
