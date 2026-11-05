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

export interface Change {
  before: string;
  after: string;
  reason: string;
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

export type Step = "draft" | "review" | "fix";

export interface TranslateRequest {
  step: Step;
  lang: Lang;
  source: string;
  context?: string | null;
  draft?: string;
  issues?: string[];
  swiss?: boolean;
  effort?: Effort;
}
