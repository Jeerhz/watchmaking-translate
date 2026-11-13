// The system recipe and the fine-tuning results shown on the Architecture and Roadmap pages.
// FT_RESULTS is regenerated from the cluster's score files by scripts/ft-results.mjs.

export interface RecipeRow {
  part: string;
  model: string;
  role: string;
  training: string;
  data: string;
}

export const RECIPE: RecipeRow[] = [
  {
    part: "Term detection",
    model: "Rule: accent-folded longest match",
    role: "Finds termbase terms in the French; gives the approved EN/DE equivalent",
    training: "None",
    data: "4,932 French keys: GMT usage › FH Berner › Patek › FHH › Wikidata",
  },
  {
    part: "Reference retrieval",
    model: "BM25 (lexical)",
    role: "Picks 3 published sentence pairs per source sentence as examples (2 GMT + 1 industry)",
    training: "None (index only)",
    data: "GMT editorial EN (WorldTempus + GMT Magazine) · GMT Magazine German edition (Swiss) · brand / FH / FHH / Rolex EN & DE",
  },
  {
    part: "Draft · review · correction",
    model: "Claude Opus 5.5 (Anthropic API)",
    role: "Translator, then chief sub-editor (JSON changes with reasons), then QA-flag ruling",
    training: "Not trained by us — prompted with style guide (EN and Swiss DE measured on GMT’s own texts), terms and examples",
    data: "Only what the prompt carries",
  },
  {
    part: "Magazine corpus",
    model: "PDF text layer + LaBSE alignment",
    role: "Turns the FR and DE print editions (each with the EN) into aligned FR–EN–DE sentences",
    training: "None",
    data: "10 GMT Magazine issues: 4.5k FR→DE, 4.1k FR→EN pairs; issues 97–98 held out for testing",
  },
  {
    part: "QA",
    model: "Deterministic code",
    role: "Terms, figures, references, ™/®, paragraphs, leftover French, typography",
    training: "None",
    data: "—",
  },
  {
    part: "Fine-tuned open model (comparison)",
    model: "Gemma 4 12B and Gemma 4 E4B (Google, Apache 2.0) + LoRA",
    role: "Single-pass translation with the termbase hits in the prompt; runs beside Claude in the desk",
    training: "LoRA, 1 epoch on one H100 (Inria CLEPS) — recipe below",
    data: "149,805 FR→EN/DE passages from GMT editorial + domain sources",
  },
];

export const FT_RECIPE: [string, string][] = [
  ["Base models", "google/gemma-4-12B-it (12B) — quality; google/gemma-4-E4B-it (8B total, 4B active) — cheap to serve"],
  ["Method", "LoRA r = 64, α = 64, dropout 0.05 on every attention and MLP projection of the language model (≈ 2 % of the weights); vision/audio towers frozen"],
  ["Optimisation", "1 epoch, AdamW, lr 1e-4 (12B) / 2e-4 (E4B), cosine, 3 % warm-up, effective batch 32, bf16, loss on the translation only"],
  [
    "Samples",
    "Passages of 1–5 consecutive aligned sentences (≤ 220 words) from one article, so the model learns paragraph-level translation",
  ],
  [
    "Data",
    "87k GMT editorial FR→EN passages (WorldTempus, press releases excluded) · 19k EN domain (FH Berner, FHH, Patek, brands, Rolex) · 14.6k FR→DE domain passages, ×3 (no GMT German yet). Patents excluded.",
  ],
  [
    "Terminology",
    "Prompt lists termbase hits: for half the samples the terms the reference uses, for the other half the raw hits as served — so the model learns to apply the termbase where it fits",
  ],
  ["Evaluation", "607 held-out passages (articles never seen in training): COMET-22, chrF++, BLEU, term accuracy"],
  ["Serving", "Weights in private Hugging Face repos (merged bf16, LoRA, GGUF); private ZeroGPU Space for the desk; vLLM or llama.cpp for self-hosting"],
];

export interface FtResult {
  system: string;
  pool: string; // en/style | en/domain | de/domain
  n: number;
  comet: number;
  chrf: number;
  terms: number;
}

/** Scored on the passages every system translated (Claude's run stopped at 132 when API credit ran out). */
export const FT_RESULTS: FtResult[] = [
  { system: "Claude Opus 5.5 — draft + review (current desk)", pool: "EN · GMT house style", n: 80, comet: 83.8, chrf: 64.8, terms: 93.8 },
  { system: "Gemma 4 E4B fine-tuned (ours)", pool: "EN · GMT house style", n: 80, comet: 83.7, chrf: 66.1, terms: 89.1 },
  { system: "Gemma 4 12B, not tuned", pool: "EN · GMT house style", n: 80, comet: 81.7, chrf: 59.7, terms: 91.4 },
  { system: "Gemma 4 E4B, not tuned", pool: "EN · GMT house style", n: 80, comet: 82.0, chrf: 60.4, terms: 90.6 },
  { system: "Claude Opus 5.5 — draft + review (current desk)", pool: "DE · industry", n: 45, comet: 82.3, chrf: 62.3, terms: 97.0 },
  { system: "Gemma 4 E4B fine-tuned (ours)", pool: "DE · industry", n: 45, comet: 81.9, chrf: 60.0, terms: 84.8 },
  { system: "Gemma 4 12B, not tuned", pool: "DE · industry", n: 45, comet: 80.5, chrf: 55.9, terms: 98.0 },
  { system: "Gemma 4 E4B, not tuned", pool: "DE · industry", n: 45, comet: 79.5, chrf: 54.7, terms: 96.0 },
];
export const FT_RESULTS_NOTE =
  "Fine-tuning works: on all 607 test passages it lifts E4B by +1.6 to +2.5 COMET, +6 chrF++ and +9 to +11 BLEU, and the tuned 4B model beats the untuned 12B. " +
  "In English it ties Claude on COMET and is closer to GMT’s own wording (chrF++ 66.1 vs 64.8) — but it misses more approved terms (89% vs 94%) and has no review step. " +
  "In German Claude stays ahead, mostly on terminology (97% vs 85%). Verdict: a credible, cheap candidate for English drafts; not a replacement. " +
  "Next: the 12B fine-tune (training), and stronger term enforcement in training.";
