// Aggregates the shared store into the scoreboard: how raters score each system, what each
// component adds (paired on the same passage and rater), what each stage of the pipeline does,
// and how much editors still change before validating.

import { CANDIDATE_LABEL, COMPONENTS, type Judgment } from "../candidates";
import { CATEGORIES, type Category, type Lang, type StoreEvent } from "../types";
import { listEvents, STORE } from "./store";

type J = StoreEvent & Judgment;
const wordsOf = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export interface SystemRow {
  id: string;
  label: string;
  lang: Lang;
  judged: number;
  score: number | null;
  best: number;
  seen: number;
  minorPer1k: number | null;
  majorPer1k: number | null;
}

export interface ComponentRow {
  component: string;
  with: string;
  without: string;
  n: number;
  scoreWith: number | null;
  scoreWithout: number | null;
  delta: number | null;
  better: number;
  worse: number;
}

export interface StageRow {
  system: string;
  label: string;
  lang: Lang;
  runs: number;
  words: number;
  editorShare: number | null;
  diagnosedPer1k: number | null;
  byCategory: Record<Category, number>;
  major: number;
  applied: number;
  rejected: number;
  pruned: number | null;
  usdPer1k: number | null;
  secPer1k: number | null;
  qaDraftPer1k: number | null;
  qaFinalPer1k: number | null;
}

export interface ValidationRow {
  system: string;
  label: string;
  lang: Lang;
  n: number;
  words: number;
  humanShare: number | null;
  untouched: number;
}

export interface Scoreboard {
  store: typeof STORE;
  counts: { runs: number; validations: number; judgments: number; raters: string[] };
  systems: SystemRow[];
  components: ComponentRow[];
  stages: StageRow[];
  validations: ValidationRow[];
}

export async function scoreboard(): Promise<Scoreboard> {
  const [runs, validations, judgments] = await Promise.all([listEvents("run"), listEvents("validation"), listEvents("judgment") as Promise<J[]>]);
  const label = (id: string) => CANDIDATE_LABEL[id] ?? id;

  // ---- systems, as rated blind
  const sys = new Map<string, { id: string; lang: Lang; scores: number[]; best: number; seen: number; minor: number; major: number; words: number }>();
  for (const j of judgments) {
    for (const c of j.candidates ?? []) {
      const k = `${c.system}|${j.lang}`;
      const a = sys.get(k) ?? { id: c.system, lang: j.lang, scores: [], best: 0, seen: 0, minor: 0, major: 0, words: 0 };
      a.seen += 1;
      if (j.best === c.system) a.best += 1;
      if (typeof c.score === "number") {
        a.scores.push(c.score);
        a.words += wordsOf(c.text);
        a.minor += (c.spans ?? []).filter((s) => s.severity === "minor").length;
        a.major += (c.spans ?? []).filter((s) => s.severity === "major").length;
      }
      sys.set(k, a);
    }
  }
  const systems: SystemRow[] = [...sys.values()]
    .map((a) => ({
      id: a.id,
      label: label(a.id),
      lang: a.lang,
      judged: a.scores.length,
      score: mean(a.scores),
      best: a.best,
      seen: a.seen,
      minorPer1k: a.words ? (a.minor / a.words) * 1000 : null,
      majorPer1k: a.words ? (a.major / a.words) * 1000 : null,
    }))
    .sort((x, y) => x.lang.localeCompare(y.lang) || (y.score ?? -1) - (x.score ?? -1));

  // ---- components: the same rater scoring the same passage with and without the component
  const components: ComponentRow[] = COMPONENTS.map((c) => {
    const pairs: [number, number][] = [];
    for (const j of judgments) {
      const w = j.candidates?.find((x) => x.system === c.with)?.score;
      const wo = j.candidates?.find((x) => x.system === c.without)?.score;
      if (typeof w === "number" && typeof wo === "number") pairs.push([w, wo]);
    }
    const sw = mean(pairs.map((p) => p[0]));
    const swo = mean(pairs.map((p) => p[1]));
    return {
      component: c.component,
      with: label(c.with),
      without: label(c.without),
      n: pairs.length,
      scoreWith: sw,
      scoreWithout: swo,
      delta: sw !== null && swo !== null ? sw - swo : null,
      better: pairs.filter((p) => p[0] > p[1]).length,
      worse: pairs.filter((p) => p[0] < p[1]).length,
    };
  });

  // ---- stages: what the pipeline did, from the statistics every run leaves behind
  const st = new Map<string, StoreEvent[]>();
  for (const r of runs) {
    const id = (r.variant as string | null) ?? (r.system as string);
    const k = `${id}|${r.lang as string}`;
    st.set(k, [...(st.get(k) ?? []), r]);
  }
  const stages: StageRow[] = [...st.entries()]
    .map(([k, rs]) => {
      const [id, lang] = k.split("|") as [string, Lang];
      const words = rs.reduce((s, r) => s + num(r.words), 0);
      const per1k = (f: (r: StoreEvent) => number) => (words ? (rs.reduce((s, r) => s + f(r), 0) / words) * 1000 : null);
      const qa = (r: StoreEvent, key: "qaDraft" | "qaFinal") => {
        const q = r[key] as { errors?: number; warnings?: number } | undefined;
        return num(q?.errors) + num(q?.warnings);
      };
      const edited = rs.filter((r) => num(r.calls) > 1);
      return {
        system: id,
        label: label(id),
        lang,
        runs: rs.length,
        words,
        editorShare: mean(edited.map((r) => num(r.editorShare))),
        diagnosedPer1k: edited.length ? per1k((r) => num(r.diagnosed)) : null,
        byCategory: Object.fromEntries(
          CATEGORIES.map((c) => [c, rs.reduce((s, r) => s + num((r.byCategory as Record<string, number> | undefined)?.[c]), 0)]),
        ) as Record<Category, number>,
        major: rs.reduce((s, r) => {
          const b = r.bySeverity as Record<string, number> | undefined;
          return s + num(b?.major) + num(b?.critical);
        }, 0),
        applied: rs.reduce((s, r) => s + num(r.applied), 0),
        rejected: rs.reduce((s, r) => s + num(r.rejected), 0),
        pruned: mean(rs.map((r) => num(r.pruned))),
        usdPer1k: per1k((r) => num(r.usd)),
        secPer1k: per1k((r) => num(r.ms) / 1000),
        qaDraftPer1k: per1k((r) => qa(r, "qaDraft")),
        qaFinalPer1k: per1k((r) => qa(r, "qaFinal")),
      };
    })
    .sort((x, y) => x.lang.localeCompare(y.lang) || y.runs - x.runs);

  // ---- validations: how much the editor still changed
  const va = new Map<string, StoreEvent[]>();
  for (const v of validations) {
    const k = `${v.system as string}|${v.lang as string}`;
    va.set(k, [...(va.get(k) ?? []), v]);
  }
  const vrows: ValidationRow[] = [...va.entries()]
    .map(([k, vs]) => {
      const [id, lang] = k.split("|") as [string, Lang];
      return {
        system: id,
        label: label(id),
        lang,
        n: vs.length,
        words: vs.reduce((s, v) => s + num(v.words), 0),
        humanShare: mean(vs.map((v) => num(v.humanShare))),
        untouched: vs.filter((v) => num(v.humanShare) === 0).length,
      };
    })
    .sort((x, y) => x.lang.localeCompare(y.lang) || y.n - x.n);

  const raters = [...new Set([...judgments.map((j) => j.rater), ...validations.map((v) => v.reviewer as string)].filter(Boolean))].sort();
  return { store: STORE, counts: { runs: runs.length, validations: validations.length, judgments: judgments.length, raters }, systems, components, stages, validations: vrows };
}
