"use client";

// Which system, and which component, works better — from the editors' blind ratings, from what
// every run leaves behind, and from how much editors still change before validating.

import { useEffect, useState } from "react";
import type { ComponentRow, Scoreboard as Data, StageRow, SystemRow, ValidationRow } from "@/lib/server/scoreboard";
import { CATEGORIES, pairName } from "@/lib/types";

const ENOUGH = 30; // judgments per direction before a difference is worth acting on
const f = (v: number | null, d = 1) => (v === null ? "—" : v.toFixed(d));
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(0)} %`);

/** Rows grouped by direction ("fr>en"), French sources first. */
function byLang<T extends { lang: string }>(rows: T[]): [string, T[]][] {
  const pairs = [...new Set(rows.map((r) => r.lang))].sort((a, b) => (a.startsWith("fr") ? 0 : 1) - (b.startsWith("fr") ? 0 : 1) || a.localeCompare(b));
  return pairs.map((l) => [l, rows.filter((r) => r.lang === l)] as [string, T[]]);
}

export default function Scoreboard() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/scoreboard")
      .then(async (r) => {
        if (r.status === 401) return window.location.assign("/login?next=/scoreboard");
        if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`);
        setData((await r.json()) as Data);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) {
    return (
      <main className="page prose-page">
        <h1 className="page-title">Scoreboard</h1>
        <div className="notice err">The shared store could not be read: {error}.</div>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="page prose-page">
        <h1 className="page-title">Scoreboard</h1>
        <p className="muted">Loading…</p>
      </main>
    );
  }
  const c = data.counts;
  return (
    <main className="page" style={{ maxWidth: 1180 }}>
      <div>
        <h1 className="page-title">Scoreboard</h1>
        <p className="lede">
          {c.judgments} blind judgment{c.judgments === 1 ? "" : "s"} · {c.validations} validated text{c.validations === 1 ? "" : "s"} · {c.runs} run{c.runs === 1 ? "" : "s"}
          {c.raters.length ? ` · from ${c.raters.join(", ")}` : ""}
        </p>
      </div>

      <section className="panel">
        <h2 style={{ marginTop: 0 }}>Systems, as rated blind</h2>
        <p className="muted small" style={{ margin: 0 }}>
          From the Compare page: a 0–100 score per candidate and the error spans raters marked. Under {ENOUGH} judgments per direction, read the order as a first impression, not
          a result.
        </p>
        {data.systems.length ? byLang(data.systems).map(([l, rows]) => <Systems key={l} lang={l} rows={rows} />) : <Empty what="No judgment saved yet. Rate a comparison on the Compare page." />}
      </section>

      <section className="panel">
        <h2 style={{ marginTop: 0 }}>What each component adds</h2>
        <p className="muted small" style={{ margin: 0 }}>
          The same rater scoring the same passage with and without the component (tick the “one component switched off” candidates on the Compare page). A positive difference
          means the component helps.
        </p>
        <Components rows={data.components} />
      </section>

      <section className="panel">
        <h2 style={{ marginTop: 0 }}>What each stage does</h2>
        <p className="muted small" style={{ margin: 0 }}>
          Recorded by every run, on the Translator and on Compare: numbers only, no text. QA flags are the automatic checks (terms, figures, typography) per 1,000 source words.
        </p>
        {data.stages.length ? byLang(data.stages).map(([l, rows]) => <Stages key={l} lang={l} rows={rows} />) : <Empty what="No run recorded yet." />}
      </section>

      <section className="panel">
        <h2 style={{ marginTop: 0 }}>Editing effort before validation</h2>
        <p className="muted small" style={{ margin: 0 }}>
          The share of words the editor changed between the system’s text and the validated one. This is the number that says how much work a system saves.
        </p>
        {data.validations.length ? <Validations rows={data.validations} /> : <Empty what="No text validated yet. Validate a translation on the Translator page." />}
      </section>

      <section className="panel">
        <h2 style={{ marginTop: 0 }}>Data</h2>
        <p className="small" style={{ margin: 0 }}>
          Every validated text is kept with its source, the system’s draft and final, and the editor’s version: a growing test set and training set in GMT’s current style.
        </p>
        <div className="row">
          <a className="btn ghost small" href="/api/store?kind=validation&format=jsonl">
            Validated texts (.jsonl)
          </a>
          <a className="btn ghost small" href="/api/store?kind=judgment&format=jsonl">
            Judgments (.jsonl)
          </a>
          <a className="btn ghost small" href="/api/store?kind=run&format=jsonl">
            Run statistics (.jsonl)
          </a>
        </div>
      </section>
    </main>
  );
}

function Empty({ what }: { what: string }) {
  return <p className="muted small">{what}</p>;
}

function Few({ n }: { n: number }) {
  return n < ENOUGH ? <span className="badge info" title={`Fewer than ${ENOUGH} judgments`}>few</span> : null;
}

function Systems({ lang, rows }: { lang: string; rows: SystemRow[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{pairName(lang)}</th>
            <th className="num">Judged</th>
            <th className="num">Mean score (0–100)</th>
            <th className="num">Chosen best</th>
            <th className="num">Major errors / 1,000 words</th>
            <th className="num">Minor / 1,000 words</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.label}</td>
              <td className="num">
                {r.judged} <Few n={r.judged} />
              </td>
              <td className="num">
                <b>{f(r.score)}</b>
              </td>
              <td className="num">
                {r.best} of {r.seen}
              </td>
              <td className="num">{f(r.majorPer1k)}</td>
              <td className="num">{f(r.minorPer1k)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Components({ rows }: { rows: ComponentRow[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Component</th>
            <th>Compared</th>
            <th className="num">Pairs</th>
            <th className="num">Score with</th>
            <th className="num">Score without</th>
            <th className="num">Difference</th>
            <th className="num">Better / worse</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.component}>
              <td>{r.component}</td>
              <td className="muted small">
                {r.with} vs {r.without}
              </td>
              <td className="num">
                {r.n} {r.n > 0 && <Few n={r.n} />}
              </td>
              <td className="num">{f(r.scoreWith)}</td>
              <td className="num">{f(r.scoreWithout)}</td>
              <td className="num">
                <b>{r.delta === null ? "not tested yet" : (r.delta > 0 ? "+" : "") + r.delta.toFixed(1)}</b>
              </td>
              <td className="num">{r.n ? `${r.better} / ${r.worse}` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stages({ lang, rows }: { lang: string; rows: StageRow[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{pairName(lang)}</th>
            <th className="num">Runs</th>
            <th className="num">QA flags / 1,000 w: draft → final</th>
            <th className="num">Errors diagnosed / 1,000 w</th>
            <th>By kind</th>
            <th className="num">Edits applied / refused</th>
            <th className="num">Words the editor changed</th>
            <th className="num">$ / 1,000 w</th>
            <th className="num">s / 1,000 w</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.system}>
              <td>{r.label}</td>
              <td className="num">{r.runs}</td>
              <td className="num">
                {f(r.qaDraftPer1k)} → {f(r.qaFinalPer1k)}
              </td>
              <td className="num">{f(r.diagnosedPer1k)}</td>
              <td className="small muted">
                {CATEGORIES.filter((k) => r.byCategory[k])
                  .map((k) => `${r.byCategory[k]} ${k}`)
                  .join(" · ") || "—"}
              </td>
              <td className="num">{r.editorShare === null ? "—" : `${r.applied} / ${r.rejected}`}</td>
              <td className="num">{pct(r.editorShare)}</td>
              <td className="num">{f(r.usdPer1k, 2)}</td>
              <td className="num">{f(r.secPer1k, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Validations({ rows }: { rows: ValidationRow[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>System</th>
            <th>Direction</th>
            <th className="num">Validated texts</th>
            <th className="num">Words</th>
            <th className="num">Words changed by the editor</th>
            <th className="num">Accepted untouched</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.system + r.lang}>
              <td>{r.label}</td>
              <td>{pairName(r.lang)}</td>
              <td className="num">{r.n}</td>
              <td className="num">{r.words.toLocaleString("en")}</td>
              <td className="num">
                <b>{pct(r.humanShare)}</b>
              </td>
              <td className="num">
                {r.untouched} of {r.n}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
