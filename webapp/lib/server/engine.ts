// Server-side evidence engine: termbase lookup + BM25 translation memory, built once per
// instance from data/bundle.json.gz (written by `uv run trad-gmt export-web --app`).
// Mirrors trad_gmt/mt/glossary.py and trad_gmt/mt/memory.py.

import { readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { contentTokens, sentenceSpans, splitParagraphs, splitSentences, tokenSpans } from "../textnorm";
import { TARGETS, type Analysis, type Example, type GlossaryEntry, type Lang, type Src, type TargetRow, type TermHit } from "../types";

type MemoryRow = [string, string, string, string, string]; // source sentence, target, source id, label, url

interface Bundle {
  prompts: Record<"translate_system" | "translate_user" | "review_system" | "review_user" | "fix_user", string>;
  schemas: { review: Record<string, unknown>; fix: Record<string, unknown> };
  style: Record<"en" | "de", string>;
  swiss_de: string;
  germany_de?: string;
  per_sentence: Record<"en" | "de", Record<string, number>>;
  stopwords: string[];
  glossary: GlossaryEntry[];
  /** French → English / German sentence pairs, by pool */
  memory: Record<"en" | "de", Record<string, MemoryRow[]>>;
  /** English → German pairs (English → French reads memory.en the other way round) */
  memory_en?: { de?: Record<string, MemoryRow[]> };
  stopwords_en?: string[];
  /** the termbase keyed on English, each pair checked against published sentence pairs */
  glossary_en?: { en: string; key: string[]; fr: TargetRow[]; de: TargetRow[] }[];
  samples?: { id: string; title: string; fr: string; en: string; de: string }[];
}

class BM25 {
  private postings = new Map<string, Float32Array>();

  constructor(readonly rows: MemoryRow[], stop: Set<string>, readonly src: Src, k1 = 1.4, b = 0.75) {
    const post = new Map<string, number[]>();
    const dl = new Float32Array(rows.length);
    rows.forEach((r, d) => {
      const tf = new Map<string, number>();
      for (const t of contentTokens(r[0], stop, src)) tf.set(t, (tf.get(t) ?? 0) + 1);
      let len = 0;
      for (const [t, c] of tf) {
        len += c;
        let p = post.get(t);
        if (!p) post.set(t, (p = []));
        p.push(d, c);
      }
      dl[d] = len;
    });
    const n = rows.length;
    let total = 0;
    for (const v of dl) total += v;
    const avg = total / Math.max(n, 1) || 1;
    for (const [t, p] of post) {
      const df = p.length / 2;
      const idf = Math.log1p((n - df + 0.5) / (df + 0.5));
      const arr = new Float32Array(p.length);
      for (let j = 0; j < p.length; j += 2) {
        const d = p[j];
        const tf = p[j + 1];
        arr[j] = d;
        arr[j + 1] = ((tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * dl[d]) / avg))) * idf;
      }
      this.postings.set(t, arr);
    }
  }

  search(query: string, stop: Set<string>, k: number): [number, number][] {
    const scores = new Map<number, number>();
    for (const t of new Set(contentTokens(query, stop, this.src))) {
      const arr = this.postings.get(t);
      if (!arr) continue;
      for (let j = 0; j < arr.length; j += 2) scores.set(arr[j], (scores.get(arr[j]) ?? 0) + arr[j + 1]);
    }
    return [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, k);
  }
}

/** A termbase entry keyed on one source language, with its equivalents in the others. */
interface Entry {
  term: string;
  key: string[];
  en: TargetRow[];
  de: TargetRow[];
  fr: TargetRow[];
}

/** Everything needed to read texts in one source language: its stop words, its termbase keys
 *  and its sentence-pair indexes towards each target. */
interface Side {
  src: Src;
  stop: Set<string>;
  glossary: Map<string, Entry>;
  lengths: Map<string, Set<number>>;
  memory: Partial<Record<Lang, Record<string, BM25>>>;
  perSentence: Partial<Record<Lang, Record<string, number>>>;
}

export interface Engine {
  bundle: Bundle;
  sides: Partial<Record<Src, Side>>;
  stats: { terms: number; sentences: Record<string, number> };
}

let engine: Engine | null = null;

function keyed(entries: Entry[]): Pick<Side, "glossary" | "lengths"> {
  const glossary = new Map<string, Entry>();
  const lengths = new Map<string, Set<number>>();
  for (const e of entries) {
    glossary.set(e.key.join(" "), e);
    if (!lengths.has(e.key[0])) lengths.set(e.key[0], new Set());
    lengths.get(e.key[0])!.add(e.key.length);
  }
  return { glossary, lengths };
}

function indexes(pools: Record<string, MemoryRow[]>, stop: Set<string>, src: Src): Record<string, BM25> {
  return Object.fromEntries(Object.entries(pools).map(([pool, rows]) => [pool, new BM25(rows, stop, src)]));
}

function frenchSide(bundle: Bundle): Side {
  const stop = new Set(bundle.stopwords);
  const entries = bundle.glossary.map((e) => ({ term: e.fr, key: e.key, en: e.en, de: e.de, fr: [] as TargetRow[] }));
  return {
    src: "fr",
    stop,
    ...keyed(entries),
    memory: { en: indexes(bundle.memory.en, stop, "fr"), de: indexes(bundle.memory.de, stop, "fr") },
    perSentence: bundle.per_sentence,
  };
}

/** The termbase is keyed on French. For English texts the bundle carries it read from its
 *  English side (trad_gmt.mt.export.english_glossary): each English equivalent is a key, its
 *  French equivalent the entry it came from, its German equivalents that entry's, and every
 *  pair is checked against published sentence pairs, because a dictionary read backwards
 *  gives wrong pairs. English → French examples are the French → English pairs read from the
 *  English side; English → German pairs are shipped as such. */
function englishSide(bundle: Bundle): Side {
  const stop = new Set(bundle.stopwords_en ?? []);
  const entries = (bundle.glossary_en ?? []).map((e) => ({ term: e.en, key: e.key, en: [] as TargetRow[], de: e.de, fr: e.fr }));
  const toFrench = Object.fromEntries(
    Object.entries(bundle.memory.en).map(([pool, rows]) => [pool, rows.map((r) => [r[1], r[0], r[2], r[3], r[4]] as MemoryRow)]),
  );
  const toGerman = bundle.memory_en?.de ?? {};
  const per: Record<string, number> = { style: 2, domain: 1 };
  return {
    src: "en",
    stop,
    ...keyed(entries),
    memory: { fr: indexes(toFrench, stop, "en"), de: indexes(toGerman, stop, "en") },
    perSentence: { fr: per, de: Object.fromEntries(Object.keys(toGerman).map((p) => [p, per[p] ?? 1])) },
  };
}

export function getEngine(): Engine {
  if (engine) return engine;
  const file = path.join(process.cwd(), "data", "bundle.json.gz");
  const bundle = JSON.parse(gunzipSync(readFileSync(file)).toString("utf-8")) as Bundle;
  const fr = frenchSide(bundle);
  const sentences: Record<string, number> = {};
  for (const lang of ["en", "de"] as const) for (const [pool, rows] of Object.entries(bundle.memory[lang])) sentences[`${lang}/${pool}`] = rows.length;
  engine = { bundle, sides: { fr }, stats: { terms: fr.glossary.size, sentences } };
  return engine;
}

/** The English side is built on the first English text: it doubles the index, and most
 *  instances only ever see French. */
function side(src: Src): Side {
  const e = getEngine();
  return (e.sides[src] ??= src === "en" ? englishSide(e.bundle) : frenchSide(e.bundle));
}

/** Greedy longest match of termbase keys; entries with no equivalent in ``lang`` (or, without
 *  ``lang``, in neither target of this source) are skipped. */
export function findTerms(text: string, lang: Lang | null, limit = 150, src: Src = "fr"): TermHit[] {
  const { glossary, lengths } = side(src);
  const targets = TARGETS[src];
  const spans = tokenSpans(text, src);
  const toks = spans.map((s) => s[0]);
  const hits = new Map<string, TermHit>();
  let i = 0;
  while (i < toks.length) {
    let matched = 0;
    const lens = [...(lengths.get(toks[i]) ?? [])].sort((a, b) => b - a);
    for (const n of lens) {
      if (i + n > toks.length) continue;
      const key = toks.slice(i, i + n).join(" ");
      const e = glossary.get(key);
      if (!e || (lang ? !e[lang].length : targets.every((l) => !e[l].length))) continue;
      const span: [number, number] = [spans[i][1], spans[i + n - 1][2]];
      const hit = hits.get(key);
      if (hit) {
        hit.count++;
        hit.spans.push(span);
      } else {
        hits.set(key, { key, term: e.term, surface: text.slice(...span), count: 1, spans: [span], en: e.en, de: e.de, fr: e.fr });
      }
      matched = n;
      break;
    }
    i += matched || 1;
  }
  const prio = (h: TermHit) => (lang ? h[lang][0]?.[2] : Math.min(...targets.map((l) => h[l][0]?.[2] ?? 9))) ?? 9;
  return [...hits.values()]
    .sort((a, b) => b.key.split(" ").length - a.key.split(" ").length || prio(a) - prio(b) || a.term.localeCompare(b.term))
    .slice(0, limit);
}

/** Content unigrams and bigrams of a sentence: what an example can "cover". */
function grams(text: string, stop: Set<string>, src: Src): Set<string> {
  const t = contentTokens(text, stop, src);
  const out = new Set(t);
  for (let i = 0; i + 1 < t.length; i++) out.add(t[i] + " " + t[i + 1]);
  return out;
}

const FLOOR = 0.4; // an example scoring under 40 % of the sentence's best match is noise, not help
const COVERED = 0.1; // weight left on an n-gram once a chosen example already shows it

/** Per-sentence retrieval with de-duplication and a per-document budget.
 *  BM25 proposes; the pick is by coverage (R-BM25, Agrawal et al. 2023): each next example is
 *  the one showing most of the sentence's words and word pairs that the examples chosen so far
 *  do not show yet, so three examples teach three things instead of the same thing three times.
 *  (trad_gmt/mt/memory.py still takes the plain BM25 top-k.) */
export function retrieve(sentences: string[], lang: Lang, budget = 40, src: Src = "fr"): Example[] {
  const { memory, stop, perSentence } = side(src);
  const pools = memory[lang];
  if (!pools) return [];
  const seen = new Set<string>();
  let picked: Example[] = [];
  sentences.forEach((q, si) => {
    const want = grams(q, stop, src);
    for (const [pool, k] of Object.entries(perSentence[lang] ?? {})) {
      const idx = pools[pool];
      if (!idx) continue;
      const found = idx.search(q, stop, k * 8);
      const top = found[0]?.[1] ?? 0;
      const cands = found
        .filter(([, score]) => score >= top * FLOOR)
        .map(([d, score]) => ({ d, score, g: [...grams(idx.rows[d][0], stop, src)].filter((x) => want.has(x)) }))
        .filter((c) => !seen.has(idx.rows[c.d][0].toLowerCase()));
      const weight = new Map<string, number>([...want].map((g) => [g, 1]));
      for (let n = 0; n < k && cands.length; n++) {
        let best = 0;
        let bestGain = -1;
        cands.forEach((c, i) => {
          const gain = c.g.reduce((s, g) => s + (weight.get(g) ?? 0), 0);
          if (gain > bestGain + 1e-9) {
            best = i;
            bestGain = gain; // ties keep the higher BM25 score (cands are in score order)
          }
        });
        const [c] = cands.splice(best, 1);
        for (const g of c.g) weight.set(g, (weight.get(g) ?? 0) * COVERED);
        const [from, tgt, source, label, url] = idx.rows[c.d];
        const key = from.toLowerCase();
        if (seen.has(key)) {
          n--;
          continue;
        }
        seen.add(key);
        picked.push({ src: from, tgt, source, label, url, pool: pool as Example["pool"], score: Math.round(c.score * 100) / 100, sentence: si });
      }
    }
  });
  if (picked.length > budget) {
    const byScore = (a: Example, b: Example) => b.score - a.score;
    const style = picked.filter((e) => e.pool === "style").sort(byScore).slice(0, Math.ceil(budget * 0.7));
    const other = picked.filter((e) => e.pool !== "style").sort(byScore).slice(0, budget - style.length);
    const keep = new Set([...style, ...other]);
    picked = picked.filter((e) => keep.has(e));
  }
  return picked;
}

export function evidence(source: string, lang: Lang, src: Src = "fr"): { hits: TermHit[]; examples: Example[] } {
  const sentences = splitParagraphs(source).flatMap(splitSentences);
  return { hits: findTerms(source, lang, 120, src), examples: retrieve(sentences, lang, 40, src) };
}

export function analyze(text: string, src: Src = "fr"): Analysis {
  const sentences = sentenceSpans(text);
  const queries = sentences.map((s) => s.text);
  const references: Record<Lang, Example[]> = { en: [], de: [], fr: [] };
  for (const lang of TARGETS[src]) references[lang] = retrieve(queries, lang, 40, src);
  return {
    src,
    sentences,
    terms: findTerms(text, null, 150, src),
    references,
    words: text.trim() ? text.trim().split(/\s+/).length : 0,
  };
}
