"""Command line entry point: ``uv run trad-gmt --help``."""

import logging
import sys
from collections.abc import Callable
from pathlib import Path

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


@app.command()
def index(rebuild: bool = typer.Option(True, help="Rebuild even if data/index exists")) -> None:
    """Build the glossary + translation-memory indexes (data/index/resources.pkl)."""
    from trad_gmt.mt.resources import load_resources

    res = load_resources(rebuild=rebuild)
    sizes = {
        f"{lang}/{name}": len(pool.examples)
        for lang, mem in res.memories.items()
        for name, pool in mem.pools.items()
    }
    typer.echo(f"glossary keys: {len(res.glossary)}; memory: {sizes}")


@app.command()
def translate(
    source: Path = typer.Argument(None, help="French text file (default: stdin)"),
    to: str = typer.Option("en", "--to", help="Target language: en or de"),
    effort: str = typer.Option("xhigh", help="Claude effort: low|medium|high|xhigh|max"),
    model: str = typer.Option("claude-opus-5-5", help="Claude model id"),
    review: bool = typer.Option(True, help="Run the editor review pass"),
    swiss: bool = typer.Option(False, help="German: Swiss orthography (ss, no ß)"),
    details: Path = typer.Option(None, help="Write glossary/examples/changes JSON here"),
) -> None:
    """Translate French watchmaking copy into English or German in GMT house style."""
    from trad_gmt.mt.translator import TranslateConfig, Translator

    text = source.read_text(encoding="utf-8") if source else sys.stdin.read()
    cfg = TranslateConfig(model=model, effort=effort, review=review, swiss_german=swiss)
    translator = Translator(config=cfg)
    result = translator.translate(
        text, to, on_chunk=lambda i, n, r: typer.echo(f"chunk {i + 1}/{n} done", err=True)
    )
    if details:
        details.write_text(result.model_dump_json(indent=2), encoding="utf-8")
    typer.echo(result.translation)


@app.command()
def evaluate(
    to: str = typer.Option("en", "--to"),
    n_docs: int = typer.Option(10, help="Held-out documents to translate"),
    effort: str = typer.Option("xhigh"),
    out: Path = typer.Option(Path("data/eval/report.json")),
) -> None:
    """Translate held-out test documents; report chrF (draft vs reviewed) and term adherence."""
    from trad_gmt.mt.evaluate import EvalConfig
    from trad_gmt.mt.evaluate import evaluate as run_eval
    from trad_gmt.mt.translator import TranslateConfig, Translator

    translator = Translator(config=TranslateConfig(effort=effort))
    summary = run_eval(translator, EvalConfig(target=to, n_docs=n_docs, out=out))
    typer.echo(summary)


@app.command("export-web")
def export_web_cmd() -> None:
    """Write web/bundle.json (glossary, memory sample, prompts) for the browser demo."""
    from trad_gmt.mt.export import export_web
    from trad_gmt.mt.resources import load_resources

    typer.echo(export_web(load_resources()))


@app.command("style-stats")
def style_stats_cmd() -> None:
    """Re-measure the English house-style conventions on GMT's own translations."""
    from trad_gmt.mt.resources import ResourceConfig, is_house_style, load_segments
    from trad_gmt.mt.style import style_stats

    seg = load_segments(ResourceConfig())
    gmt = seg[(seg.source == "worldtempus") & seg.tags.map(lambda t: is_house_style(list(t)))]
    for label, n in style_stats(gmt.en.dropna()).items():
        typer.echo(f"{label:>22}: {n}")


if __name__ == "__main__":
    app()
