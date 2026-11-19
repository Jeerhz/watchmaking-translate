"use client";

// Side-by-side, optionally blind, comparison of the translation systems on the same French text,
// with human ratings kept in this browser and exportable as CSV.

import { useEffect, useMemo, useRef, useState } from "react";
import { cost } from "@/lib/client";
import { runQA, summarize } from "@/lib/qa";
import { splitParagraphs } from "@/lib/textnorm";
import type { Analysis, Effort, Lang, TermHit } from "@/lib/types";
import { emptyOpen, emptyRun, runLanguage, runOpenLanguage, type LangRun, type OpenRun, type Pipeline } from "./run";

type SystemId = "claude" | "deepl-claude" | "fusion" | "deepl" | "open" | "gmt";
type Kind = "pipeline" | "deepl" | "open" | "gmt";

const SYSTEMS: { id: SystemId; label: string; kind: Kind; help: string }[] = [
  { id: "claude", label: "Claude (draft + editor)", kind: "pipeline", help: "Claude drafts with GMT examples and terms; Claude’s sub-editor reviews; QA; correction" },
  { id: "deepl-claude", label: "DeepL → Claude editor", kind: "pipeline", help: "DeepL drafts (GMT glossary, house style, context); Claude’s sub-editor edits into GMT style" },
  { id: "fusion", label: "Claude + DeepL fusion", kind: "pipeline", help: "Both draft; the sub-editor reviews Claude’s draft with DeepL’s beside it and keeps the best wording" },
  { id: "deepl", label: "DeepL alone", kind: "deepl", help: "DeepL with GMT glossary, house style and context — no review" },
  { id: "open", label: "Fine-tuned Gemma alone", kind: "open", help: "Our fine-tuned open model, one pass, termbase hints — no review" },
  { id: "gmt", label: "GMT’s published translation", kind: "gmt", help: "What GMT Magazine printed (samples only) — the human reference, hidden among the systems" },
];
const LABEL = Object.fromEntries(SYSTEMS.map((s) => [s.id, s.label])) as Record<SystemId, string>;
const KIND = Object.fromEntries(SYSTEMS.map((s) => [s.id, s.kind])) as Record<SystemId, Kind>;
const LANG_TITLE: Record<Lang, string> = { en: "English", de: "Deutsch" };
const STORE = "gmt-judgments-v1";

interface Sample {
  id: string;
  title: string;
  fr: string;
  en: string;
  de: string;
}

interface Cand {
  status: "idle" | "running" | "done" | "error" | "stopped";
  text: string;
  live: string;
  ms: number;
  usd: number;
  deeplChars: number;
  error?: string;
}

interface Judgment {
  saved: string;
  sample: string | null;
  lang: Lang;
  blind: boolean;
  source: string;
  best: SystemId | null;
  candidates: { label: string; system: SystemId; text: string; rating: number | null; note: string }[];
}

const letter = (i: number) => String.fromCharCode(65 + i);

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function loadHistory(): Judgment[] {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "[]") as Judgment[];
  } catch {
    return [];
  }
}

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function Compare() {
  const [text, setText] = useState("");
  const [samples, setSamples] = useState<Sample[]>([]);
  const [sample, setSample] = useState<Sample | null>(null);
  const [langs, setLangs] = useState<Record<Lang, boolean>>({ en: true, de: true });
  const [chosen, setChosen] = useState<Record<SystemId, boolean>>({
    claude: true,
    "deepl-claude": true,
    fusion: true,
    deepl: true,
    open: false,
    gmt: true,
  });
  const [effort, setEffort] = useState<Effort>("high");
  const [swiss, setSwiss] = useState(true);
  const [blind, setBlind] = useState(true);
  const [available, setAvailable] = useState<{ deepl: boolean; open: boolean }>({ deepl: false, open: false });

  const [runSrc, setRunSrc] = useState<{ text: string; sample: Sample | null; langs: Lang[]; terms: TermHit[] } | null>(null);
  const [order, setOrder] = useState<Record<Lang, SystemId[]>>({ en: [], de: [] });
  const [pipes, setPipes] = useState<Record<string, LangRun>>({});
  const [singles, setSingles] = useState<Record<string, OpenRun>>({});
  const [ratings, setRatings] = useState<Record<string, { rating: number | null; note: string }>>({});
  const [best, setBest] = useState<Record<Lang, SystemId | null>>({ en: null, de: null });
  const [revealed, setRevealed] = useState<Record<Lang, boolean>>({ en: false, de: false });
  const [saved, setSaved] = useState<Record<Lang, boolean>>({ en: false, de: false });
  const [history, setHistory] = useState<Judgment[]>([]);
  const [running, setRunning] = useState(false);
  const ctl = useRef<AbortController | null>(null);

  useEffect(() => {
    setHistory(loadHistory());
    fetch("/api/samples")
      .then((r) => (r.ok ? r.json() : []))
      .then(setSamples)
      .catch(() => undefined);
    Promise.all([
      fetch("/api/deepl").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/open-mt").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([d, o]) => setAvailable({ deepl: Boolean(d?.configured), open: Boolean(o?.configured) }))
      .catch(() => undefined);
  }, []);

  const usable = (id: SystemId) =>
    id === "gmt" ? Boolean(sample && text === sample.fr) : id === "open" ? available.open : id === "deepl" || KIND[id] === "pipeline" ? id === "claude" || available.deepl : true;

  function pickSample(s: Sample | null) {
    setSample(s);
    if (s) setText(s.fr);
  }

  async function run() {
    const src = text.trim();
    const ls = (["en", "de"] as Lang[]).filter((l) => langs[l]);
    const systems = SYSTEMS.map((s) => s.id).filter((id) => chosen[id] && usable(id));
    if (!src || !ls.length || !systems.length) return;
    const res = await fetch("/api/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: src }) });
    if (res.status === 401) {
      window.location.assign("/login?next=/compare");
      return;
    }
    const analysis = (await res.json()) as Analysis;
    const smp = sample && src === sample.fr.trim() ? sample : null;
    setRunSrc({ text: src, sample: smp, langs: ls, terms: analysis.terms });
    setOrder({ en: shuffle(systems), de: shuffle(systems) });
    setPipes({});
    setSingles({});
    setRatings({});
    setBest({ en: null, de: null });
    setRevealed({ en: false, de: false });
    setSaved({ en: false, de: false });
    setRunning(true);
    ctl.current = new AbortController();
    const signal = ctl.current.signal;
    const pipePatch = (k: string) => (fn: (r: LangRun) => LangRun) => setPipes((m) => ({ ...m, [k]: fn(m[k] ?? emptyRun()) }));
    const singlePatch = (k: string) => (fn: (r: OpenRun) => OpenRun) => setSingles((m) => ({ ...m, [k]: fn(m[k] ?? emptyOpen()) }));
    const tasks: Promise<void>[] = [];
    for (const lang of ls) {
      for (const id of systems) {
        const k = `${lang}:${id}`;
        if (KIND[id] === "pipeline") {
          tasks.push(runLanguage({ lang, text: src, terms: analysis.terms, effort, swiss, signal, patch: pipePatch(k), pipeline: id as Pipeline }));
        } else if (id === "deepl") {
          tasks.push(runOpenLanguage({ lang, text: src, swiss, signal, patch: singlePatch(k), engine: "deepl" }));
        } else if (id === "gmt" && smp) {
          setSingles((m) => ({ ...m, [k]: { ...emptyOpen(), status: "done", text: smp[lang], live: smp[lang] } }));
        }
      }
    }
    if (systems.includes("open")) {
      // one ZeroGPU Space: languages one after the other
      tasks.push(
        (async () => {
          for (const lang of ls) await runOpenLanguage({ lang, text: src, swiss, signal, patch: singlePatch(`${lang}:open`) });
        })(),
      );
    }
    await Promise.allSettled(tasks);
    ctl.current = null;
    setRunning(false);
  }

  function cand(lang: Lang, id: SystemId): Cand {
    const k = `${lang}:${id}`;
    if (KIND[id] === "pipeline") {
      const r = pipes[k] ?? emptyRun();
      return {
        status: r.status,
        text: r.final,
        live: r.live,
        ms: r.usage.reduce((s, u) => s + u.ms, 0),
        usd: cost(r.usage),
        deeplChars: r.deeplChars,
        error: r.error,
      };
    }
    const o = singles[k] ?? emptyOpen();
    return { status: o.status, text: o.text, live: o.live, ms: o.ms, usd: 0, deeplChars: o.chars, error: o.error };
  }

  function save(lang: Lang) {
    if (!runSrc) return;
    const j: Judgment = {
      saved: new Date().toISOString(),
      sample: runSrc.sample?.id ?? null,
      lang,
      blind,
      source: runSrc.text,
      best: best[lang],
      candidates: order[lang].map((id, i) => ({
        label: letter(i),
        system: id,
        text: cand(lang, id).text,
        rating: ratings[`${lang}:${id}`]?.rating ?? null,
        note: ratings[`${lang}:${id}`]?.note ?? "",
      })),
    };
    const next = [...loadHistory(), j];
    try {
      localStorage.setItem(STORE, JSON.stringify(next));
    } catch {}
    setHistory(next);
    setSaved((s) => ({ ...s, [lang]: true }));
    setRevealed((r) => ({ ...r, [lang]: true }));
  }

  function exportCsv() {
    const head = ["saved", "sample", "lang", "blind", "system", "label", "rating", "best", "note", "source", "text"];
    const lines = history.flatMap((j) =>
      j.candidates.map((c) =>
        [j.saved, j.sample, j.lang, j.blind, c.system, c.label, c.rating, j.best === c.system ? 1 : 0, c.note, j.source, c.text].map(csvCell).join(","),
      ),
    );
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `gmt-judgments-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function clearHistory() {
    if (!window.confirm(`Delete the ${history.length} saved judgment(s) stored in this browser?`)) return;
    try {
      localStorage.removeItem(STORE);
    } catch {}
    setHistory([]);
  }

  const summary = useMemo(() => {
    const agg = new Map<SystemId, { n: number; sum: number; best: number; seen: number }>();
    for (const j of history)
      for (const c of j.candidates) {
        const a = agg.get(c.system) ?? { n: 0, sum: 0, best: 0, seen: 0 };
        a.seen += 1;
        if (c.rating) {
          a.n += 1;
          a.sum += c.rating;
        }
        if (j.best === c.system) a.best += 1;
        agg.set(c.system, a);
      }
    return SYSTEMS.filter((s) => agg.has(s.id)).map((s) => ({ id: s.id, ...agg.get(s.id)! }));
  }, [history]);

  return (
    <main className="page" style={{ display: "grid", gap: 20 }}>
      <section className="panel" style={{ display: "grid", gap: 12 }}>
        <div className="panel-head">
          <span className="label">Compare the systems on the same text — judge them blind</span>
          <div className="row" style={{ gap: 6 }}>
            {samples.length > 0 && (
              <>
                <select
                  value={sample?.id ?? ""}
                  onChange={(e) => pickSample(samples.find((s) => s.id === e.target.value) ?? null)}
                  disabled={running}
                  aria-label="GMT Magazine sample"
                >
                  <option value="">GMT Magazine sample…</option>
                  {samples.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title} — {s.fr.slice(0, 50)}…
                    </option>
                  ))}
                </select>
                <button className="btn ghost small" type="button" disabled={running} onClick={() => pickSample(samples[Math.floor(Math.random() * samples.length)])}>
                  Random sample
                </button>
              </>
            )}
          </div>
        </div>
        <textarea
          className="source"
          lang="fr"
          style={{ minHeight: 140 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste French copy, or load a GMT Magazine sample (issues 97–98, held out — GMT’s own EN and DE can then join the comparison, hidden among the systems)."
          aria-label="French source text"
        />
        <div className="row" style={{ flexWrap: "wrap", gap: 14 }}>
          {SYSTEMS.map((s) => (
            <label key={s.id} className="check" title={s.help} style={{ opacity: usable(s.id) ? 1 : 0.45 }}>
              <input
                type="checkbox"
                checked={chosen[s.id] && usable(s.id)}
                disabled={running || !usable(s.id)}
                onChange={(e) => setChosen((c) => ({ ...c, [s.id]: e.target.checked }))}
              />{" "}
              {s.label}
            </label>
          ))}
        </div>
        <div className="row" style={{ flexWrap: "wrap", gap: 14 }}>
          {(["en", "de"] as Lang[]).map((l) => (
            <label key={l} className="check">
              <input type="checkbox" checked={langs[l]} disabled={running} onChange={(e) => setLangs((x) => ({ ...x, [l]: e.target.checked }))} /> {LANG_TITLE[l]}
            </label>
          ))}
          <label className="check">
            <input type="checkbox" checked={swiss} disabled={running} onChange={(e) => setSwiss(e.target.checked)} /> Swiss German
          </label>
          <label className="check">
            Claude effort
            <select value={effort} onChange={(e) => setEffort(e.target.value as Effort)} disabled={running}>
              <option value="high">High (faster)</option>
              <option value="xhigh">Extra high (production)</option>
            </select>
          </label>
          <label className="check" title="Hide which system wrote what until you save your ratings">
            <input type="checkbox" checked={blind} disabled={running} onChange={(e) => setBlind(e.target.checked)} /> Blind (shuffled, names hidden)
          </label>
        </div>
        <div className="row">
          <button className="btn" onClick={run} disabled={running || !text.trim()}>
            Run the selected systems
          </button>
          {running && (
            <button className="btn ghost" onClick={() => ctl.current?.abort()}>
              Stop
            </button>
          )}
          <span className="muted small">
            Each Claude pipeline costs about $0.05–0.15 per language for a paragraph at “high”; DeepL ≈ €0.002 per paragraph; the fine-tuned model is free
            but slower.
          </span>
        </div>
      </section>

      {runSrc &&
        runSrc.langs.map((lang) => (
          <LangCompare
            key={lang}
            lang={lang}
            source={runSrc.text}
            terms={runSrc.terms}
            swiss={swiss}
            order={order[lang]}
            cand={(id) => cand(lang, id)}
            blind={blind && !revealed[lang]}
            ratings={ratings}
            setRating={(id, v) => setRatings((r) => ({ ...r, [`${lang}:${id}`]: { ...(r[`${lang}:${id}`] ?? { rating: null, note: "" }), ...v } }))}
            best={best[lang]}
            setBest={(id) => setBest((b) => ({ ...b, [lang]: id }))}
            saved={saved[lang]}
            onSave={() => save(lang)}
            onReveal={() => setRevealed((r) => ({ ...r, [lang]: !r[lang] }))}
            running={running}
          />
        ))}

      <section className="panel" style={{ display: "grid", gap: 10 }}>
        <div className="panel-head">
          <span className="label">Your judgments so far ({history.length} saved in this browser)</span>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn ghost small" onClick={exportCsv} disabled={!history.length}>
              Export CSV
            </button>
            <button className="btn ghost small" onClick={clearHistory} disabled={!history.length}>
              Clear
            </button>
          </div>
        </div>
        {summary.length ? (
          <div className="table-wrap"><table>
            <thead>
              <tr>
                <th>System</th>
                <th className="num">Judged</th>
                <th className="num">Mean rating (1–5)</th>
                <th className="num">Chosen as best</th>
              </tr>
            </thead>
            <tbody>
              {summary
                .sort((a, b) => b.sum / Math.max(b.n, 1) - a.sum / Math.max(a.n, 1))
                .map((s) => (
                  <tr key={s.id}>
                    <td>{LABEL[s.id]}</td>
                    <td className="num">{s.n}</td>
                    <td className="num">{s.n ? (s.sum / s.n).toFixed(2) : "—"}</td>
                    <td className="num">
                      {s.best} / {s.seen}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table></div>
        ) : (
          <p className="muted small" style={{ margin: 0 }}>
            Rate the candidates and save: the summary across all your comparisons appears here. Ratings stay in this browser — export the CSV to share them.
          </p>
        )}
      </section>
    </main>
  );
}

function LangCompare(props: {
  lang: Lang;
  source: string;
  terms: TermHit[];
  swiss: boolean;
  order: SystemId[];
  cand: (id: SystemId) => Cand;
  blind: boolean;
  ratings: Record<string, { rating: number | null; note: string }>;
  setRating: (id: SystemId, v: Partial<{ rating: number | null; note: string }>) => void;
  best: SystemId | null;
  setBest: (id: SystemId) => void;
  saved: boolean;
  onSave: () => void;
  onReveal: () => void;
  running: boolean;
}) {
  const { lang, source, order, blind } = props;
  const cands = order.map((id) => ({ id, c: props.cand(id) }));
  const srcParas = splitParagraphs(source);
  const allDone = cands.every(({ c }) => c.status !== "running" && c.status !== "idle");
  const paras = cands.map(({ c }) => splitParagraphs(c.status === "done" ? c.text : c.live));
  const aligned = allDone && srcParas.length > 1 && paras.every((p, i) => cands[i].c.status !== "done" || p.length === srcParas.length);
  const name = (i: number) => (blind ? `System ${letter(i)}` : `${letter(i)} · ${LABEL[order[i]]}`);
  const qa = (i: number) => {
    const c = cands[i].c;
    if (c.status !== "done") return null;
    const s = summarize(runQA(source, c.text, lang, props.terms, props.swiss));
    return `${s.errors} QA errors · ${s.warnings} warnings`;
  };
  const meta = (i: number) => {
    const c = cands[i].c;
    const parts = [`${(c.ms / 1000).toFixed(0)} s`];
    if (c.usd) parts.push(`$${c.usd.toFixed(3)}`);
    if (c.deeplChars) parts.push(`DeepL ${c.deeplChars.toLocaleString("en")} chars`);
    return parts.join(" · ");
  };
  const grid = { display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" } as const;
  const card = (i: number, body: string, status: Cand["status"], error?: string) => (
    <div key={order[i]} className="output" lang={lang} style={{ minHeight: 0, margin: 0 }}>
      <div className="label" style={{ marginBottom: 6 }}>
        {name(i)}
        {status === "running" && <span className="muted small"> — translating…</span>}
      </div>
      {error ? <div className="notice err">{error}</div> : body || <span className="muted">…</span>}
    </div>
  );

  return (
    <section className="panel" style={{ display: "grid", gap: 14 }} aria-label={`${LANG_TITLE[lang]} comparison`}>
      <div className="panel-head">
        <h2 style={{ margin: 0, fontSize: "1.25rem" }}>{LANG_TITLE[lang]}</h2>
        <button className="btn ghost small" onClick={props.onReveal} disabled={!allDone}>
          {blind ? "Reveal the systems" : "Hide the names"}
        </button>
      </div>

      {aligned
        ? srcParas.map((p, k) => (
            <div key={k} style={{ display: "grid", gap: 8 }}>
              <div className="muted small" lang="fr" style={{ borderLeft: "3px solid var(--gold, #BCA480)", paddingLeft: 10 }}>
                {p}
              </div>
              <div style={grid}>{cands.map(({ c }, i) => card(i, paras[i][k] ?? "", c.status, c.error))}</div>
            </div>
          ))
        : (
            <div style={grid}>{cands.map(({ c }, i) => card(i, c.status === "done" ? c.text : c.live, c.status, c.error))}</div>
          )}

      {allDone && (
        <div className="table-wrap"><table>
          <thead>
            <tr>
              <th>Candidate</th>
              <th>Rating (1 = unusable, 5 = publishable as is)</th>
              <th>Best</th>
              <th>Note</th>
              {!blind && <th>Run</th>}
            </tr>
          </thead>
          <tbody>
            {cands.map(({ id, c }, i) => {
              const r = props.ratings[`${lang}:${id}`];
              return (
                <tr key={id}>
                  <td>{name(i)}</td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      {[1, 2, 3, 4, 5].map((v) => (
                        <button
                          key={v}
                          type="button"
                          className={"btn small " + (r?.rating === v ? "" : "ghost")}
                          aria-pressed={r?.rating === v}
                          disabled={c.status !== "done" || props.saved}
                          onClick={() => props.setRating(id, { rating: v })}
                        >
                          {v}
                        </button>
                      ))}
                    </div>
                  </td>
                  <td>
                    <input
                      type="radio"
                      name={`best-${lang}`}
                      checked={props.best === id}
                      disabled={c.status !== "done" || props.saved}
                      onChange={() => props.setBest(id)}
                      aria-label={`${name(i)} is the best`}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={r?.note ?? ""}
                      disabled={props.saved}
                      onChange={(e) => props.setRating(id, { note: e.target.value })}
                      placeholder="terminology, tone, error…"
                      style={{ width: "100%" }}
                    />
                  </td>
                  {!blind && (
                    <td className="muted small">
                      {meta(i)}
                      {qa(i) && <div>{qa(i)}</div>}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table></div>
      )}
      {allDone && (
        <div className="row">
          <button className="btn" onClick={props.onSave} disabled={props.saved || props.running}>
            {props.saved ? "Saved — systems revealed" : "Save my ratings (and reveal)"}
          </button>
        </div>
      )}
    </section>
  );
}
