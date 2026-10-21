"""Reading/writing collector outputs (JSONL of pydantic models)."""

from collections.abc import Iterable
from pathlib import Path

from pydantic import BaseModel

from trad_gmt.schemas import ParallelSegment, SourceInfo, TermEntry

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data"
RAW = DATA / "raw"
INTERIM = DATA / "interim"
PROCESSED = DATA / "processed"


def write_jsonl(path: Path, rows: Iterable[BaseModel]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with path.open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(row.model_dump_json(exclude={"n_langs"}) + "\n")
            n += 1
    return n


def read_jsonl[M: BaseModel](path: Path, model: type[M]) -> list[M]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8") as fh:
        return [model.model_validate_json(line) for line in fh if line.strip()]


class SourceOutput(BaseModel):
    """Everything one collector produced."""

    info: SourceInfo
    terms: list[TermEntry] = []
    segments: list[ParallelSegment] = []

    def save(self) -> Path:
        out = INTERIM / self.info.name
        self.info.n_terms = write_jsonl(out / "terms.jsonl", self.terms)
        self.info.n_segments = write_jsonl(out / "segments.jsonl", self.segments)
        (out / "source.json").write_text(self.info.model_dump_json(indent=2), encoding="utf-8")
        return out

    @classmethod
    def load(cls, name: str) -> "SourceOutput":
        out = INTERIM / name
        info = SourceInfo.model_validate_json((out / "source.json").read_text(encoding="utf-8"))
        return cls(
            info=info,
            terms=read_jsonl(out / "terms.jsonl", TermEntry),
            segments=read_jsonl(out / "segments.jsonl", ParallelSegment),
        )


def available_sources() -> list[str]:
    return sorted(p.parent.name for p in INTERIM.glob("*/source.json"))
