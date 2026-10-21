"""Publish the built dataset to the Hugging Face Hub."""

from pathlib import Path

from huggingface_hub import HfApi
from pydantic import BaseModel

from trad_gmt.build import BuildReport
from trad_gmt.io import PROCESSED

DEFAULT_REPO = "AdleBenSalem/watchmaking-fr-en-de"

CONFIGS: dict[str, str] = {
    "terms": "Concept-aligned terminology (fr/en/de) with definitions",
    "segments": "Multiparallel fr/en/de segments (en or de may be null)",
    "fr-en": "French → English pairs derived from segments",
    "fr-de": "French → German pairs derived from segments",
}


class PushConfig(BaseModel):
    repo_id: str = DEFAULT_REPO
    private: bool = True
    data_dir: Path = PROCESSED


def dataset_card(report: BuildReport, data_dir: Path) -> str:
    yaml_configs: list[str] = []
    for name in CONFIGS:
        files = sorted((data_dir / name).glob("*.parquet"))
        if not files:
            continue
        yaml_configs.append(f"- config_name: {name}\n  data_files:")
        yaml_configs.extend(f"  - split: {f.stem}\n    path: {name}/{f.name}" for f in files)
    sources = "\n".join(
        f"| `{s.name}` | [{s.title}]({s.url}) | {report.by_source.get(s.name, {}).get('terms', 0)} "
        f"| {report.by_source.get(s.name, {}).get('segments', 0)} | {s.license} |"
        for s in report.sources
    )
    sizes = "\n".join(f"| {k} | {v} |" for k, v in {**report.n_segments, **report.n_pairs}.items())
    configs = "\n".join(f"- **{k}** — {v}" for k, v in CONFIGS.items())
    return f"""---
language:
- fr
- en
- de
task_categories:
- translation
tags:
- watchmaking
- horology
- terminology
- multiparallel
pretty_name: Watchmaking FR/EN/DE multiparallel corpus
configs:
{chr(10).join(yaml_configs)}
---

# Watchmaking FR / EN / DE multiparallel corpus

Domain data for a French → English / German machine-translation system specialised
in watchmaking (haute horlogerie), built with the `trad-gmt` toolkit
(`uv run trad-gmt collect && uv run trad-gmt build && uv run trad-gmt push`).

## Configs

{configs}

`segments` rows carry `granularity` (`sentence`, `paragraph`, `document`) and `alignment`
(`native` = aligned unit in the source, `count` = sentence-aligned inside aligned blocks
because all languages had the same number of sentences). Splits are made by document
(`doc_id`) so no entry leaks between train / validation / test.

## Sources

| id | source | terms | segments | licence / terms |
|---|---|---|---|---|
{sources}

**Terms {report.n_terms}**

| split | rows |
|---|---|
{sizes}

Dropped by filters: `{report.dropped}`

## Licence

The texts belong to their respective owners (see table). This dataset is kept private and
is intended for research / internal model development only; do not redistribute.
"""


def push(cfg: PushConfig) -> str:
    report = BuildReport.model_validate_json((cfg.data_dir / "report.json").read_text())
    (cfg.data_dir / "README.md").write_text(dataset_card(report, cfg.data_dir), encoding="utf-8")
    api = HfApi()
    api.create_repo(cfg.repo_id, repo_type="dataset", private=cfg.private, exist_ok=True)
    api.upload_folder(
        repo_id=cfg.repo_id,
        repo_type="dataset",
        folder_path=str(cfg.data_dir),
        commit_message="Update watchmaking multiparallel dataset",
        delete_patterns=["*.parquet"],
    )
    return f"https://huggingface.co/datasets/{cfg.repo_id}"
