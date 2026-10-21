# trad-gmt

Specialised machine translation **French → English / German** for watchmaking
(haute horlogerie), built for GMT Publishing. The goal is exact technical
terminology and GMT's editorial style and fluency.

This repository currently covers **phase 1, day 1: data**:

1. Collect multiparallel FR/EN/DE watchmaking data and glossaries → a Hugging Face dataset.
2. Align the 10 GMT magazines (source + translations) → `data/gmt/` (PDFs to come).
3. Use online watch glossaries as the terminology base for glossary-constrained translation.

## Setup

```bash
uv sync
uv run hf auth login          # once, to push to the Hub
```

## Pipeline

```bash
uv run trad-gmt collect                 # all sources → data/interim/<source>/
uv run trad-gmt collect berner fhh      # or a subset
uv run trad-gmt build                   # merge, filter, dedupe, split → data/processed/
uv run trad-gmt push                    # → hf.co/datasets/AdleBenSalem/watchmaking-fr-en-de (private)
```

Every HTTP response is cached in `data/raw/`, so re-running a collector is cheap and
interrupted crawls resume where they stopped.

## Sources

| source | languages | what | alignment |
|---|---|---|---|
| `berner` — FH Berner *Dictionnaire professionnel illustré de l'horlogerie* | fr·en·de | ~3.5k concepts, 5.5k terms incl. sub-entries, translated definitions + examples | concept id; sentences by count inside aligned blocks |
| `fhh` — Fondation Haute Horlogerie | fr·en | encyclopedia (≈650 entries), watch novelties (≈2k editorial descriptions + spec sheets), library articles | search-index GUID; LaBSE sentence alignment |
| `patek` — Patek Philippe glossary | fr·en | 315 entries with definitions | bijective LaBSE matching |
| `wikidata` — fr.wikipedia horology categories | fr·en·de | concept labels + short descriptions | Wikidata item |
| `brands` — Jaeger-LeCoultre, A. Lange & Söhne, Audemars Piguet | fr·en·de | news, savoir-faire, manufacture and product pages | same slug per locale; LaBSE sentence alignment |
| `epo` — European patents, IPC G04 | fr·de·en | claims of ≈6.6k granted patents | claim number |

Not collected (yet): bot-protected brand sites (Rolex, Vacheron Constantin, IWC,
Cartier, Swatch Group brands), general web corpora (CCMatrix / ParaCrawl keyword
mining), WorldTempus (competitor magazine).

## Dataset layout

| config | content |
|---|---|
| `terms` | `fr`, `en`, `de`, part of speech, definitions, `source`, `parent_id` for sub-entries |
| `segments` | multiparallel rows `fr`, `en`, `de` (targets may be null), `granularity`, `alignment`, `score_en`/`score_de` (LaBSE cosine for embedding-aligned rows) |
| `fr-en`, `fr-de` | `src`/`tgt` pairs derived from `segments` |

Splits (`train` / `validation` / `test`) are made per document, so no dictionary entry
or article leaks across splits. Filters: missing targets, length ratio, untranslated
copies, number mismatches (the mismatching target is removed), and exact duplicates.

## Code

```
src/trad_gmt/
  schemas.py      TermEntry, ParallelSegment, SourceInfo (pydantic)
  http.py         polite cached async fetcher
  text.py         normalisation, fr/en/de sentence splitting, language guess
  align.py        LaBSE sentence aligner (vecalign-style DP, pivot on French)
  sources/        one collector per source
  build.py        merge → Parquet configs + report.json
  hub.py          dataset card + upload
  cli.py          `trad-gmt` command
```

## Licensing

All the crawled texts remain the property of their owners (FH, FHH, brands, EPO, Wikidata
CC0). The dataset is pushed **private** and is meant for internal research and model
development only.
