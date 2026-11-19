# System 3 — DeepL, customised for GMT watchmaking copy

Third system for the desk, next to Claude (prompted, with review) and the fine-tuned Gemma
model. DeepL is a dedicated MT engine: we cannot train it, but the API lets us inject GMT's
terminology, house style and context on every request. This design uses those levers with
the resources we already have, and keeps the desk's QA and (optionally) Claude's review on top.

Sources: DeepL API documentation (developers.deepl.com, November 2026) — text translation,
glossaries v3, style rules, custom instructions, translation memories, supported languages,
OpenAPI spec; DeepL API pricing page.

## What DeepL offers that matters here

| Lever | What it does | Limits | Use for GMT |
|---|---|---|---|
| `target_lang` | `EN-GB`, `DE-CH` (Swiss German) are both supported targets | — | GMT English is British; GMT's German edition is Swiss |
| `model_type` | `quality_optimized` vs `latency_optimized` | — | always `quality_optimized` |
| Glossary (`glossary_id`, v3 multilingual) | **hard** term mapping, inflected by DeepL (case, plural, gender) | per dictionary 10 MB; glossaries apply to the **root** language (a FR→DE dictionary also serves DE-CH) | GMT-attested terms only |
| Style rule list (`style_id`) | configured rules (numbers, quotes, dashes, ß→ss…) + up to 200 stored custom instructions (≤ 300 chars each) | one list per target; `de-CH` GA, `en-GB` beta (or root `en`) | GMT house style, per language |
| `custom_instructions` | up to 10 inline directives per request, ≤ 300 chars each | applied sentence by sentence, not to the whole text | per-paragraph **soft** term hints |
| `context` | text that steers the translation but is not translated — **not billed** | — | article title + previous paragraph |
| Translation memory | reuses approved segments above a match threshold (default 75 %) | uploaded in the DeepL UI only (TMX); plan-dependent | phase 2: spec-sheet boilerplate |
| `formality` | formal/informal address | DE supported | `prefer_more` (GMT addresses readers with "Sie") |
| `preserve_formatting`, `split_sentences` | keep the source's punctuation/casing, sentence splitting | — | `true`, `nonewlines` |

What DeepL does **not** give us: no fine-tuning on our corpus, no few-shot examples (the
desk's BM25 references cannot be passed), and instructions are applied locally (per
sentence), so paragraph-level rewriting is out of reach — that is where Claude's review stays useful.

## Pipeline

```
French paragraph(s)
  │  same paragraph split + term detection as the desk (bundle termbase)
  ▼
DeepL /v2/translate   (one call per paragraph, both targets in parallel)
  source_lang = FR, target_lang = EN-GB | DE-CH, model_type = quality_optimized
  glossary_id         = GMT glossary (FR→EN, FR→DE dictionaries)        ← hard terms
  style_id            = "GMT EN-GB" | "GMT DE-CH" style rule list        ← house style
  custom_instructions = ≤ 10 term hints for this paragraph not in the glossary  ← soft terms
  context             = article title + previous paragraph               ← coherence, free
  formality = prefer_more, preserve_formatting = true, split_sentences = nonewlines
  ▼
Deterministic QA (existing runQA: terms, figures, ™/®, leftover French, typography, ß in Swiss)
  ▼
[optional] Claude sub-editor review of the DeepL draft (existing review step)  → "DeepL + review"
```

Two variants are evaluated: **DeepL** (raw, customised) and **DeepL + Claude review** — the
second tells us whether DeepL is a cheaper drafter for the current Claude reviewer.

## GMT glossary: only what GMT's own translations consistently do

DeepL enforces glossary entries, so a wrong or context-dependent entry does damage on every
occurrence. Our termbase (4,932 French keys, ~88 % from the FH Berner dictionary, with
alternatives) is right for soft hints, not for hard enforcement. Selection rule, measured on
GMT's own translations (80k WorldTempus/GMT Magazine EN sentences; 2.7k GMT Magazine DE):

- keep a term when GMT's translation uses one termbase equivalent in **≥ 80 %** of the
  sentences containing it (n ≥ 8 for EN, n ≥ 4 for DE);
- add the house overrides (`HOUSE_TERMS`: cornes → lugs / Hörner, or gris → white gold /
  Weissgold, …) and the dominant GMT German choices measured on the magazine;
- German targets in Swiss spelling (the FR→DE dictionary also serves DE-CH);
- exclude terms GMT itself translates inconsistently (index, spiral, pièce unique,
  chronométrage, ancre, épaisseur, soleil…) and ambiguous ones (platine = platinum *or*
  mainplate): they go to soft hints;
- lower-case entries (DeepL handles case and inflection).

First measurement: ≈ 426 EN and ≈ 68 DE candidates at ≥ 70 % (to be tightened to 80 %).
They include the cases where generic MT goes wrong in watchmaking — boîte → case (not box),
balancier → balance, ponts → bridges, couronne → crown / Krone, masse oscillante →
Schwungmasse, réserve de marche → power reserve / Gangreserve.

## Style rule lists

**GMT EN-GB** (configured rules)
- `punctuation.quotation_style`: double curly primary, single curly secondary
- `punctuation.apostrophe`: `use_curly_apostrophes`
- `punctuation.sentence_break_indicator`: `use_en_dash_with_space_on_either_side`
- `numbers.thousands_separator`: `use_comma`; `numbers.decimal_separator`: `use_period_as_decimal_separator`
- `numbers.units_of_measure_spacing`: `use_space_between_numeral_and_unit_of_measure`

Custom instructions (stored in the list; one directive each, positive, ≤ 300 chars)
1. Write polished British magazine English for watch collectors, in the register of the source.
2. Use British spelling: colour, centre, calibre, grey, jewellery, aluminium, programme, -ise verbs.
3. Write watch positions as o'clock: "à 6 h" becomes "at 6 o'clock".
4. Write frequencies as "28,800 vibrations per hour (4 Hz)".
5. Write water resistance as "water-resistant to 100 metres".
6. Write gold alloys as "18-carat white gold" and reserves as "a 70-hour power reserve".
7. Keep brand, collection, model, calibre and material names exactly as in the source, with ™ and ®.
8. Translate "la Maison" and "la Manufacture" as "the Maison" and "the Manufacture" when they refer to the brand.
9. Keep spec sheets terse and in list form ("Movement: self-winding calibre; Case: 41 mm, titanium").

**GMT DE-CH** (configured rules)
- `spelling_and_grammar.eszett`: `replace_eszett_with_ss`
- `punctuation.quotation_style`: guillemets primary, single guillemets secondary
- `numbers.numbers_of_5_digits_or_more`: comma decimal, space thousands ("28 800")
- `numbers.units_of_measure_spacing`: space ("41 mm")
- `style_and_tone.verbal_vs_nominal_style`: `use_verbal_style`; `style_and_tone.formality`: `use_formal_tone`
- `punctuation.sentence_break_indicator`: `use_en_dash_with_space_on_either_side`

Custom instructions (measured on GMT Magazine's German edition)
1. Schreibe gewandtes Magazindeutsch für Uhrensammler im Register der Vorlage.
2. Übersetze "la Maison" als "die Marke" oder "das Haus".
3. Übersetze "mouvement" als "Werk" oder "Kaliber".
4. Übersetze "acier" als "Stahl".
5. Übersetze "cornes" als "Hörner".
6. Schreibe Uhrzeiten-Positionen als "bei 6 Uhr" und Wasserdichtigkeit als "wasserdicht bis 100 m".
7. Schreibe Auflagen als "auf 50 Exemplare limitiert".
8. Belasse Marken-, Kollektions-, Modell- und Kalibernamen exakt wie in der Vorlage, inklusive ™ und ®.

## Soft terms per paragraph

Termbase hits not covered by the glossary (≤ 10, ranked as in the desk) become inline
`custom_instructions` of the form `Translate "spiral" as "balance spring".` — the same hints
Claude and the fine-tuned model get, so the three systems are compared on equal information.
(Rule from the docs: a broad instruction drowns specific ones, so these stay one term each.)

## Evaluation

Same protocol as the other systems: `ft/v2` test set (1,207 passages: v1 test + GMT Magazine
issues 97–98), COMET-22, chrF++, BLEU, term accuracy, plus the common-subset comparison with
Claude (526 magazine passages done). The test set is 444k French characters — within the
free plan's one-off 1M-character credit, or ≈ €10 on Growth.

Ablations worth running (each a cheap re-run): raw DeepL → + style list → + glossary →
+ soft terms → + context → + Claude review. This shows which lever earns its place.

## Account and cost

| Plan | Price | For us |
|---|---|---|
| Developer (free) | one-off 1M characters; 1 glossary, 1 style list | enough to run the evaluation, **but no "no training on your data" guarantee** — client texts |
| Growth | €23.80 / month (annual) + €22 per extra 1M characters; 12M characters/year; 2,000 glossaries; unlimited style lists; **no data training** | production |

A typical article (8,000 characters) translated into EN + DE ≈ 16,000 billed characters
≈ €0.35 on Growth — about a tenth of the Claude draft + review. Context characters are free.

## Implementation (once a key exists)

- `trad-gmt deepl-setup`: build the attested glossary and both style lists from the corpus
  and `style.py`, create/update them via `/v3/glossaries` and `/v3/style_rules`, store the IDs.
- `/api/deepl` route (same NDJSON events as `/api/open-mt`) and a third column in the desk;
  `DEEPL_API_KEY` as a Vercel secret.
- `trad_gmt.ft.deepl_eval`: run the test set, upload to `ft/v2/runs/deepl*/`, score with
  `cluster/score_job.py`.
- Glossaries and style lists are stored per DeepL data centre; use the default endpoint
  (`api.deepl.com`), not a regional one.
