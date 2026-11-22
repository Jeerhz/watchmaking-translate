// Shapes shared by the API routes and the client.

export type Lang = "en" | "de";
export const LANGS: Lang[] = ["en", "de"];
export const LANG_NAME: Record<Lang, string> = { en: "English", de: "German" };
export type Effort = "high" | "xhigh" | "max";

/** [term, source, priority, definition] as exported by trad_gmt.mt.export */
export type TargetRow = [string, string, number, string | null];

export interface GlossaryEntry {
  fr: string;
  key: string[];
  en: TargetRow[];
  de: TargetRow[];
}

/** One French designation found in the text, with every occurrence's offsets. */
export interface TermHit {
  key: string;
  fr: string;
  surface: string;
  count: number;
  spans: [number, number][];
  en: TargetRow[];
  de: TargetRow[];
}

export interface Example {
  fr: string;
  tgt: string;
  source: string;
  label: string;
  url: string;
  pool: "style" | "domain";
  score: number;
  sentence: number; // index of the query sentence that retrieved it
}

export interface Analysis {
  sentences: { index: number; paragraph: number; text: string; start: number; end: number }[];
  terms: TermHit[];
  references: Record<Lang, Example[]>;
  words: number;
}

/** MQM-style error categories and severities used by the diagnosing editor and by raters. */
export type Category = "accuracy" | "terminology" | "style" | "fluency" | "typography";
export const CATEGORIES: Category[] = ["accuracy", "terminology", "style", "fluency", "typography"];
export type ErrorSeverity = "minor" | "major" | "critical";

/** One error the editor diagnosed in a draft: a verbatim span, its kind and how bad it is. */
export interface Diagnosis {
  span: string;
  category: Category;
  severity: ErrorSeverity;
  explanation: string;
}

export interface Change {
  before: string;
  after: string;
  reason: string;
  /** set by the diagnose → repair editor */
  type?: Category;
  severity?: ErrorSeverity;
  /** why the desk refused to apply this edit (span not found, or it made QA worse) */
  rejected?: string;
}

export interface Verdict {
  check: string;
  action: "fixed" | "kept";
  reason: string;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  ms: number;
  model: string;
}

/** Streamed NDJSON events from /api/translate. */
export type StreamEvent =
  | { t: "prompt"; system: string; user: string; terms: number; examples: number }
  | { t: "thinking"; text: string }
  | { t: "text"; text: string }
  | { t: "done"; text: string; usage: Usage; stop: string | null }
  | { t: "error"; message: string };

/** draft → diagnose → repair is the pipeline; review / fix are the previous single-pass editor, kept for comparison. */
export type Step = "draft" | "diagnose" | "repair" | "review" | "fix";

/** Components that can be switched off for one run, to measure what each contributes. */
export type Off = "termbase" | "examples" | "style";

export interface Decision {
  fr: string;
  tgt: string;
}

export interface TranslateRequest {
  step: Step;
  lang: Lang;
  source: string;
  /** end of the translation so far (previous parts of the same article) */
  context?: string | null;
  /** the whole French article, when the source is only a part of it */
  article?: string | null;
  /** term choices already made earlier in this article — to be reused */
  decisions?: Decision[];
  draft?: string;
  /** QA flags: questions for the editor (diagnose, fix) */
  issues?: string[];
  /** repair: the errors diagnosed in the draft */
  errors?: Diagnosis[];
  swiss?: boolean;
  effort?: Effort;
  /** termbase keys pruned as irrelevant for this text */
  dropTerms?: string[];
  off?: Off[];
  /** the engine that produced the draft when it is not Claude (e.g. "DeepL") */
  draftBy?: string;
  /** other engines' translations of the same source, for the editor to borrow from */
  alternatives?: { engine: string; text: string }[];
}

/** One event in the shared store (ratings, validated texts, run statistics). */
export type StoreKind = "run" | "validation" | "judgment";
export interface StoreEvent {
  id: string;
  kind: StoreKind;
  at: string;
  [k: string]: unknown;
}
