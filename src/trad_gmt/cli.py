"""Command line entry point: ``uv run trad-gmt --help``."""

import logging
from collections.abc import Callable

import typer

from trad_gmt.build import BuildConfig
from trad_gmt.build import build as build_dataset
from trad_gmt.hub import DEFAULT_REPO, PushConfig
from trad_gmt.hub import push as push_dataset
from trad_gmt.io import SourceOutput
from trad_gmt.sources import berner, brands, epo, fhh, patek, rolex, wikidata, worldtempus

app = typer.Typer(no_args_is_help=True, help="GMT watchmaking FR→EN/DE translation toolkit.")

COLLECTORS: dict[str, Callable[[], SourceOutput]] = {
    berner.NAME: berner.collect,
    fhh.NAME: fhh.collect,
    epo.NAME: epo.collect,
    brands.NAME: brands.collect,
    patek.NAME: patek.collect,
    wikidata.NAME: wikidata.collect,
    worldtempus.NAME: worldtempus.collect,
    rolex.NAME: rolex.collect,
}


@app.callback()
def _setup(verbose: bool = False) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    for noisy in ("httpx", "httpx2", "httpcore"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


@app.command()
def collect(
    sources: list[str] = typer.Argument(None, help="Sources to collect (default: all)"),
) -> None:
    """Crawl/parse sources into data/interim/<source>/."""
    for name in sources or list(COLLECTORS):
        if name not in COLLECTORS:
            raise typer.BadParameter(f"unknown source {name!r}; choose from {list(COLLECTORS)}")
        out = COLLECTORS[name]()
        path = out.save()
        typer.echo(f"{name}: {out.info.n_terms} terms, {out.info.n_segments} segments → {path}")


@app.command()
def build(
    sources: list[str] = typer.Argument(None, help="Sources to include (default: all)"),
) -> None:
    """Merge collected sources into data/processed/ (Parquet configs + report.json)."""
    report = build_dataset(BuildConfig(sources=sources or None))
    typer.echo(report.model_dump_json(indent=2, exclude={"sources"}))


@app.command()
def push(
    repo_id: str = DEFAULT_REPO,
    public: bool = typer.Option(False, help="Make the dataset public (default private)"),
) -> None:
    """Upload data/processed/ to the Hugging Face Hub (needs `hf auth login`)."""
    url = push_dataset(PushConfig(repo_id=repo_id, private=not public))
    typer.echo(f"pushed → {url}")


if __name__ == "__main__":
    app()
