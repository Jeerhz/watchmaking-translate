# GMT translation systems — built from the blocks we have

FR → EN (British) and FR → DE (Swiss) for GMT Magazine / WorldTempus watchmaking copy.
DeepL details in [deepl-system.md](deepl-system.md).

## The blocks

| Block | What it brings | Cost | Status |
|---|---|---|---|
| **TM** — GMT's past translations (WorldTempus EN 190k sentences, GMT Magazine EN 4.1k / DE 4.5k) | exact reuse of what GMT already published (magazine articles are republished online); style examples | free | in the desk (BM25 examples) |
| **Termbase** — 4,932 French keys (FH Berner, FHH, Patek, Wikidata, GMT usage) | term detection + approved equivalents | free | in the desk |
| **Attested glossary** — 57 EN / 24 DE terms GMT translates consistently (≥ 80 %) | hard terminology an MT engine can enforce | free | new (`trad_gmt.mt.deepl`) |
| **House style** — EN and Swiss DE rules measured on GMT's own texts | style guide for Claude; DeepL style list + instructions | free | in the desk |
| **DeepL** (EN-GB / DE-CH, glossary, style list, context, soft term instructions) | strong, fast, cheap MT; native Swiss German | ≈ €0.35 / article (Growth) | new |
| **Claude Opus 5.5** draft → chief sub-editor review → QA ruling | GMT voice from examples + guide, editorial judgement, explanations | ≈ $3–4 / article | in the desk (credit-dependent) |
| **Fine-tuned Gemma 4** (E4B v1; 12B / E4B v2 pending) | GMT wording learnt from 150k passages, self-hostable | ≈ 0 (ZeroGPU / own GPU) | in the desk (comparison column) |
| **QA** (terms, figures, ™/®, leftover French, typography, Swiss ß) | deterministic checks | free | in the desk |
| **CometKiwi** (Unbabel wmt22-cometkiwi-da) | reference-free quality estimate per segment | CPU/GPU | new |

## Systems

**S1 — DeepL-GMT** (cheap, robust). TM exact match → DeepL with attested glossary, GMT style
list / rules, soft term instructions and the article's preceding sentences as context → QA.
No LLM in the loop: keeps working when the Claude credit is empty (twice in two weeks).

**S2 — DeepL draft + Claude editor** (recommended default). S1's draft goes to the existing
Claude review step (GMT examples from the TM, house style, term list, QA flags), which edits
rather than translates. Claude's tokens drop to the edit; DeepL brings fluent Swiss German;
Claude brings GMT's voice and term discipline (its main lead over DeepL: 95–97 % vs 91–93 %
of approved terms).

**S3 — Multi-candidate selection.** Per paragraph, candidates from DeepL-GMT, the fine-tuned
model and (when available) Claude; CometKiwi scores each, QA errors are penalised, the best is
kept. No extra generation cost beyond the candidates; picks the right engine per paragraph.

**S4 — Claude fusion editor** (highest quality, highest cost). Claude's sub-editor sees two or
three candidates (DeepL-GMT, fine-tuned model, its own draft) plus GMT examples and composes
the final text — the "combine several MT outputs with an LLM" pattern from recent WMT systems.

All four start with the **TM exact-match pass**: a French sentence GMT has already published
in translation (≥ 95 % fuzzy match) is reused as is, and flagged as such.

## Evidence so far

See the results section (filled from `data/ft/v2/` runs).
