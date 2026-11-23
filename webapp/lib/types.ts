// Shapes shared by the API routes and the client.

/** A language the desk translates into. */
export type Lang = "en" | "de" | "fr";
/** A language the desk translates from. */
export type Src = "fr" | "en";
export const SOURCES: Src[] = ["fr", "en"];
/** The two target languages of each source language, in display order. */
export const TARGETS: Record<Src, [Lang, Lang]> = { fr: ["en", "de"], en: ["fr", "de"] };
export const LANGS: Lang[] = ["en", "de", "fr"];
export const LANG_NAME: Record<Lang, string> = { en: "English", de: "German", fr: "French" };
/** Each language's own name, for column headings. */
export const LANG_TITLE: Record<Lang, string> = { en: "English", de: "Deutsch", fr: "Français" };
export const isSrc = (x: unknown): x is Src => x === "fr" || x === "en";
/** One value per target language. */
export const perLang = <T,>(make: (lang: Lang) => T): Record<Lang, T> => ({ en: make("en"), de: make("de"), fr: make("fr") });
/** "fr>en": the key under which runs and ratings of one direction are pooled. */
export const pairOf = (src: Src, lang: Lang): string => `${src}>${lang}`;
export const pairName = (pair: string): string => {
  const [s, l] = pair.split(">") as [Lang, Lang];
  return `${LANG_NAME[s] ?? s} → ${LANG_NAME[l] ?? l}`;
};
export type Effort = "high" | "xhigh" | "max";

/** [term, source, priority, definition] as exported by trad_gmt.mt.export */
export type TargetRow = [string, string, number, string | null];

/** A termbase entry as stored in the bundle: keyed on the French designation. */
export interface GlossaryEntry {
  fr: string;
  key: string[];
  en: TargetRow[];
  de: TargetRow[];
}

/** One source-language designation found in the text, with every occurrence's offsets.
 *  `term` is the termbase entry (French or English, as the source is); the equivalents of the
 *  source language itself are empty. */
export interface TermHit {
  key: string;
  term: string;
  surface: string;
  count: number;
  spans: [number, number][];
  en: TargetRow[];
  de: TargetRow[];
  fr: TargetRow[];
}

export interface Example {
  /** the published sentence in the source language */
  src: string;
  tgt: string;
  source: string;
  label: string;
  url: string;
  pool: "style" | "domain";
  score: number;
  sentence: number; // index of the query sentence that retrieved it
}

export interface Analysis {
  src: Src;
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
  src: string;
  tgt: string;
}

export interface TranslateRequest {
  step: Step;
  lang: Lang;
  /** language of the source text (default: French) */
  src?: Src;
  source: string;
  /** end of the translation so far (previous parts of the same article) */
  context?: string | null;
  /** the whole source article, when the source is only a part of it */
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
