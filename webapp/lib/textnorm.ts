// French matching normalisation — mirrors trad_gmt/mt/textnorm.py and the sentence splitter
// of trad_gmt/text.py, so the app retrieves the same glossary hits and examples as the CLI.

const foldCache = new Map<string, string>();

function foldChar(ch: string): string {
  let v = foldCache.get(ch);
  if (v === undefined) {
    const base = ch.normalize("NFD")[0].toLowerCase();
    v = base.length === 1 ? base : ch;
    foldCache.set(ch, v);
  }
  return v;
}

export function fold(text: string): string {
  let out = "";
  for (const ch of text.replace(/’/g, "'")) out += foldChar(ch);
  return out;
}

/** Strip French plural marks: cristaux→cristal, aiguilles→aiguille. */
export function stem(t: string): string {
  if (t.length > 4 && t.endsWith("aux")) return t.slice(0, -3) + "al";
  if (t.length > 3 && (t.endsWith("s") || t.endsWith("x")) && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

const TOKEN = /[a-z0-9œæ]+/g;

/** Stemmed tokens with their [start, end) offsets in the original text (UTF-16 units). */
export function tokenSpans(text: string): [string, number, number][] {
  const chars = Array.from(text.replace(/’/g, "'"));
  const folded = chars.map(foldChar);
  const starts: number[] = [];
  let pos = 0;
  for (const c of chars) {
    starts.push(pos);
    pos += c.length;
  }
  starts.push(pos);
  const idx: number[] = [];
  let k = 0;
  for (let i = 0; i < folded.length; i++) for (let j = 0; j < folded[i].length; j++) idx[k++] = i;
  idx[k] = folded.length;
  const out: [string, number, number][] = [];
  for (const m of folded.join("").matchAll(TOKEN)) {
    const s = m.index ?? 0;
    out.push([stem(m[0]), starts[idx[s]], starts[idx[s + m[0].length]]]);
  }
  return out;
}

export function contentTokens(text: string, stop: Set<string>): string[] {
  const out: string[] = [];
  for (const m of fold(text).matchAll(TOKEN)) {
    const t = m[0];
    if (!stop.has(t) && t.length > 1) out.push(stem(t));
  }
  return out;
}

const ABBREVIATIONS = new Set([
  "M", "MM", "Mme", "Mmes", "Mlle", "Dr", "St", "Ste", "réf", "Réf", "ref", "Ref", "env", "cf",
  "etc", "p", "pp", "n°", "No", "no", "vol", "chap", "av", "apr", "J.-C", "Mr", "Mrs", "Ms",
]);
const SENT_END = /([.!?…](?:\s?["»”’)])*)\s+(?=(?:["«“‘(\[]\s?)?[A-ZÀ-ÖØ-ÞŒ0-9])/g;

function isAbbreviation(chunk: string): boolean {
  let last = chunk.trimEnd().split(" ").pop() ?? "";
  last = last.replace(/\.+$/, "").replace(/^[(\[«"]+/, "");
  return ABBREVIATIONS.has(last) || (last.length === 1 && /\p{L}/u.test(last));
}

export function splitSentences(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  const pieces: string[] = [];
  let start = 0;
  for (const m of t.matchAll(SENT_END)) {
    const end = (m.index ?? 0) + m[1].length;
    const candidate = t.slice(start, end);
    if (isAbbreviation(candidate.replace(/["»”’) ]+$/, ""))) continue;
    pieces.push(candidate.trim());
    start = (m.index ?? 0) + m[0].length;
  }
  pieces.push(t.slice(start).trim());
  return pieces.filter(Boolean);
}

export function splitParagraphs(text: string): string[] {
  return text
    .trim()
    .split(/\n\s*\n|\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export interface SentenceSpan {
  index: number;
  paragraph: number;
  text: string;
  start: number;
  end: number;
}

/** Sentences with their offsets in ``text`` (for highlighting and click-to-inspect). */
export function sentenceSpans(text: string): SentenceSpan[] {
  const out: SentenceSpan[] = [];
  let cursor = 0;
  splitParagraphs(text).forEach((para, p) => {
    for (const s of splitSentences(para)) {
      const start = text.indexOf(s, cursor);
      if (start < 0) continue;
      out.push({ index: out.length, paragraph: p, text: s, start, end: start + s.length });
      cursor = start + s.length;
    }
  });
  return out;
}

/** Group paragraphs into chunks of about ``maxWords`` without splitting a paragraph. */
export function chunkParagraphs(paragraphs: string[], maxWords = 1200): string[][] {
  const chunks: string[][] = [[]];
  let words = 0;
  for (const p of paragraphs) {
    const n = p.split(/\s+/).length;
    if (chunks[chunks.length - 1].length && words + n > maxWords) {
      chunks.push([]);
      words = 0;
    }
    chunks[chunks.length - 1].push(p);
    words += n;
  }
  return chunks.filter((c) => c.length);
}
