// Automatic QA checks on a translation. They are deterministic string heuristics: cheap,
// explainable, and run on every draft and final text. A flag is a question for the editor
// pass (step "fix"), which decides whether it is a real error or a false alarm.

import { splitParagraphs, splitSentences } from "./textnorm";
import type { Lang, TermHit } from "./types";

export type Severity = "error" | "warn" | "ok";
export type CheckKind = "terminology" | "figures" | "references" | "structure" | "untranslated" | "typography";

export interface QACheck {
  kind: CheckKind;
  severity: Severity;
  message: string;
  flag?: string; // wording sent to the editor when the check fails
}

const SOURCE_LABEL: Record<string, string> = {
  gmt: "GMT usage",
  berner: "FH Berner",
  patek: "Patek Philippe",
  fhh: "FHH",
  wikidata: "Wikidata",
};

function norm(text: string): string {
  return text.toLocaleLowerCase().replace(/ß/g, "ss").replace(/[‐‑–—-]/g, " ").replace(/[’']/g, "'").replace(/\s+/g, " ");
}

interface Tok {
  w: string;
  s: number;
  e: number;
}

/** Normalised word tokens with their offsets in the original text. */
function toks(text: string): Tok[] {
  return [...text.matchAll(/[\p{L}\p{N}'’]+/gu)].map((m) => ({ w: norm(m[0]), s: m.index, e: m.index + m[0].length }));
}

function words(text: string): string[] {
  return toks(text).map((t) => t.w);
}

/** Inflection- and compound-tolerant search of a (multi-word) term: every [start, end) match. */
function termSpans(out: Tok[], term: string): [number, number][] {
  const t = words(term);
  const found: [number, number][] = [];
  if (!t.length) return found;
  const stemOf = (w: string) => (w.length >= 6 ? w.slice(0, w.length - 2) : w);
  for (let i = 0; i + t.length <= out.length; i++) {
    let ok = true;
    for (let j = 0; j < t.length && ok; j++) {
      const o = out[i + j].w;
      const st = stemOf(t[j]);
      // the last word may be the head of a German compound (Automatikkaliber ⊃ kaliber)
      ok = j === t.length - 1 ? o.includes(st) : o.startsWith(st);
    }
    if (ok) found.push([out[i].s, out[i + t.length - 1].e]);
  }
  return found;
}

function containsTerm(out: Tok[], term: string): boolean {
  return termSpans(out, term).length > 0;
}

/** Is this termbase hit one the checks enforce? Multi-word terms, and single words with a GMT
 *  house-usage rule (other single words are often ordinary French: "bleu nuit"). */
export function enforced(h: TermHit, lang: Lang): boolean {
  const targets = h[lang];
  return targets.length > 0 && (h.key.includes(" ") || targets[0][2] <= 0);
}

export interface TermUse {
  hit: TermHit;
  /** preferred = first equivalent used · variant = another listed equivalent · missing = none found */
  status: "preferred" | "variant" | "missing";
  target: string | null;
  spans: [number, number][];
}

/** How each termbase hit is rendered in a translation, with the offsets of the rendering. */
export function termUsage(output: string, lang: Lang, terms: TermHit[]): TermUse[] {
  const out = toks(output);
  return terms
    .filter((h) => h[lang].length)
    .map((h) => {
      for (const [i, t] of h[lang].entries()) {
        const spans = termSpans(out, t[0]);
        if (spans.length) return { hit: h, status: i === 0 ? ("preferred" as const) : ("variant" as const), target: t[0], spans };
      }
      return { hit: h, status: "missing" as const, target: null, spans: [] };
    });
}

const NUMBER = /\d{1,3}(?:[\s  '’.,](?=\d{3}\b)\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g;

export function numbers(text: string): string[] {
  return [...text.matchAll(NUMBER)].map((m) => m[0].replace(/\D/g, ""));
}

const REFERENCE = /\b(?=[\w./-]*\d)(?=[\w./-]*[A-Za-z])[A-Za-z0-9][\w./-]*[A-Za-z0-9]\b/g;
const FRENCH_TELLS = new Set(["avec", "dans", "pour", "une", "les", "sur", "qui", "cette", "leur", "sont", "est", "aux", "très"]);

const TYPO: Record<Lang, [RegExp, string][]> = {
  en: [
    [/\bcalibers?\b/i, "“caliber” — GMT writes “calibre”"],
    [/\bcolou?r(?<!colour)\b/i, "American “color” — GMT writes “colour”"],
    [/\bgray\b/i, "“gray” — GMT writes “grey”"],
    [/\bmeters\b/, "“meters” — GMT writes “metres”"],
    [/—/, "em dash — GMT uses a spaced en dash ( – )"],
    [/"/, "straight quotes — GMT uses curly quotes “ ”"],
    [/\d(mm)\b/, "“41mm” — GMT writes “41 mm” with a space"],
    [/\bvph\b/, "“vph” — GMT writes “vibrations per hour”"],
    [/[«»]/, "French guillemets « » left in English text"],
    [/\s[:;!?](\s|$)/, "space before : ; ! ? (French typography)"],
  ],
  de: [
    [/"/, "gerade Anführungszeichen — Hausstil «…» (Deutschland: „…“)"],
    [/«\s|\s»/, "Leerzeichen innerhalb « » (französische Typografie)"],
    [/—/, "Geviertstrich — Hausstil: Halbgeviertstrich mit Leerzeichen ( – )"],
    [/\s[:;!?](\s|$)/, "Leerzeichen vor : ; ! ? (französische Typografie)"],
  ],
};

export function runQA(source: string, output: string, lang: Lang, terms: TermHit[], swiss = false): QACheck[] {
  const checks: QACheck[] = [];
  const outWords = toks(output);

  // 1. terminology — multi-word terms, and single words with a GMT house-usage rule (other
  //    single words are often ordinary French: "bleu nuit", "équilibre la composition")
  for (const h of terms) {
    const targets = h[lang];
    if (!targets.length) continue;
    if (!enforced(h, lang)) continue;
    const used = targets.findIndex((t) => containsTerm(outWords, t[0]));
    const pref = targets[0];
    const prefLabel = `“${pref[0]}” (${SOURCE_LABEL[pref[1]] ?? pref[1]})`;
    if (used === 0) {
      checks.push({ kind: "terminology", severity: "ok", message: `“${h.surface}” → ${prefLabel}` });
    } else if (used > 0 && pref[2] <= 1) {
      const alt = targets[used];
      const message = `“${h.surface}” rendered “${alt[0]}” (${SOURCE_LABEL[alt[1]] ?? alt[1]}), preferred ${prefLabel}`;
      checks.push({ kind: "terminology", severity: "warn", message, flag: `Terminology: ${message}.` });
    } else if (used > 0) {
      checks.push({ kind: "terminology", severity: "ok", message: `“${h.surface}” → “${targets[used][0]}”` });
    } else {
      const message = `“${h.surface}”: approved ${prefLabel} not found`;
      checks.push({ kind: "terminology", severity: "warn", message, flag: `Terminology: ${message} in the translation.` });
    }
  }

  // 2. figures — every number of the source must survive (format conversions allowed)
  const outNums = new Set(numbers(output));
  const missing = [...new Set(numbers(source))].filter((n) => !outNums.has(n));
  if (missing.length) {
    const message = `figures missing or altered: ${missing.join(", ")}`;
    checks.push({ kind: "figures", severity: "error", message, flag: `Figures: ${message} (compared digit by digit, separators ignored).` });
  } else {
    checks.push({ kind: "figures", severity: "ok", message: `all ${new Set(numbers(source)).size} figures preserved` });
  }

  // 3. references, calibres, ™/® marks
  const refs = [...new Set([...source.matchAll(REFERENCE)].map((m) => m[0]))].filter((r) => !/^\d+(h|mm|m|cm|g|ct)$/i.test(r));
  const lost = refs.filter((r) => !output.includes(r));
  if (lost.length) {
    const message = `references not found verbatim: ${lost.join(", ")}`;
    checks.push({ kind: "references", severity: "error", message, flag: `References: ${message}.` });
  } else if (refs.length) {
    checks.push({ kind: "references", severity: "ok", message: `${refs.length} reference(s) kept verbatim` });
  }
  for (const mark of ["™", "®"]) {
    const a = source.split(mark).length;
    const b = output.split(mark).length;
    if (a !== b) checks.push({ kind: "references", severity: "warn", message: `${mark} count differs (${a - 1} → ${b - 1})`, flag: `References: the ${mark} mark appears ${a - 1}× in the source and ${b - 1}× in the translation.` });
  }

  // 4. structure
  const ps = splitParagraphs(source).length;
  const po = splitParagraphs(output).length;
  if (ps !== po) {
    const message = `${ps} source paragraph(s), ${po} in the translation`;
    checks.push({ kind: "structure", severity: "error", message, flag: `Structure: ${message}; keep one output paragraph per source paragraph.` });
  } else {
    checks.push({ kind: "structure", severity: "ok", message: `${ps} paragraph(s) mirrored` });
  }

  // 5. untranslated French
  const leftovers = splitParagraphs(output)
    .flatMap(splitSentences)
    .filter((s) => new Set((s.toLowerCase().match(/\p{L}+/gu) ?? []).filter((w) => FRENCH_TELLS.has(w))).size >= 3);
  for (const s of leftovers) {
    const message = `sentence looks French: “${s.slice(0, 90)}${s.length > 90 ? "…" : ""}”`;
    checks.push({ kind: "untranslated", severity: "error", message, flag: `Untranslated: ${message}.` });
  }

  // 6. house typography
  for (const [re, label] of TYPO[lang]) {
    const m = output.match(re);
    if (m) checks.push({ kind: "typography", severity: "warn", message: label, flag: `Typography: ${label} (found “${m[0].trim()}”).` });
  }
  if (lang === "de" && swiss && output.includes("ß")) {
    checks.push({ kind: "typography", severity: "warn", message: "ß im Schweizer Text", flag: "Typography: Swiss German spelling was requested but the text contains ß." });
  }
  if (lang === "de" && swiss && /[„“]/.test(output)) {
    checks.push({ kind: "typography", severity: "warn", message: "„…“ — GMT-Hausstil «…»", flag: "Typography: GMT's Swiss German uses «…» quotes, not „…“." });
  }
  if (lang === "de" && !swiss && /[«»]/.test(output)) {
    checks.push({ kind: "typography", severity: "warn", message: "« » im Text für Deutschland — „…“", flag: "Typography: German for Germany uses „…“ quotes, not « »." });
  }
  return checks;
}

export function summarize(checks: QACheck[]): { errors: number; warnings: number; passed: number } {
  return {
    errors: checks.filter((c) => c.severity === "error").length,
    warnings: checks.filter((c) => c.severity === "warn").length,
    passed: checks.filter((c) => c.severity === "ok").length,
  };
}
