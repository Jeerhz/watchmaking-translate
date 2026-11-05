"use client";

import { useMemo, useState } from "react";
import { cost, diffWords, editRate } from "@/lib/client";
import { runQA, summarize, type QACheck } from "@/lib/qa";
import { LANG_NAME, type Change, type Lang, type TermHit } from "@/lib/types";
import { STEP_LABEL, type LangRun, type StepId } from "./run";

const STEPS: StepId[] = ["evidence", "draft", "review", "qa", "fix", "validate"];
type Tab = "text" | "diff" | "changes" | "qa" | "reasoning" | "prompts" | "cost";

function Stepper({ steps }: { steps: LangRun["steps"] }) {
  const icon = { pending: "○", active: "◐", done: "✓", skipped: "–", error: "✕" } as const;
  return (
    <ol className="stepper" aria-label="Pipeline progress">
      {STEPS.map((id) => (
        <li key={id} className={steps[id]}>
          <span aria-hidden>{icon[steps[id]]}</span>
          {STEP_LABEL[id]}
        </li>
      ))}
    </ol>
  );
}

function Changes({ list, empty }: { list: Change[]; empty: string }) {
  if (!list.length) return <p className="muted small">{empty}</p>;
  return (
    <ul className="qa-list" style={{ gap: 8 }}>
      {list.map((c, i) => (
        <li key={i} className="change" style={{ display: "grid", gridTemplateColumns: "1fr" }}>
          <div>
            <del>{c.before}</del> → <ins>{c.after}</ins>
          </div>
          <div className="why">{c.reason}</div>
        </li>
      ))}
    </ul>
  );
}

function QAList({ checks, showOk }: { checks: QACheck[]; showOk: boolean }) {
  const list = showOk ? checks : checks.filter((c) => c.severity !== "ok");
  if (!list.length) return <p className="muted small">No issue flagged.</p>;
  return (
    <ul className="qa-list">
      {list.map((c, i) => (
        <li key={i}>
          <span className={"badge " + c.severity}>{c.severity === "ok" ? "pass" : c.severity}</span>
          <span>
            <span className="muted">{c.kind}</span> · {c.message}
          </span>
        </li>
      ))}
    </ul>
  );
}

function QASummary({ label, checks }: { label: string; checks: QACheck[] }) {
  const s = summarize(checks);
  return (
    <div className="stat">
      <span>{label}</span>
      <b>
        {s.errors} <small className="muted" style={{ fontSize: 12 }}>errors</small> · {s.warnings}{" "}
        <small className="muted" style={{ fontSize: 12 }}>warnings</small>
      </b>
      <span>{s.passed} checks passed</span>
    </div>
  );
}

export default function LangColumn(props: {
  lang: Lang;
  run: LangRun;
  source: string;
  terms: TermHit[];
  swiss: boolean;
  onEdit: (text: string) => void;
  onApprove: (by: string) => void;
  onReopen: () => void;
}) {
  const { lang, run, source, terms, swiss } = props;
  const [tab, setTab] = useState<Tab>("text");
  const [reviewer, setReviewer] = useState("");
  const [showOk, setShowOk] = useState(false);
  const done = run.status === "done";
  const diff = useMemo(() => (done ? diffWords(run.draft, run.edited) : []), [done, run.draft, run.edited]);
  const qaEdited = useMemo(
    () => (done && run.edited !== run.final ? runQA(source, run.edited, lang, terms, swiss) : null),
    [done, run.edited, run.final, source, lang, terms, swiss],
  );
  const usd = cost(run.usage);
  const tabs: [Tab, string, number | null][] = [
    ["text", run.approved ? "Validated text" : "Text", null],
    ["diff", "Draft → final", null],
    ["changes", "Editor changes", run.changes.length + run.fixChanges.length],
    ["qa", "QA report", summarize(run.qaFinal).errors + summarize(run.qaFinal).warnings],
    ["reasoning", "Reasoning", null],
    ["prompts", "Prompts", run.prompts.length],
    ["cost", "Cost", null],
  ];

  return (
    <section className="panel" aria-label={LANG_NAME[lang] + " translation"}>
      <div className="panel-head">
        <h2 style={{ margin: 0, fontSize: "1.25rem" }}>{lang === "en" ? "English" : "Deutsch"}</h2>
        <span className="muted small">
          {run.status === "running" ? run.liveLabel + "…" : done ? `${run.usage.length} model calls · ≈ $${usd.toFixed(2)}` : ""}
        </span>
      </div>
      <Stepper steps={run.steps} />
      {run.error && <div className="notice err">{run.error}</div>}

      <div className="tabs" role="tablist">
        {tabs.map(([id, label, n]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} disabled={!done && id !== "text" && id !== "reasoning" && id !== "prompts"}>
            {label}
            {n !== null && done && <span className="count">{n}</span>}
          </button>
        ))}
      </div>

      {tab === "text" &&
        (!done ? (
          <>
            <div className={"output" + (run.live ? "" : " placeholder")} lang={lang}>
              {run.live || (run.status === "running" ? "Waiting for the first words…" : "The translation appears here.")}
            </div>
            {run.status === "running" && run.thinking && (
              <details open>
                <summary>Model reasoning (summary, live)</summary>
                <div className="thinking">{run.thinking.slice(-1500)}</div>
              </details>
            )}
          </>
        ) : run.approved ? (
          <>
            <div className="validated">
              ✓ Validated by <b>{run.approved.by}</b> on {new Date(run.approved.at).toLocaleString()}
              {run.approved.edited ? " — with manual edits" : " — accepted as delivered"}
            </div>
            <div className="output" lang={lang}>
              {run.edited}
            </div>
            <div className="row">
              <button className="btn ghost small" onClick={props.onReopen}>
                Re-open for editing
              </button>
              <CopyButton text={run.edited} />
            </div>
          </>
        ) : (
          <>
            <p className="muted small" style={{ margin: 0 }}>
              Final text after review{run.fixChanges.length ? " and correction" : ""}. Edit it directly, then validate.
            </p>
            <textarea className="final" lang={lang} value={run.edited} onChange={(e) => props.onEdit(e.target.value)} aria-label={`${LANG_NAME[lang]} final text`} />
            {qaEdited && (
              <div className="small">
                <span className="label">QA on your edits</span> <QAInline checks={qaEdited} />
              </div>
            )}
            <div className="row">
              <input
                placeholder="Your name"
                value={reviewer}
                onChange={(e) => setReviewer(e.target.value)}
                style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--panel-2)" }}
                aria-label="Reviewer name"
              />
              <button className="btn ok" disabled={!reviewer.trim()} onClick={() => props.onApprove(reviewer.trim())}>
                Validate translation
              </button>
              {run.edited !== run.final && (
                <button className="btn ghost small" onClick={() => props.onEdit(run.final)}>
                  Undo my edits
                </button>
              )}
              <CopyButton text={run.edited} />
            </div>
          </>
        ))}

      {tab === "diff" && done && (
        <>
          <p className="muted small" style={{ margin: 0 }}>
            Translator draft against the {run.edited !== run.final ? "edited" : "final"} text: {Math.round(editRate(diff) * 100)}% of the draft’s words
            changed.
          </p>
          <div className="diff" lang={lang}>
            {diff.map((p, i) => (p.op === "=" ? <span key={i}>{p.text}</span> : p.op === "-" ? <del key={i}>{p.text}</del> : <ins key={i}>{p.text}</ins>))}
          </div>
        </>
      )}

      {tab === "changes" && done && (
        <>
          <div className="label">Editorial review — {run.changes.length} change(s)</div>
          <Changes list={run.changes} empty="The editor kept the draft as it was." />
          {run.steps.fix === "done" && (
            <>
              <div className="label">Correction after QA — {run.fixChanges.length} change(s)</div>
              <Changes list={run.fixChanges} empty="No change: every QA flag was judged a false alarm." />
            </>
          )}
        </>
      )}

      {tab === "qa" && done && (
        <>
          <div className="stats">
            <QASummary label="Translator draft" checks={run.qaDraft} />
            <QASummary label="After review" checks={run.qaReviewed} />
            <QASummary label="Final" checks={run.qaFinal} />
          </div>
          {run.verdicts.length > 0 && (
            <>
              <div className="label">Editor’s ruling on each QA flag</div>
              <ul className="qa-list">
                {run.verdicts.map((v, i) => (
                  <li key={i}>
                    <span className={"badge " + (v.action === "fixed" ? "ok" : "info")}>{v.action}</span>
                    <span>
                      {v.check}
                      <br />
                      <span className="muted small">{v.reason}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="panel-head">
            <div className="label">Checks on the final text</div>
            <label className="check small">
              <input type="checkbox" checked={showOk} onChange={(e) => setShowOk(e.target.checked)} /> show passed checks
            </label>
          </div>
          <QAList checks={run.qaFinal} showOk={showOk} />
        </>
      )}

      {tab === "reasoning" && (
        <div className="thinking" style={{ maxHeight: 420 }}>
          {run.thinking || "The model’s reasoning summary for the current step appears here while it works."}
        </div>
      )}

      {tab === "prompts" &&
        (run.prompts.length ? (
          run.prompts.map((p, i) => (
            <details key={i}>
              <summary>
                {p.title} — {(p.system.length + p.user.length).toLocaleString()} characters
              </summary>
              <pre>{p.system + "\n\n────────── user ──────────\n\n" + p.user}</pre>
            </details>
          ))
        ) : (
          <p className="muted small">The exact prompts sent to Claude appear here.</p>
        ))}

      {tab === "cost" && done && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Call</th>
                <th className="num">Input</th>
                <th className="num">Cached</th>
                <th className="num">Output</th>
                <th className="num">Time</th>
              </tr>
            </thead>
            <tbody>
              {run.usage.map((u, i) => (
                <tr key={i}>
                  <td>{run.prompts[i]?.title.replace(" prompt", "") ?? i + 1}</td>
                  <td className="num">{(u.input + u.cacheWrite).toLocaleString()}</td>
                  <td className="num">{u.cacheRead.toLocaleString()}</td>
                  <td className="num">{u.output.toLocaleString()}</td>
                  <td className="num">{(u.ms / 1000).toFixed(0)} s</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">
            Model {run.usage[0]?.model}. Estimated at list price ($4 / $20 per million input / output tokens): ≈ ${usd.toFixed(3)}. Output includes the
            model’s reasoning tokens.
          </p>
        </div>
      )}
    </section>
  );
}

function QAInline({ checks }: { checks: QACheck[] }) {
  const s = summarize(checks);
  return (
    <span>
      <span className={"badge " + (s.errors ? "error" : "ok")}>{s.errors} errors</span>{" "}
      <span className={"badge " + (s.warnings ? "warn" : "ok")}>{s.warnings} warnings</span>{" "}
      {checks
        .filter((c) => c.severity !== "ok")
        .slice(0, 3)
        .map((c, i) => (
          <span key={i} className="muted">
            · {c.message}{" "}
          </span>
        ))}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn ghost small"
      onClick={async () => {
        await navigator.clipboard.writeText(text).catch(() => undefined);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
