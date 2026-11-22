# GMT translation systems — built from the blocks we have

FR → EN (British) and FR → DE (Swiss) for GMT Magazine / WorldTempus watchmaking copy.
DeepL details in [deepl-system.md](deepl-system.md). A one-page summary of every result is in
[results.md](results.md). English as a source (EN → FR, EN → DE) is required too and not built yet.

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

## Metrics, revised (November 2026)

**Why.** In the WMT24 metrics shared task, MetricX-24 and xCOMET agree best with human MQM
ratings (≈ 0.72), ahead of COMET-22 (0.69), CometKiwi (0.64) and chrF (0.61). COMET-22 alone is
therefore no longer enough to separate systems that sit 0.1–0.5 points apart, and the
term-accuracy figure needed a definition that does not depend on inflection. `cluster/score.py`
now takes `--metrics` (comet22, cometkiwi22, metricx24, metricx24-qe, xcomet, xcomet-qe) and
`--terms-only`.

**Term accuracy, new definition.** A glossary term (one the reference uses) counts once per
passage. Three figures, each including the previous one:

- **exact** — the accent-folded term is a substring of the output (ß = ss). This is the figure in
  every table above; it is unchanged.
- **lemma** — exact, or the lemmatised term matches the lemmatised output word by word,
  lower-cased (the WMT25 terminology-task rule; lemmatiser: simplemma).
- **lemma + compound** — lemma, or (German) the term's last word is the head of a compound in the
  output ("Kaliber" in "Automatikkalibers").

Passages both Claude and DeepL translated (same passages as the tables above):

| Pool (passages, terms) | Claude exact / lemma / + compound | DeepL-GMT exact / lemma / + compound |
|---|---|---|
| EN GMT Magazine (271, 401) | 94.5 / 95.5 / 95.5 % | 91.5 / 92.5 / 92.5 % |
| DE GMT Magazine (255, 298) | 97.0 / 97.3 / 97.3 % | 93.6 / 93.6 / 93.6 % |
| EN house style (80, 128) | 93.8 / 94.5 / 94.5 % | 89.1 / 89.1 / 89.1 % |
| DE industry (45, 99) | 97.0 / 98.0 / 98.0 % | 85.9 / 85.9 / 85.9 % |

DeepL on all its passages (exact → lemma): EN magazine 92.0 → 92.9, EN style 89.7 → 89.9,
EN industry 87.3 → 88.2, DE magazine 92.2 → 92.5, DE industry 86.7 → 86.7 %. DeepL ablation, EN
(n = 91): raw 88.4 → 89.8, + context 91.2 → 92.5, + glossary 90.5 → 91.8, full 91.2 → 93.2,
Claude 95.2 → 96.6 %; the German ablation figures do not change.

Reading:
- The lemma rule adds 0 to 2 points, about the same for both systems. **DeepL's term score was
  not held down by inflection; Claude's lead (3–4 points on the magazine, 5 on house-style EN,
  12 on industry DE) stands.**
- The compound rule adds nothing here, because the exact rule is a substring test and already
  finds a term inside a compound or with an ending ("Kurven", "Gangreserveanzeige").
- That substring test also gives a few false hits ("Teil" in "teilweise", "Platin" in "Platinen",
  "red" in "hundred"). Counting lemma matches on whole words only (`terms_lemma_strict` in the
  JSON) gives Claude 94.0 / 90.9 % and DeepL 91.0 / 85.2 % on the EN / DE magazine. This figure is
  a lower bound: simplemma misses some German forms ("Werkstätten", "Unruhen") and a term used
  as the first part of a compound no longer counts.
- The fine-tuned model was **not re-scored**: its outputs are on the cluster, not in
  `data/ft/v2/`.

**MetricX-24** (`google/metricx-24-hybrid-large-v2p6`, MQM-style error score, 0 = perfect,
25 = worst, **lower is better**), GMT Magazine passages both systems translated, run locally:

| System | EN MetricX-24 | EN MetricX-24 QE | DE MetricX-24 | DE MetricX-24 QE |
|---|---|---|---|---|
| Claude Opus 5.5 draft + review (n = 271 / 255) | 3.60 | 4.13 | 1.98 | 2.32 |
| DeepL-GMT (S1) | **3.28** | **3.85** | **1.82** | **2.11** |

"QE" is the same model without the reference. DeepL is better by 0.32 (EN) and 0.17 (DE) with
the reference; the 95 % bootstrap intervals of the per-passage difference exclude zero
(EN 0.16–0.48, DE 0.06–0.28), and DeepL has the lower score on about 60–65 % of passages.
COMET-22 had the two systems level (84.7 / 84.8 and 81.5 / 82.0), so MetricX-24 agrees on the
direction and makes the difference clearer. This is the Large model; the XL and XXL variants
correlate better with MQM and need a GPU.

**xCOMET — not run.** `Unbabel/XCOMET-XL` is gated on Hugging Face and the account has not
accepted its licence (access refused); the checkpoint is also 14 GB, too large for the 16 GB
laptop. The code path exists (`--metrics xcomet,xcomet-qe`, error spans kept per segment) and
is untested; it needs the licence accepted and a GPU job.

**S3 selection, revised.** `cluster/select_qe.py` no longer selects with one metric: single-metric
QE reranking does not beat the plain output in human MQM, a rank-averaged ensemble does (Kovacs
et al., WMT24). It now averages the candidates' ranks under several QE metrics (run here with
CometKiwi + MetricX-24 QE; xCOMET-QE not available) and breaks ties with the mean z-score. **Its
output must not be evaluated with a metric of a family used to select** — so no COMET or MetricX
figure is given for it, and the "+0.2–0.3 COMET" of the CometKiwi-only S3 above should be read
as an upper bound. With the metrics left (658 passages; DeepL picked 63 %, same pick as
CometKiwi alone on 78 %):

| Pool | Claude chrF++ / terms (lemma) | DeepL | S3 CometKiwi only | S3 rank-average |
|---|---|---|---|---|
| EN GMT Magazine (271) | 73.7 / 95.5 % | 73.0 / 92.5 % | 73.5 / 94.0 % | 73.3 / 94.5 % |
| DE GMT Magazine (255) | 57.9 / 97.3 % | 57.5 / 93.6 % | 57.8 / 95.3 % | 57.9 / 95.3 % |
| EN house style (80) | 64.8 / 94.5 % | 63.6 / 89.1 % | 64.8 / 90.6 % | 64.4 / 92.2 % |
| DE industry (45) | 62.4 / 98.0 % | 59.6 / 85.9 % | 60.6 / 90.9 % | 60.1 / 89.9 % |

On these two measures both selections fall between the two engines and neither beats Claude;
whether the rank-average is better than either engine needs xCOMET or human ratings. With two
candidates and two metrics the rank-average ties on 37 % of passages (the metrics disagree) and
the z-score decides; a third metric or candidate would make the ranks more informative.

## Pipeline, revised (November 2026)

Implemented in the web desk (`webapp/`); the Python batch translator still uses the previous single-pass editor.

| Change | What it does | Where |
|---|---|---|
| Term pruning | One low-effort Claude call drops termbase matches that are ordinary words in this text ("approche", "soleil"), before prompts, checks and highlights use them. When in doubt the term is kept. | `app/api/terms`, `PRUNE_SYSTEM` |
| Coverage-ranked examples | BM25 proposes 8× the examples needed per sentence; each pick is the candidate covering most of the sentence's words and word pairs not yet shown (R-BM25). Matches under 40 % of the best score are dropped. | `lib/server/engine.ts` `retrieve` |
| Whole article + decisions | For a text split in parts, each call gets the whole French article, the translation so far (last 6,000 characters) and the term renderings already chosen. DeepL gets the preceding 2,500 characters and the next paragraph as `context`. | `components/run.ts`, `renderContext` |
| Diagnose, then repair | The editor first lists errors as verbatim spans with a category (accuracy, terminology, style, fluency, typography) and a severity (minor, major, critical), and rules on each QA flag. A second call returns one replacement per error. | `DIAGNOSE_*`, `REPAIR_*` |
| Edit guard | The desk applies the replacements itself. An edit is refused if its wording is not in the draft exactly once, if it changes the paragraph structure, or if the automatic checks object more after it than before. | `applyEdits` |
| Component switches | Termbase, pruning, examples, style guide, editor and DeepL context can each be switched off for a run; the previous editor is kept as a candidate. | `lib/candidates.ts` |
| Shared record | Every run logs numbers only (errors by kind, edits applied and refused, QA flags, cost, time). Validations store source, draft, system text and the editor's text; judgments store error spans and 0–100 scores. Private Vercel Blob store, Paris region. | `lib/server/store.ts`, `/scoreboard` |

Not done, on purpose: no additional agent roles, no best-of selection on a single metric, and no reading of a chrF++ drop after editing as a loss. Whether the new editor beats the previous one is to be settled by blind ratings (candidate "Claude + previous editor" on the Compare page).

**Editor measured on the same draft (22 November 2026).** 80 held-out magazine passages (40 EN, 40 DE), one Claude draft each, both editors run on that draft, effort high (`data/ft/v2/editor-eval2/`):

| | New editor | Previous editor | No editor |
|---|---|---|---|
| COMET-22 EN / DE | 84.11 / 81.99 | 84.13 / 81.86 | 84.09 / 81.95 |
| MetricX-24 EN / DE (lower is better) | 4.84 / 2.52 | 4.85 / 2.51 | 4.87 / 2.53 |
| MetricX-24 QE EN / DE | 5.36 / 3.08 | 5.40 / 3.06 | 5.39 / 3.07 |
| chrF++ EN / DE | 76.30 / 59.54 | 76.22 / 59.46 | 76.36 / 59.62 |
| Passages unchanged EN / DE (of 40) | 32 / 37 | 27 / 22 | all |
| Editor cost per 1,000 words EN / DE | $0.18 / $0.23 | $0.23 / $0.31 | draft alone: $0.22 / $0.33 |

Paired COMET-22 difference against no editor, with 95 % bootstrap interval: new editor +0.03 [−0.02, +0.08] (8 passages better, 4 worse, 68 the same); previous editor −0.02 [−0.19, +0.08] (19 better, 13 worse, 48 the same). On the passages each one changed: new editor (11) COMET-22 +0.22, MetricX-24 −0.14; previous editor (31) COMET-22 −0.06, MetricX-24 −0.05. The new editor diagnosed 13 errors (8 fluency, 3 style, 1 terminology, 1 typography; 3 major, no accuracy error) and the guard refused no edit.

Reading: on a Claude draft neither editor changes the scores; the new one edits a third as often and its edits are more often improvements. A first run with a separate draft per candidate (79 passages, `editor-eval/`) showed gaps of 0.2–0.3 COMET-22 that were draft-to-draft noise. Not measured: the editor on a DeepL draft.

## Testing them (desk, November 2026)

- **Translator** (`/`) — one system per run: *Claude + editor* · *DeepL + Claude editor* (S2) ·
  *Claude + DeepL, one editor* (S4) · *DeepL alone* (S1) · *fine-tuned model alone*. Two presets:
  "Quick draft" (DeepL + Claude editor, effort high) and "Publication" (Claude + editor, effort
  xhigh). French, English and German are read paragraph by paragraph with the termbase terms
  highlighted in all three; a strip under each language shows what each stage did.
- **Compare** (`/compare`) — any systems, and any system with one component switched off, on the
  same text, **blind** by default. Raters select wrong wording and mark it minor or major, give a
  0–100 score (Error Span Annotation), and pick the best. 40 held-out GMT Magazine passages
  (issues 97–98) can be loaded, and then **GMT's own published translation** joins the candidates,
  hidden among the systems.
- **Scoreboard** (`/scoreboard`) — pooled across raters: score and errors per system, the paired
  "with vs without" difference per component, what each stage does per system (errors diagnosed
  by kind, edits applied and refused, QA flags before and after, cost and time per 1,000 words),
  and the share of words editors change before validating. Downloads as JSONL.
