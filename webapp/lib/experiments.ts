// Summary of what has been measured, shown on the Architecture page. Source: docs/results.md.

export interface BestRow {
  need: string;
  choice: string;
  why: string;
}

export const BEST: BestRow[] = [
  {
    need: "Publication quality",
    choice: "Claude Opus 5.5 with termbase, GMT examples and style guide",
    why: "Level with DeepL on overall quality, 3–12 points ahead on approved terms, closest to GMT’s wording",
  },
  {
    need: "Low cost",
    choice: "DeepL (EN-GB / DE-CH) reading the surrounding paragraphs",
    why: "Level with Claude on COMET-22, slightly ahead on MetricX-24, about a tenth of the cost",
  },
  {
    need: "Editing step",
    choice: "The “diagnose, then repair” editor",
    why: "Changes a third as many passages as the previous editor, and its changes help twice in three",
  },
  {
    need: "Example retrieval",
    choice: "BM25 (word match)",
    why: "Shows the approved term in context more often than embeddings, in every pool",
  },
];

export type Verdict = "kept" | "dropped" | "open";

export interface Experiment {
  component: string;
  test: string;
  result: string;
  decision: string;
  verdict: Verdict;
}

export const EXPERIMENTS: Experiment[] = [
  {
    component: "Claude against customised DeepL",
    test: "271 EN / 255 DE passages, GMT Magazine 97–98",
    result: "Level on COMET-22 (84.7 / 84.8 EN, 81.5 / 82.0 DE). MetricX-24 slightly favours DeepL. Claude leads on terms (94.5 % vs 91.5 % EN, 97.0 % vs 93.6 % DE)",
    decision: "Both offered",
    verdict: "kept",
  },
  {
    component: "Fine-tuned Gemma 4 E4B",
    test: "80 EN / 45 DE passages",
    result: "+1.7 (EN) and +2.4 (DE) COMET-22 over the untuned model. Ties Claude on English, closest to GMT’s wording, weakest on terms, behind in German",
    decision: "Comparison only",
    verdict: "open",
  },
  {
    component: "Retrieval: BM25, embeddings, hybrid",
    test: "600 held-out sentences per pool, two embedding models",
    result: "BM25 shows the approved term in context most often (GMT English: 48.4 % vs 45.0 % hybrid, 34.5 % embeddings)",
    decision: "BM25 only",
    verdict: "kept",
  },
  {
    component: "DeepL: surrounding sentences as context",
    test: "91 EN / 88 DE passages",
    result: "+0.5 COMET-22, +1.7 chrF++, +3 points on terms",
    decision: "Kept",
    verdict: "kept",
  },
  {
    component: "DeepL: hard glossary",
    test: "Same passages",
    result: "No measurable gain on top of context",
    decision: "Kept, harmless",
    verdict: "kept",
  },
  {
    component: "DeepL: German inline rules",
    test: "Same passages",
    result: "−0.7 COMET-22",
    decision: "Removed",
    verdict: "dropped",
  },
  {
    component: "Best of Claude and DeepL per passage",
    test: "658 passages, one then two quality estimators",
    result: "+0.2–0.3 COMET-22 at best, and part of Claude’s term lead is lost",
    decision: "Not used",
    verdict: "dropped",
  },
  {
    component: "New editor against previous editor",
    test: "80 passages, both editors on the same Claude draft",
    result: "No difference in scores (under 0.05 COMET-22). New editor changes 11 passages, 8 for the better; previous editor changes 31, 19 for the better",
    decision: "New editor",
    verdict: "kept",
  },
  {
    component: "Editing a Claude draft at all",
    test: "Same 80 passages, against no editor",
    result: "No measurable gain; adds 70–95 % to the cost of the draft. 13 errors found, none a mistranslation",
    decision: "To be settled by editors’ blind ratings",
    verdict: "open",
  },
  {
    component: "Term pruning, coverage-ranked examples, whole-article context",
    test: "Checked working in production",
    result: "Effect on quality not measured",
    decision: "In use",
    verdict: "open",
  },
  {
    component: "DeepL draft + Claude editor",
    test: "Runs in production",
    result: "Not scored yet",
    decision: "Next test",
    verdict: "open",
  },
];

export const NOT_TESTED: string[] = [
  "English → French and English → German: nothing built or measured yet. The data allows it (522,000 aligned English–French pairs, 103,000 English–German of which 2,200 are GMT’s own).",
  "Blind ratings by GMT editors: the Compare and Scoreboard pages are live; no ratings have been analysed.",
  "Fine-tuned Gemma 4 12B and the second training round on GMT Magazine German.",
];
