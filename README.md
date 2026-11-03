# trad-gmt

Specialised machine translation **French → English / German** for watchmaking
(haute horlogerie), built for GMT Publishing. The goal is exact technical
terminology and GMT's editorial style and fluency.

The repository covers:

1. **Data**: collect multiparallel FR/EN/DE watchmaking data and glossaries → a Hugging Face dataset.
2. Align the 10 GMT magazines (source + translations) → `data/gmt/` (PDFs to come).
3. **Translation system** (`src/trad_gmt/mt/`): glossary- and memory-constrained translation
   with Claude, in GMT's house style, plus a browser demo (`web/`).

## Translation system

```
French text ─┬─ glossary match ──────── GMT usage > FH Berner > Patek > FHH > Wikidata
             ├─ memory retrieval (BM25) ─ GMT's own translations (WorldTempus editorial,
             │                            ≈190k sentences) + FH / brand texts (≈36k EN, ≈28k DE)
             └─ style guide ───────────── measured on GMT's English (British spelling, “ ”,
                                          “at 6 o’clock”, calibre, 41 mm, …)
        → Claude Opus 5.5 draft  → editor pass (accuracy, terminology, style, fluency) → final
```

- **Glossary** (`glossary.py`): accent-folded, plural-tolerant, longest-match lookup of
  ≈4.9k French keys. Homonyms keep a short definition so the model picks the right sense.
  FHH spec-sheet lists and untranslated copies are dropped; when FH Berner covers a term,
  FHH/Wikidata candidates are dropped. A small **GMT usage** layer (`style.HOUSE_TERMS`)
  ranks above Berner where GMT's published texts consistently differ (lugs, white gold,
  rose gold, self-winding, Côtes de Genève…), with the corpus counts recorded beside each.
- **Translation memory** (`memory.py`): BM25 over the French side, per sentence. English uses
  a `style` pool (GMT editorial, `type:maison-*` / GMT Magazine; press releases excluded) and a
  `domain` pool (Berner, FHH, Patek, brands, Rolex). German uses the domain pool only: the
  dataset has no GMT German yet. Patent claims are excluded (wrong register).
- **Style** (`style.py`): English rules measured on GMT's translations
  (`uv run trad-gmt style-stats` re-measures them); German rules from Berner and the German
  brand pages, standard ß by default, `--swiss` for Swiss spelling.
- **Model** (`translator.py`): `claude-opus-5-5`, effort `xhigh` (quality over speed),
  streaming, server-side refusal fallback, cached system prompt. Long texts are chunked by
  paragraph (~1,200 words) with the previous translated paragraphs passed as context.
  The editor pass returns the final text plus a list of changes with reasons.

```bash
uv run trad-gmt index                                  # build data/index/ from data/processed/
export ANTHROPIC_API_KEY=...                           # needed for translate / evaluate
uv run trad-gmt translate article_fr.txt --to en       # or --to de [--swiss]
uv run trad-gmt translate article_fr.txt --to en --details run.json   # glossary/examples/edits
uv run trad-gmt evaluate --to en --n-docs 10           # chrF vs GMT's published translation
```

`evaluate` translates held-out test articles (the memory is built from `train` only) and
reports chrF for the draft and for the reviewed text, plus glossary-term adherence.

### Inference and hosting

- **Inference**: the Anthropic API (Claude Opus 5.5) — the strongest option for long-form,
  style-sensitive, glossary-constrained translation. The same code runs on Amazon Bedrock,
  Google Cloud Vertex AI or Microsoft Foundry by swapping the client class if GMT needs data
  residency there.
- **Test interface**: `web/index.html` is published as a private claude.ai artifact. It
  mirrors the pipeline in the browser (same normalisation, glossary, BM25 and prompt
  templates, exported by `uv run trad-gmt export-web` into `web/bundle.json`, ≈36k sentences)
  and calls Claude on the viewer's own Claude account, so it needs no API key.
  `web/bundle.json` contains GMT and brand texts, so it is gitignored and only shipped
  inside the private artifact.
- **Production API**: wrap `Translator` in any container host (Hugging Face Spaces, Cloud
  Run, Fly.io…) with `ANTHROPIC_API_KEY` and `HF_TOKEN` as secrets; `data/index/` is rebuilt
  from the Hub dataset on first start.

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
| `worldtempus` — WorldTempus (GMT Publishing) | fr·en | ≈23k articles published in both editions — **GMT's own translations, the reference style** | Drupal node id; LaBSE sentence alignment; `tags` keep category / folder (e.g. *GMT Magazine*) / editor / date |
| `rolex` — rolex.com via the Wayback Machine | fr·en·de | ≈3k editorial pages (World of Rolex, watchmaking, Rolex Family, Perpetual, magazine, collections) | same path under `/fr/`, `/`, `/de/`; LaBSE sentence alignment |
| `berner` — FH Berner *Dictionnaire professionnel illustré de l'horlogerie* | fr·en·de | ~3.5k concepts, 5.5k terms incl. sub-entries, translated definitions + examples | concept id; sentences by count inside aligned blocks |
| `fhh` — Fondation Haute Horlogerie | fr·en | encyclopedia (≈650 entries), watch novelties (≈2k editorial descriptions + spec sheets), library articles | search-index GUID; LaBSE sentence alignment |
| `patek` — Patek Philippe glossary | fr·en | 315 entries with definitions | bijective LaBSE matching |
| `wikidata` — fr.wikipedia horology categories | fr·en·de | concept labels + short descriptions | Wikidata item |
| `brands` — Jaeger-LeCoultre, A. Lange & Söhne, Audemars Piguet | fr·en·de | news, savoir-faire, manufacture and product pages | same slug per locale; LaBSE sentence alignment |
| `epo` — European patents, IPC G04 | fr·de·en | claims of ≈6.6k granted patents | claim number |

Not collected (yet): bot-protected brand sites (Vacheron Constantin, IWC, Cartier,
Swatch Group brands), general web corpora (CCMatrix / ParaCrawl keyword mining).

## Dataset layout

| config | content |
|---|---|
| `terms` | `fr`, `en`, `de`, part of speech, definitions, `source`, `parent_id` for sub-entries, `priority` (1 = FH Berner, the reference glossary; 2 Patek; 3 FHH; 4 Wikidata) |
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

All the crawled texts remain the property of their owners (GMT Publishing for WorldTempus;
FH, FHH, brands, EPO; Wikidata is CC0). The dataset is pushed **private** and is meant for internal research and model
development only.
