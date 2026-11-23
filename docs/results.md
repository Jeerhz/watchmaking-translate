# Results so far (22 November 2026)

Everything measured to date, in one page. Details and full tables are in
[translation-systems.md](translation-systems.md) and [deepl-system.md](deepl-system.md).

**Scope of these results: French → English (British) and French → German (Swiss) only.**
English → French and English → German are now built in the desk but not measured; see
[English as a source](#english-as-a-source-built-not-measured).

## How we measure

- **Test set**: 1,207 held-out passages (1–5 sentences each), from articles no system saw in
  training or retrieval. The main pool is GMT Magazine issues 97–98, GMT's own English and
  Swiss German.
- **COMET-22** (0–100, higher is better) and **MetricX-24** (0–25, lower is better): overall
  quality against GMT's published translation. MetricX-24 agrees better with human ratings.
- **chrF++** (higher is better): closeness to GMT's exact wording.
- **Term accuracy**: share of the approved terms GMT's translation uses that the output also uses.
- No blind ratings by GMT editors have been analysed yet. The automatic scores below separate
  systems that are far apart; they cannot settle gaps of a few tenths of a point.

## What works best

| Need | Best choice today | Why |
|---|---|---|
| Publication quality | Claude Opus 5.5 with termbase, GMT examples and style guide | Level with DeepL on overall quality, 3–12 points ahead on approved terms, closest to GMT's wording |
| Low cost | DeepL (EN-GB / DE-CH) reading the surrounding paragraphs | Level with Claude on COMET-22, slightly ahead on MetricX-24, about a tenth of the cost |
| Editing step | The new "diagnose, then repair" editor | Changes a third as many passages as the previous editor, and its changes help twice in three |
| Example retrieval | BM25 (word match) | Shows the approved term in context more often than embeddings, in every pool |

No system is clearly ahead on overall quality. The choice is between Claude's terminology and
wording, and DeepL's price.

## Systems compared

GMT Magazine issues 97–98, passages every system translated (271 English, 255 German):

| System | EN COMET-22 | EN MetricX-24 | EN chrF++ | EN terms | DE COMET-22 | DE MetricX-24 | DE chrF++ | DE terms |
|---|---|---|---|---|---|---|---|---|
| Claude Opus 5.5, draft + previous editor | 84.7 | 3.60 | **73.7** | **94.5 %** | 81.5 | 1.98 | **57.9** | **97.0 %** |
| DeepL, customised for GMT | **84.8** | **3.28** | 73.0 | 91.5 % | **82.0** | **1.82** | 57.5 | 93.6 % |
| Best of the two per passage (CometKiwi) | 85.0 | not scored | 73.5 | 93.3 % | 82.2 | not scored | 57.8 | 95.3 % |

Earlier pools (80 English house-style passages, 45 German industry passages):

| System | EN COMET-22 / chrF++ / terms | DE COMET-22 / chrF++ / terms |
|---|---|---|
| Claude Opus 5.5, draft + previous editor | 83.8 / 64.8 / **93.8 %** | 82.3 / **62.4** / 97.0 % |
| DeepL, customised for GMT | **83.9** / 63.6 / 89.1 % | **82.6** / 59.6 / 85.9 % |
| Gemma 4 E4B, fine-tuned by us | 83.7 / **66.1** / 89.1 % | 81.9 / 60.0 / 84.8 % |
| Gemma 4 12B, not tuned | 81.7 / 59.7 / 91.4 % | 80.5 / 55.9 / **98.0 %** |
| Gemma 4 E4B, not tuned | 82.0 / 60.4 / 90.6 % | 79.5 / 54.7 / 96.0 % |

- **Claude and DeepL are level on COMET-22.** MetricX-24 puts DeepL ahead by 0.32 (English) and
  0.17 (German); the difference is small but consistent (DeepL scores better on 60–65 % of passages).
- **Claude applies approved terms better**: 3–4 points on the magazine, 5 on house-style English,
  11 on industry German. Counting inflected forms as matches moves both systems by at most
  2 points, so the gap is real.
- **Fine-tuning works on a small model**: +1.7 COMET-22 in English and +2.4 in German over the
  same model untuned. The tuned 4B model ties Claude on English COMET-22 and is the closest to
  GMT's wording, but it is the weakest on terms, and behind in German.

## Components tested

| Component | Test | Result | Decision |
|---|---|---|---|
| Retrieval method | BM25, embeddings, hybrid and reranking; 600 held-out sentences per pool, two embedding models | BM25 shows the approved term in context most often (GMT English: 48.4 % against 45.0 % hybrid, 34.5 % embeddings) | Keep BM25, no embeddings |
| DeepL: surrounding sentences as context | 91 EN / 88 DE passages | +0.5 COMET-22, +1.7 chrF++, +3 points on terms | Kept |
| DeepL: hard glossary | same | No measurable gain on top of context | Kept, harmless |
| DeepL: English style rules | same | +0.4 COMET-22 | Kept |
| DeepL: German inline rules | same | −0.7 COMET-22 | Removed |
| Picking the better of Claude and DeepL per passage | 658 passages, CometKiwi; then a rank average of two quality estimators | +0.2–0.3 COMET-22 at best, and it gives back part of Claude's term lead | Not used |
| New editor against previous editor, same draft | 80 passages, both editors on one Claude draft | See below | New editor kept |
| Term matching by lemma | all pools | Changes term accuracy by 0–2 points | Reported beside the exact figure |
| Term pruning | checked in production | Removes ordinary-word matches (2 of 19 on the test text) | In use, effect on quality not measured |
| Coverage-ranked examples | none | Not measured | In use |
| Whole-article context and term memory | none | Not measured | In use |

### The editor, on the same Claude draft (80 passages)

| | New editor | Previous editor | No editor |
|---|---|---|---|
| COMET-22, EN / DE | 84.11 / 81.99 | 84.13 / 81.86 | 84.09 / 81.95 |
| MetricX-24, EN / DE | 4.84 / 2.52 | 4.85 / 2.51 | 4.87 / 2.53 |
| Passages changed | 11 of 80 | 31 of 80 | none |
| Of those, better / worse on COMET-22 | 8 / 4 | 19 / 13 | not applicable |
| Editor cost per 1,000 words, EN / DE | $0.18 / $0.23 | $0.23 / $0.31 | $0 |

The draft itself costs $0.22 (English) and $0.33 (German) per 1,000 words.

- On a Claude draft, **neither editor moves the scores**: every difference is under 0.05 COMET-22
  and within the noise.
- The new editor is the safer one: it edits less, and its edits are more often improvements.
  The previous editor's edits are close to a coin flip.
- The new editor found 13 errors in 80 passages, none of them a mistranslation. It adds 70–95 % to
  the cost of a Claude draft.
- A first run where each candidate drafted separately showed gaps of 0.2–0.3 COMET-22. They
  were differences between drafts, not between editors, and disappear on a shared draft.

## Not tested yet

- **English → French and English → German**: built, no quality measurement yet (see below).
- **Blind ratings by GMT editors.** The Compare and Scoreboard pages are live; no ratings have
  been analysed. This is the judge for style and fluency, where metrics are weak.
- **DeepL draft + Claude editor**, and Claude + DeepL drafts merged by one editor. Both run in
  production; neither is scored. This is where the editor is most likely to pay.
- **Term pruning, coverage-ranked examples, whole-article context**: in use, effect unmeasured.
- **Fine-tuned Gemma 4 12B, and the second training round on GMT Magazine German**: waiting for
  Hugging Face credit.
- **xCOMET**: the model's licence has not been accepted and it needs a GPU.

## English as a source (built, not measured)

The desk now translates from English into French and German: a source switch on the Translator
and Compare pages. French-source prompts, terms and examples are unchanged (checked identical
before and after).

| Part | How it works from English |
|---|---|
| Termbase | Read from its English side: 3,818 English keys. Each English → French and English → German pair is checked against published sentence pairs; 241 keys whose pair GMT never uses were dropped ("going train" → "mobiles compteurs") |
| Examples | English → French: GMT's 120,000 French–English pairs read the other way. English → German: 19,800 pairs (1,300 GMT Magazine, 18,400 brand, dictionary and Rolex) |
| Style guide | French: written from counts on GMT's own French (404,546 sentences): « … » with spaces, space before : ; ! ?, 28'800, CHF before the amount, "or blanc", "édition limitée". German: the existing guide with English cues |
| Checks | French typography and English left untranslated are flagged; figures, references, terms and paragraphs as before |
| DeepL | Surrounding paragraphs as context; French also gets up to five term instructions. No GMT glossary or style list in this direction |
| Fine-tuned model | Not offered: it was trained on French sources only |

Tested so far: term lookup, examples, prompts, the page, and DeepL alone into both languages,
on a local copy. **Not tested: the Claude steps from English** (no Claude key on the
development machine; they run only once deployed). **Not measured: quality in either English
direction.**

Caveats for measuring:

- Most GMT texts were written in French. Used in reverse, the "English source" is itself a
  translation, which makes a test set easier than real English copy. A fair test needs
  articles GMT originally wrote in English.
- English → German has little GMT data: 2,200 magazine pairs.
- The batch command line still translates from French only.
