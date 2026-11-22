"use client";

// Blind side-by-side comparison of systems — and of one system with a component switched off —
// on the same French text. Raters mark error spans (minor / major) and give a 0–100 score
// (Error Span Annotation, WMT 2024); judgments go to the shared store and feed the scoreboard.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CANDIDATES, type Candidate, type Judgment, type Span } from "@/lib/candidates";
import { cost, pruneTerms, rememberedName, rememberName, saveEvent } from "@/lib/client";
import { runQA, summarize } from "@/lib/qa";
import { splitParagraphs } from "@/lib/textnorm";
import type { Analysis, Effort, Lang, TermHit } from "@/lib/types";
import { marked, paragraphOffsets, type Mark } from "./marks";
import { emptyRun, runLanguage, type LangRun } from "./run";

const BY_ID = Object.fromEntries(CANDIDATES.map((c) => [c.id, c])) as Record<string, Candidate>;
const LANG_TITLE: Record<Lang, string> = { en: "English", de: "Deutsch" };
const LOCAL = "gmt-judgments-unsent";
const LANGS: Lang[] = ["en", "de"];

interface Sample {
  id: string;
  title: string;
  fr: string;
  en: string;
  de: string;
}

interface Rating {
  score: number | null;
  spans: Span[];
  note: string;
}
const NO_RATING: Rating = { score: null, spans: [], note: "" };

const letter = (i: number) => String.fromCharCode(65 + i);

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Run tasks a few at a time: many Claude pipelines at once hit the API's rate limit. */
async function pool(tasks: (() => Promise<void>)[], size: number): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, tasks.length) }, async () => {
      while (next < tasks.length) await tasks[next++]().catch(() => undefined);
    }),
  );
}

export default function Compare() {
  const [text, setText] = useState("");
  const [samples, setSamples] = useState<Sample[]>([]);
  const [sample, setSample] = useState<Sample | null>(null);
  const [langs, setLangs] = useState<Record<Lang, boolean>>({ en: true, de: true });
  const [chosen, setChosen] = useState<Record<string, boolean>>({ claude: true, "deepl-claude": true, deepl: true, gmt: true });
  const [effort, setEffort] = useState<Effort>("high");
  const [swiss, setSwiss] = useState(true);
  const [blind, setBlind] = useState(true);
  const [rater, setRater] = useState("");
  const [have, setHave] = useState<{ deepl: boolean; open: boolean }>({ deepl: false, open: false });

  const [runSrc, setRunSrc] = useState<{ text: string; sample: Sample | null; langs: Lang[]; terms: TermHit[] } | null>(null);
  const [order, setOrder] = useState<Record<Lang, string[]>>({ en: [], de: [] });
  const [runs, setRuns] = useState<Record<string, LangRun>>({});
  const [ratings, setRatings] = useState<Record<string, Rating>>({});
  const [best, setBest] = useState<Record<Lang, string | null>>({ en: null, de: null });
  const [revealed, setRevealed] = useState<Record<Lang, boolean>>({ en: false, de: false });
  const [saved, setSaved] = useState<Record<Lang, "shared" | "local" | null>>({ en: null, de: null });
  const [running, setRunning] = useState(false);
  const ctl = useRef<AbortController | null>(null);

  useEffect(() => {
    // scripted evaluations drive the same pipeline code from the browser console
    (window as unknown as { gmtDesk?: object }).gmtDesk = { runLanguage, emptyRun, pruneTerms };
    setRater(rememberedName());
    try {
      const sent = localStorage.getItem("gmt-compare-text");
      if (sent?.trim()) setText(sent);
      localStorage.removeItem("gmt-compare-text");
    } catch {}
    const json = (r: Response) => (r.ok ? r.json() : null);
    fetch("/api/samples")
      .then((r) => (r.ok ? r.json() : []))
      .then(setSamples)
      .catch(() => undefined);
    Promise.all([fetch("/api/deepl").then(json), fetch("/api/open-mt").then(json)])
      .then(([d, o]) => setHave({ deepl: Boolean(d?.configured), open: Boolean(o?.configured) }))
      .catch(() => undefined);
  }, []);

  const usable = (c: Candidate) =>
    c.needs === "sample" ? Boolean(sample && text.trim() === sample.fr.trim()) : c.needs === "deepl" ? have.deepl : c.needs === "open" ? have.open : true;
  const picked = CANDIDATES.filter((c) => chosen[c.id] && usable(c));

  function pickSample(s: Sample | null) {
    setSample(s);
    if (s) setText(s.fr);
  }

  async function run() {
    const src = text.trim();
    const ls = LANGS.filter((l) => langs[l]);
    if (!src || !ls.length || !picked.length) return;
    const res = await fetch("/api/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: src }) });
    if (res.status === 401) {
      window.location.assign("/login?next=/compare");
      return;
    }
    const analysis = (await res.json()) as Analysis;
    const smp = sample && src === sample.fr.trim() ? sample : null;
    ctl.current = new AbortController();
    const signal = ctl.current.signal;
    setRunning(true);
    setRuns({});
    setRatings({});
    setBest({ en: null, de: null });
    setRevealed({ en: false, de: false });
    setSaved({ en: null, de: null });
    setOrder({ en: shuffle(picked.map((c) => c.id)), de: shuffle(picked.map((c) => c.id)) });

    // one pruning call serves every Claude-edited candidate
    let gone = new Set<string>();
    let sharedUsd = 0;
    const edited = picked.filter((c) => c.system && c.system !== "deepl" && c.system !== "open");
    if (edited.some((c) => !c.noPrune) && analysis.terms.length) {
      try {
        const pr = await pruneTerms(src, signal);
        gone = new Set(pr.drop.map((d) => d.key));
        sharedUsd = pr.usage ? cost([pr.usage]) / (ls.length * edited.length) : 0;
      } catch {
        setRunning(false);
        return;
      }
    }
    const terms = analysis.terms.filter((h) => !gone.has(h.key));
    setRunSrc({ text: src, sample: smp, langs: ls, terms });

    const patch = (k: string) => (fn: (r: LangRun) => LangRun) => setRuns((m) => ({ ...m, [k]: fn(m[k] ?? emptyRun()) }));
    const tasks: (() => Promise<void>)[] = [];
    const gpu: (() => Promise<void>)[] = []; // the fine-tuned model: one GPU, one job at a time
    for (const lang of ls) {
      for (const c of picked) {
        const k = `${lang}:${c.id}`;
        if (c.id === "gmt") {
          if (smp) setRuns((m) => ({ ...m, [k]: { ...emptyRun(), status: "done", final: smp[lang], edited: smp[lang], live: smp[lang] } }));
          continue;
        }
        const job = () =>
          runLanguage({
            lang,
            text: src,
            terms: c.noPrune ? analysis.terms : terms,
            dropTerms: c.noPrune ? [] : [...gone],
            effort,
            swiss,
            signal,
            patch: patch(k),
            system: c.system,
            variant: c.variant,
            variantId: c.id === c.system ? null : c.id,
            origin: "compare",
            sharedUsd: c.system === "deepl" || c.system === "open" || c.noPrune ? 0 : sharedUsd,
          });
        (c.system === "open" ? gpu : tasks).push(job);
      }
    }
    await Promise.all([
      pool(tasks, 4),
      (async () => {
        for (const job of gpu) await job().catch(() => undefined);
      })(),
    ]);
    ctl.current = null;
    setRunning(false);
  }

  async function save(lang: Lang) {
    if (!runSrc || !rater.trim()) return;
    rememberName(rater);
    const j: Judgment = {
      rater: rater.trim(),
      sample: runSrc.sample?.id ?? null,
      lang,
      blind,
      source: runSrc.text,
      best: best[lang],
      candidates: order[lang].map((id, i) => {
        const r = ratings[`${lang}:${id}`] ?? NO_RATING;
        return { label: letter(i), system: id, text: runs[`${lang}:${id}`]?.final ?? "", score: r.score, spans: r.spans, note: r.note };
      }),
    };
    const ok = await saveEvent("judgment", { ...j, effort, swiss });
    if (!ok) {
      try {
        localStorage.setItem(LOCAL, JSON.stringify([...(JSON.parse(localStorage.getItem(LOCAL) ?? "[]") as Judgment[]), j]));
      } catch {}
    }
    setSaved((s) => ({ ...s, [lang]: ok ? "shared" : "local" }));
    setRevealed((r) => ({ ...r, [lang]: true }));
  }

  const groups: [string, Candidate[]][] = [
    ["Systems", CANDIDATES.filter((c) => c.group !== "component")],
    ["One component switched off", CANDIDATES.filter((c) => c.group === "component")],
  ];

  return (
    <main className="page" style={{ display: "grid", gap: 20 }}>
      <h1 className="page-title">Compare systems, blind</h1>
      <section className="panel" style={{ display: "grid", gap: 12 }}>
        <div className="panel-head">
          <span className="label">French text</span>
          <div className="row" style={{ gap: 6 }}>
            {samples.length > 0 && (
              <>
                <select value={sample?.id ?? ""} onChange={(e) => pickSample(samples.find((s) => s.id === e.target.value) ?? null)} disabled={running} aria-label="GMT Magazine sample">
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
          style={{ minHeight: 130 }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste French copy, or load a GMT Magazine sample: GMT’s own translation then joins the comparison, hidden among the systems."
          aria-label="French source text"
        />
        {groups.map(([title, list], g) => (
          <div key={title} className="row" style={{ gap: "6px 16px" }}>
            <span className="label" style={{ minWidth: 190 }}>
              {title}
            </span>
            {list.map((c) => (
              <label key={c.id} className="check" title={c.help} style={{ opacity: usable(c) ? 1 : 0.45 }}>
                <input type="checkbox" checked={Boolean(chosen[c.id]) && usable(c)} disabled={running || !usable(c)} onChange={(e) => setChosen((x) => ({ ...x, [c.id]: e.target.checked }))} />{" "}
                {g === 1 ? c.label.replace(/^Claude \+ editor, /, "").replace(/^Claude, /, "").replace(/^Claude \+ previous/, "previous") : c.label}
              </label>
            ))}
          </div>
        ))}
        <div className="row" style={{ gap: "6px 16px" }}>
          {LANGS.map((l) => (
            <label key={l} className="check">
              <input type="checkbox" checked={langs[l]} disabled={running} onChange={(e) => setLangs((x) => ({ ...x, [l]: e.target.checked }))} /> {LANG_TITLE[l]}
            </label>
          ))}
          <label className="check">
            <input type="checkbox" checked={swiss} disabled={running} onChange={(e) => setSwiss(e.target.checked)} /> Swiss German
          </label>
          <div className="seg" role="group" aria-label="Quality">
            <button type="button" aria-pressed={effort === "high"} disabled={running} onClick={() => setEffort("high")}>
              Quick draft
            </button>
            <button type="button" aria-pressed={effort === "xhigh"} disabled={running} onClick={() => setEffort("xhigh")}>
              Publication
            </button>
          </div>
          <label className="check" title="Shuffle the candidates and hide which system wrote what until you save">
            <input type="checkbox" checked={blind} disabled={running} onChange={(e) => setBlind(e.target.checked)} /> Blind
          </label>
        </div>
        <div className="row">
          <button className="btn" onClick={run} disabled={running || !text.trim() || !picked.length}>
            Run {picked.length} candidate{picked.length === 1 ? "" : "s"}
          </button>
          {running && (
            <button className="btn ghost" onClick={() => ctl.current?.abort()}>
              Stop
            </button>
          )}
          <span style={{ flex: 1 }} />
          <Link href="/scoreboard" className="small">
            Scoreboard: everyone’s ratings →
          </Link>
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
            run={(id) => runs[`${lang}:${id}`] ?? emptyRun()}
            blind={blind && !revealed[lang]}
            rating={(id) => ratings[`${lang}:${id}`] ?? NO_RATING}
            setRating={(id, fn) => setRatings((r) => ({ ...r, [`${lang}:${id}`]: fn(r[`${lang}:${id}`] ?? NO_RATING) }))}
            best={best[lang]}
            setBest={(id) => setBest((b) => ({ ...b, [lang]: id }))}
            saved={saved[lang]}
            onSave={() => save(lang)}
            onReveal={() => setRevealed((r) => ({ ...r, [lang]: !r[lang] }))}
            running={running}
            rater={rater}
            setRater={setRater}
          />
        ))}
    </main>
  );
}

function LangCompare(props: {
  lang: Lang;
  source: string;
  terms: TermHit[];
  swiss: boolean;
  order: string[];
  run: (id: string) => LangRun;
  blind: boolean;
  rating: (id: string) => Rating;
  setRating: (id: string, fn: (r: Rating) => Rating) => void;
  best: string | null;
  setBest: (id: string) => void;
  saved: "shared" | "local" | null;
  onSave: () => void;
  onReveal: () => void;
  running: boolean;
  rater: string;
  setRater: (v: string) => void;
}) {
  const { lang, source, order, blind } = props;
  const [pending, setPending] = useState<{ id: string; start: number; end: number; text: string } | null>(null);
  const cands = order.map((id) => ({ id, r: props.run(id) }));
  const srcParas = splitParagraphs(source);
  const allDone = cands.every(({ r }) => r.status !== "running" && r.status !== "idle");
  const textOf = (r: LangRun) => (r.status === "done" ? r.final : r.live);
  const paras = cands.map(({ r }) => splitParagraphs(textOf(r)));
  const offs = cands.map(({ r }, i) => paragraphOffsets(textOf(r), paras[i]));
  const aligned = allDone && srcParas.length > 1 && paras.every((p, i) => cands[i].r.status !== "done" || p.length === srcParas.length);
  const name = (i: number) => (blind ? `Candidate ${letter(i)}` : `${letter(i)} · ${BY_ID[order[i]]?.label ?? order[i]}`);
  const locked = props.saved !== null;

  /** Turn the browser's selection inside one candidate's text into offsets in that text. */
  function onSelect() {
    if (locked) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return setPending(null);
    const range = sel.getRangeAt(0);
    const box = (n: Node | null) => (n instanceof Element ? n : n?.parentElement)?.closest<HTMLElement>("[data-cand]") ?? null;
    const el = box(range.startContainer);
    if (!el || el !== box(range.endContainer)) return setPending(null);
    const before = document.createRange();
    before.selectNodeContents(el);
    before.setEnd(range.startContainer, range.startOffset);
    const start = Number(el.dataset.off) + before.toString().length;
    const picked = range.toString();
    if (!picked.trim()) return setPending(null);
    setPending({ id: el.dataset.cand!, start, end: start + picked.length, text: picked });
  }

  function mark(severity: Span["severity"]) {
    if (!pending) return;
    const span: Span = { start: pending.start, end: pending.end, text: pending.text, severity };
    props.setRating(pending.id, (r) => ({ ...r, spans: [...r.spans.filter((s) => s.end <= span.start || s.start >= span.end), span].sort((a, b) => a.start - b.start) }));
    setPending(null);
    window.getSelection()?.removeAllRanges();
  }

  const grid = { display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" } as const;
  const card = (i: number, body: string, from: number) => {
    const { id, r } = cands[i];
    const marks: Mark[] = props.rating(id).spans.map((s) => ({
      s: s.start,
      e: s.end,
      cls: "err-span " + s.severity,
      title: `${s.severity} error — click to remove`,
      onClick: locked ? undefined : () => props.setRating(id, (x) => ({ ...x, spans: x.spans.filter((y) => y !== s) })),
    }));
    return (
      <div key={id} className="cand" lang={lang}>
        <div className="label" style={{ marginBottom: 6 }}>
          {name(i)}
          {r.status === "running" && <span className="muted"> — {r.liveLabel || "translating"}…</span>}
        </div>
        {r.error ? (
          <div className="notice err">{r.error}</div>
        ) : (
          <div className="cand-text" data-cand={r.status === "done" ? id : undefined} data-off={from}>
            {body ? marked(body, marks, from) : <span className="muted">…</span>}
          </div>
        )}
        {pending?.id === id && pending.start >= from && pending.start < from + Math.max(body.length, 1) && (
          <div className="row mark-bar">
            <span className="small muted">Mark the selection as an error:</span>
            <button className="btn small ghost" onClick={() => mark("minor")}>
              Minor
            </button>
            <button className="btn small ghost" onClick={() => mark("major")}>
              Major
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="panel" style={{ display: "grid", gap: 14 }} aria-label={`${LANG_TITLE[lang]} comparison`}>
      <div className="panel-head">
        <h2 style={{ margin: 0, fontSize: "1.25rem" }}>{LANG_TITLE[lang]}</h2>
        <button className="btn ghost small" onClick={props.onReveal} disabled={!allDone}>
          {blind ? "Reveal the systems" : "Hide the names"}
        </button>
      </div>
      {allDone && !locked && (
        <p className="muted small" style={{ margin: 0 }}>
          Select any wording that is wrong and mark it <b>minor</b> (polish) or <b>major</b> (a reader would notice: wrong term, wrong meaning, unnatural sentence). Then score each
          candidate and save.
        </p>
      )}

      <div onMouseUp={onSelect} onKeyUp={onSelect} style={{ display: "grid", gap: 14 }}>
        {aligned ? (
          srcParas.map((p, k) => (
            <div key={k} style={{ display: "grid", gap: 8 }}>
              <div className="muted small src-quote" lang="fr">
                {p}
              </div>
              <div style={grid}>{cands.map((_, i) => card(i, paras[i][k] ?? "", offs[i][k] ?? 0))}</div>
            </div>
          ))
        ) : (
          <>
            {allDone && (
              <div className="muted small src-quote" lang="fr" style={{ whiteSpace: "pre-wrap" }}>
                {source}
              </div>
            )}
            <div style={grid}>{cands.map(({ r }, i) => card(i, textOf(r), 0))}</div>
          </>
        )}
      </div>

      {allDone && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Candidate</th>
                <th>Errors marked</th>
                <th style={{ minWidth: 240 }}>Score: 0 unusable · 50 needs real editing · 100 publishable as is</th>
                <th>Best</th>
                <th>Note</th>
                {!blind && <th>Run</th>}
              </tr>
            </thead>
            <tbody>
              {cands.map(({ id, r }, i) => {
                const rt = props.rating(id);
                const ok = r.status === "done";
                const major = rt.spans.filter((s) => s.severity === "major").length;
                const qa = ok && id !== "gmt" ? summarize(runQA(source, r.final, lang, props.terms, props.swiss)) : null;
                return (
                  <tr key={id}>
                    <td>{name(i)}</td>
                    <td className="small">
                      {major} major · {rt.spans.length - major} minor
                    </td>
                    <td>
                      <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={5}
                          value={rt.score ?? 50}
                          disabled={!ok || locked}
                          onChange={(e) => props.setRating(id, (x) => ({ ...x, score: Number(e.target.value) }))}
                          aria-label={`Score for ${name(i)}`}
                          style={{ flex: 1, opacity: rt.score === null ? 0.45 : 1 }}
                        />
                        <b className="num" style={{ width: 34 }}>
                          {rt.score ?? "—"}
                        </b>
                      </div>
                    </td>
                    <td>
                      <input type="radio" name={`best-${lang}`} checked={props.best === id} disabled={!ok || locked} onChange={() => props.setBest(id)} aria-label={`${name(i)} is the best`} />
                    </td>
                    <td>
                      <input type="text" value={rt.note} disabled={locked} onChange={(e) => props.setRating(id, (x) => ({ ...x, note: e.target.value }))} placeholder="optional" style={{ width: "100%" }} />
                    </td>
                    {!blind && (
                      <td className="muted small">
                        {r.trace ? `${Math.round(r.trace.ms / 1000)} s · $${r.trace.usd.toFixed(3)}${r.trace.deeplChars ? ` · DeepL ${r.trace.deeplChars} chars` : ""}` : "—"}
                        {r.trace && r.trace.calls > 1 && (
                          <div>
                            {r.trace.diagnosed} diagnosed · {r.trace.applied} repaired
                          </div>
                        )}
                        {qa && (
                          <div>
                            QA: {qa.errors} errors · {qa.warnings} warnings
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {allDone && (
        <div className="row">
          {!locked && <input className="name" placeholder="Your name" value={props.rater} onChange={(e) => props.setRater(e.target.value)} aria-label="Your name" />}
          <button className="btn" onClick={props.onSave} disabled={locked || props.running || !props.rater.trim() || !cands.some(({ id }) => props.rating(id).score !== null)}>
            {locked ? "Saved — systems revealed" : "Save my judgment (and reveal)"}
          </button>
          {props.saved === "shared" && <span className="small muted">Added to the shared scoreboard.</span>}
          {props.saved === "local" && <span className="small muted">The shared store is unavailable: kept in this browser only.</span>}
        </div>
      )}
    </section>
  );
}
