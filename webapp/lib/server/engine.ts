// Server-side evidence engine: termbase lookup + BM25 translation memory, built once per
// instance from data/bundle.json.gz (written by `uv run trad-gmt export-web --app`).
// Mirrors trad_gmt/mt/glossary.py and trad_gmt/mt/memory.py.

import { readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { contentTokens, sentenceSpans, splitParagraphs, splitSentences, tokenSpans } from "../textnorm";
import type { Analysis, Example, GlossaryEntry, Lang, TermHit } from "../types";

type MemoryRow = [string, string, string, string, string]; // fr, tgt, source, label, url

interface Bundle {
  prompts: Record<"translate_system" | "translate_user" | "review_system" | "review_user" | "fix_user", string>;
  schemas: { review: Record<string, unknown>; fix: Record<string, unknown> };
  style: Record<Lang, string>;
  swiss_de: string;
  per_sentence: Record<Lang, Record<string, number>>;
  stopwords: string[];
  glossary: GlossaryEntry[];
  memory: Record<Lang, Record<string, MemoryRow[]>>;
}

class BM25 {
  private postings = new Map<string, Float32Array>();

  constructor(readonly rows: MemoryRow[], stop: Set<string>, k1 = 1.4, b = 0.75) {
    const post = new Map<string, number[]>();
    const dl = new Float32Array(rows.length);
    rows.forEach((r, d) => {
      const tf = new Map<string, number>();
      for (const t of contentTokens(r[0], stop)) tf.set(t, (tf.get(t) ?? 0) + 1);
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
    for (const t of new Set(contentTokens(query, stop))) {
      const arr = this.postings.get(t);
      if (!arr) continue;
      for (let j = 0; j < arr.length; j += 2) scores.set(arr[j], (scores.get(arr[j]) ?? 0) + arr[j + 1]);
    }
    return [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, k);
  }
}

export interface Engine {
  bundle: Bundle;
  stop: Set<string>;
  glossary: Map<string, GlossaryEntry>;
  lengths: Map<string, Set<number>>;
  memory: Record<Lang, Record<string, BM25>>;
  stats: { terms: number; sentences: Record<string, number> };
}

let engine: Engine | null = null;

export function getEngine(): Engine {
  if (engine) return engine;
  const file = path.join(process.cwd(), "data", "bundle.json.gz");
  const bundle = JSON.parse(gunzipSync(readFileSync(file)).toString("utf-8")) as Bundle;
  const stop = new Set(bundle.stopwords);
  const glossary = new Map<string, GlossaryEntry>();
  const lengths = new Map<string, Set<number>>();
  for (const e of bundle.glossary) {
    glossary.set(e.key.join(" "), e);
    if (!lengths.has(e.key[0])) lengths.set(e.key[0], new Set());
    lengths.get(e.key[0])!.add(e.key.length);
  }
  const memory = {} as Record<Lang, Record<string, BM25>>;
  const sentences: Record<string, number> = {};
  for (const [lang, pools] of Object.entries(bundle.memory) as [Lang, Record<string, MemoryRow[]>][]) {
    memory[lang] = {};
    for (const [pool, rows] of Object.entries(pools)) {
      memory[lang][pool] = new BM25(rows, stop);
      sentences[`${lang}/${pool}`] = rows.length;
    }
  }
  engine = { bundle, stop, glossary, lengths, memory, stats: { terms: glossary.size, sentences } };
  return engine;
}

/** Greedy longest match of glossary keys; entries lacking ``lang`` are skipped. */
export function findTerms(text: string, lang: Lang | null, limit = 150): TermHit[] {
  const { glossary, lengths } = getEngine();
  const spans = tokenSpans(text);
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
      if (!e || (lang ? !e[lang].length : !e.en.length && !e.de.length)) continue;
      const span: [number, number] = [spans[i][1], spans[i + n - 1][2]];
      const hit = hits.get(key);
      if (hit) {
        hit.count++;
        hit.spans.push(span);
      } else {
        hits.set(key, { key, fr: e.fr, surface: text.slice(...span), count: 1, spans: [span], en: e.en, de: e.de });
      }
      matched = n;
      break;
    }
    i += matched || 1;
  }
  const prio = (h: TermHit) => (lang ? h[lang][0]?.[2] : Math.min(h.en[0]?.[2] ?? 9, h.de[0]?.[2] ?? 9)) ?? 9;
  return [...hits.values()]
    .sort((a, b) => b.key.split(" ").length - a.key.split(" ").length || prio(a) - prio(b) || a.fr.localeCompare(b.fr))
    .slice(0, limit);
}

/** Per-sentence retrieval with de-duplication and a per-document budget (memory.py). */
export function retrieve(sentences: string[], lang: Lang, budget = 40): Example[] {
  const { memory, stop, bundle } = getEngine();
  const seen = new Set<string>();
  let picked: Example[] = [];
  sentences.forEach((q, si) => {
    for (const [pool, k] of Object.entries(bundle.per_sentence[lang])) {
      const idx = memory[lang][pool];
      let added = 0;
      for (const [d, score] of idx.search(q, stop, k * 3)) {
        const [fr, tgt, source, label, url] = idx.rows[d];
        const key = fr.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        picked.push({ fr, tgt, source, label, url, pool: pool as Example["pool"], score: Math.round(score * 100) / 100, sentence: si });
        if (++added === k) break;
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

export function evidence(source: string, lang: Lang): { hits: TermHit[]; examples: Example[] } {
  const sentences = splitParagraphs(source).flatMap(splitSentences);
  return { hits: findTerms(source, lang, 120), examples: retrieve(sentences, lang) };
}

export function analyze(text: string): Analysis {
  const sentences = sentenceSpans(text);
  const queries = sentences.map((s) => s.text);
  return {
    sentences,
    terms: findTerms(text, null),
    references: { en: retrieve(queries, "en"), de: retrieve(queries, "de") },
    words: text.trim() ? text.trim().split(/\s+/).length : 0,
  };
}
