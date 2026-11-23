// What can be put side by side on the Compare page: whole systems, the same system with one
// component switched off, and GMT's own published translation. Shared with the scoreboard,
// which pairs each "component off" variant with its full system.

import type { SystemId, Variant } from "@/components/run";
import { SYSTEMS } from "@/components/run";

export interface Candidate {
  id: string;
  label: string;
  help: string;
  group: "system" | "component" | "reference";
  system?: SystemId;
  variant?: Variant;
  /** keep every termbase match (skip the pruning call) */
  noPrune?: boolean;
  needs?: "deepl" | "open" | "sample";
}

export const CANDIDATES: Candidate[] = [
  ...SYSTEMS.filter((s) => s.id !== "claude-legacy").map((s) => ({ id: s.id, label: s.label, help: s.help, group: "system" as const, system: s.id, needs: s.needs })),
  { id: "gmt", label: "GMT’s published text", help: "What GMT Magazine printed in that language (samples only), hidden among the systems", group: "reference", needs: "sample" },
  { id: "claude~noterms", label: "Claude + editor, no termbase", help: "No glossary in the prompts and no term checks", group: "component", system: "claude", variant: { off: ["termbase"] } },
  { id: "claude~noprune", label: "Claude + editor, unpruned terms", help: "Every termbase match is kept, ordinary words included", group: "component", system: "claude", noPrune: true },
  { id: "claude~noexamples", label: "Claude + editor, no examples", help: "No published sentence pairs in the prompts", group: "component", system: "claude", variant: { off: ["examples"] } },
  { id: "claude~nostyle", label: "Claude + editor, no style guide", help: "Only the language variety is stated", group: "component", system: "claude", variant: { off: ["style"] } },
  { id: "claude~noeditor", label: "Claude, no editor", help: "Claude’s draft as it is", group: "component", system: "claude", variant: { noEditor: true } },
  { id: "claude-legacy", label: "Claude + previous editor", help: "One free rewrite, then a QA correction pass (the editor until November 2026)", group: "component", system: "claude-legacy" },
  { id: "deepl~nocontext", label: "DeepL alone, no context", help: "Each paragraph translated on its own", group: "component", system: "deepl", variant: { noContext: true }, needs: "deepl" },
];

export const CANDIDATE_LABEL = Object.fromEntries(CANDIDATES.map((c) => [c.id, c.label])) as Record<string, string>;

/** Each row: does the component earn its place? `with` has it, `without` does not. */
export const COMPONENTS: { component: string; with: string; without: string }[] = [
  { component: "Termbase", with: "claude", without: "claude~noterms" },
  { component: "Term pruning", with: "claude", without: "claude~noprune" },
  { component: "Retrieved examples", with: "claude", without: "claude~noexamples" },
  { component: "Style guide", with: "claude", without: "claude~nostyle" },
  { component: "Editor (diagnose, then repair)", with: "claude", without: "claude~noeditor" },
  { component: "New editor rather than the previous one", with: "claude", without: "claude-legacy" },
  { component: "Claude editor on DeepL’s draft", with: "deepl-claude", without: "deepl" },
  { component: "DeepL context", with: "deepl", without: "deepl~nocontext" },
  { component: "DeepL’s version beside Claude’s draft", with: "fusion", without: "claude" },
];

export interface Span {
  start: number;
  end: number;
  text: string;
  severity: "minor" | "major";
}

export interface JudgedCandidate {
  label: string;
  system: string; // candidate id
  text: string;
  score: number | null; // 0–100
  spans: Span[];
  note: string;
}

export interface Judgment {
  rater: string;
  sample: string | null;
  lang: "en" | "de" | "fr";
  /** language of the source text; absent in judgments saved before English sources existed (French) */
  src?: "fr" | "en";
  pair?: string;
  blind: boolean;
  source: string;
  best: string | null;
  candidates: JudgedCandidate[];
}
