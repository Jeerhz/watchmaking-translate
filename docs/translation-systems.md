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

## Evidence so far (November 2026)

Test set `ft/v2` (1,207 held-out passages). Metrics: COMET-22, chrF++ (ß = ss for German),
BLEU, share of approved terms (the termbase terms GMT's reference uses) found in the output.

**GMT Magazine issues 97–98** (GMT's own EN and Swiss DE), passages both systems translated:

| System | EN COMET | EN chrF++ | EN terms | DE COMET | DE chrF++ | DE terms |
|---|---|---|---|---|---|---|
| Claude Opus 5.5 draft + review (n = 271 / 255) | 84.7 | **73.7** | **94.5 %** | 81.5 | **57.9** | **97.0 %** |
| DeepL-GMT (S1) | **84.8** | 73.0 | 91.5 % | **82.0** | 57.5 | 93.6 % |

**Earlier test pools** (WorldTempus house-style EN, industry DE), passages Claude translated:

| System | EN style COMET / chrF++ / terms (n = 80) | DE industry COMET / chrF++ / terms (n = 45) |
|---|---|---|
| Claude Opus 5.5 draft + review | 83.8 / 64.8 / **93.8 %** | 82.3 / **62.4** / **97.0 %** |
| DeepL-GMT (S1) | **83.9** / 63.6 / 89.1 % | **82.6** / 59.6 / 85.9 % |
| Gemma 4 E4B fine-tuned v1 | 83.7 / **66.1** / 89.1 % | 81.9 / 60.0 / 84.8 % |

**DeepL ablation** (GMT Magazine, EN n = 91 / DE n = 88):

| DeepL configuration | EN COMET | EN chrF++ | EN terms | DE COMET | DE terms |
|---|---|---|---|---|---|
| raw (EN-GB / DE-CH) | 84.4 | 70.4 | 88.4 % | 80.9 | 91.6 % |
| + previous sentences as context | 84.9 | 72.1 | 91.2 % | **81.4** | **94.1 %** |
| + GMT glossary | 84.8 | 72.0 | 90.5 % | 81.3 | 93.3 % |
| + style list / rules + soft terms (S1) | **85.2** | **72.3** | 91.2 % | 80.7 | 94.1 % |

Reading:
- Customised DeepL **matches Claude on COMET** (overall adequacy/fluency) at ~ 1/10 of the cost, in
  both languages, and is the most fluent Swiss German engine we have.
- Claude stays **closer to GMT's wording** (chrF++, BLEU) and **applies approved terms better**
  (+3 to +11 points) — the editorial review and the examples matter there.
- In DeepL, **context is the lever that pays** (+0.5 COMET, +1.7 chrF++, +3 pts terms); the hard
  glossary adds nothing measurable on top (DeepL already knows these terms); the German inline
  house rules cost 0.7 COMET → keep German rules minimal; the English style list helps BLEU (+3.5).
- The fine-tuned 4B model is closest to GMT's English wording (chrF++ 66.1) but weakest on terms.

**S3 — CometKiwi selection between Claude and DeepL** (658 passages both translated; DeepL
picked 59 %):

| Pool | Claude COMET / terms | DeepL COMET / terms | S3 COMET / terms |
|---|---|---|---|
| EN GMT Magazine (271) | 84.7 / 94.5 % | 84.8 / 91.5 % | **85.0** / 93.3 % |
| DE GMT Magazine (255) | 81.5 / 97.0 % | 82.0 / 93.6 % | **82.2** / 95.3 % |
| EN house style (80) | 83.8 / 93.8 % | 83.9 / 89.1 % | **84.1** / 89.8 % |
| DE industry (45) | 82.3 / 97.0 % | 82.6 / 85.9 % | **82.7** / 90.9 % |

S3 is best on COMET everywhere, but by only +0.2–0.3, and it gives back part of Claude's term
lead; CometKiwi and COMET are from the same model family, so this gain is optimistic. Selection
alone is not worth Claude's full cost — it pays only once Claude's draft is replaced by an edit.

These support **S2** (DeepL draft + Claude editor): DeepL supplies adequacy and Swiss German, the
Claude review supplies GMT wording and term discipline, at roughly half of today's Claude cost.
S2 and S4 need Anthropic credit to be measured.

**Applied in the desk:** English → DeepL with style list + soft terms + context; German →
DeepL with glossary + context only (the German inline rules cost 0.7 COMET).

## Testing them (desk, November 2026)

- **Translator page** — "Pipeline" selector: *Claude* · *DeepL → Claude editor* (S2) · *Claude +
  DeepL fusion* (S4, the editor sees DeepL's version beside Claude's draft); DeepL alone (S1) and
  the fine-tuned model stay as comparison tabs. Every step, prompt, change and cost is shown.
- **Compare systems page** (`/compare`) — runs any of the five systems on the same text, both
  languages, shown paragraph by paragraph; **blind** by default (shuffled "System A/B/…");
  1–5 rating, best pick and a note per candidate; saved in the browser, exportable as CSV, with a
  running summary (mean rating, times chosen best). 40 held-out GMT Magazine passages (issues
  97–98) can be loaded, and then **GMT's own published translation** joins the candidates, hidden
  among the systems — the human benchmark.
