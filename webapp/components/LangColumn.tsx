"use client";

// One language of a run: progress, what each stage did, validation, and the two things an
// editor checks (changes, QA). Reasoning, prompts and cost sit in a closed "Inspect" drawer.

import { useEffect, useMemo, useState } from "react";
import { cost, diffWords, editRate, rememberedName, rememberName, saveEvent } from "@/lib/client";
import { runQA, summarize, type QACheck } from "@/lib/qa";
import { LANG_NAME, langLabel, pairOf, type Change, type Lang, type Src, type TermHit } from "@/lib/types";
import StageTrace from "./StageTrace";
import { STEP_LABEL, SYSTEM_LABEL, type LangRun, type StepId } from "./run";

const STEPS: StepId[] = ["evidence", "draft", "diagnose", "repair", "qa", "validate"];
type Tab = "changes" | "qa";

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

function Changes({ list }: { list: Change[] }) {
  return (
    <ul className="qa-list" style={{ gap: 8 }}>
      {list.map((c, i) => (
        <li key={i} className="change" style={{ display: "grid", gridTemplateColumns: "1fr", opacity: c.rejected ? 0.7 : 1 }}>
          <div>
            {c.type && <span className={"badge " + (c.severity === "minor" ? "info" : c.severity === "major" ? "warn" : "error")}>{c.type}{c.severity ? ` · ${c.severity}` : ""}</span>}{" "}
            <del>{c.before}</del> → <ins>{c.after}</ins>
          </div>
          <div className="why">{c.reason}</div>
          {c.rejected && <div className="why">Not applied: {c.rejected}.</div>}
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

export default function LangColumn(props: {
  lang: Lang;
  src: Src;
  run: LangRun;
  source: string;
  terms: TermHit[];
  swiss: boolean;
  effort: string;
  editing: boolean;
  onEditing: (on: boolean) => void;
  onEdit: (text: string) => void;
  onApprove: (by: string) => void;
  onReopen: () => void;
}) {
  const { lang, run, source, terms, swiss, src } = props;
  const [tab, setTab] = useState<Tab>("changes");
  const [reviewer, setReviewer] = useState("");
  const [showOk, setShowOk] = useState(false);
  const [copied, setCopied] = useState(false);
  const [stored, setStored] = useState<boolean | null>(null);
  useEffect(() => setReviewer(rememberedName()), []);

  const done = run.status === "done";
  const touched = done && run.edited !== run.final;
  const humanShare = useMemo(() => (done ? editRate(diffWords(run.final, run.edited)) : null), [done, run.final, run.edited]);
  const draftDiff = useMemo(() => (done ? diffWords(run.draft, run.edited) : []), [done, run.draft, run.edited]);
  const qaNow = useMemo(() => (touched ? runQA(source, run.edited, lang, terms, swiss, src) : run.qaFinal), [touched, run.edited, run.qaFinal, source, lang, terms, swiss, src]);
  const qa = summarize(qaNow);
  const applied = run.changes.filter((c) => !c.rejected);
  const refused = run.changes.filter((c) => c.rejected);
  const unrepaired = run.errors.filter((e) => !run.changes.some((c) => !c.rejected && c.before && (e.span.includes(c.before) || c.before.includes(e.span))));
  const usd = cost(run.usage);

  async function validate() {
    const by = reviewer.trim();
    if (!by || !run.trace) return;
    rememberName(by);
    props.onApprove(by);
    props.onEditing(false);
    setStored(
      await saveEvent("validation", {
        reviewer: by,
        lang,
        src,
        pair: pairOf(src, lang),
        system: run.system,
        effort: props.effort,
        swiss,
        source,
        draft: run.draft,
        final: run.final,
        validated: run.edited,
        words: run.trace.words,
        humanShare: humanShare ?? 0,
        editorShare: run.trace.editorShare,
        qaFlags: qa.errors + qa.warnings,
      }),
    );
  }

  return (
    <section className="panel" aria-label={LANG_NAME[lang] + " translation"}>
      <div className="panel-head">
        <h2 style={{ margin: 0, fontSize: "1.25rem" }}>{langLabel(lang, swiss)}</h2>
        <span className="muted small">
          {run.status === "running" ? run.liveLabel + "…" : done && run.trace ? `${SYSTEM_LABEL[run.system]} · ${Math.round(run.trace.ms / 1000)} s` : ""}
        </span>
      </div>
      {run.error && <div className="notice err">{run.error}</div>}

      {done &&
        (run.approved ? (
          <div className="row">
            <div className="validated" style={{ flex: "1 1 260px" }}>
              ✓ Validated by <b>{run.approved.by}</b>
              {run.approved.edited ? " with edits" : " as delivered"}
              {stored === true ? " — saved to the shared record" : stored === false ? " — not saved (store unavailable)" : ""}
            </div>
            <button className="btn ghost small" onClick={props.onReopen}>
              Re-open
            </button>
            <CopyButton text={run.edited} copied={copied} setCopied={setCopied} />
          </div>
        ) : (
          <div className="row">
            <button className="btn ghost small" aria-pressed={props.editing} onClick={() => props.onEditing(!props.editing)}>
              {props.editing ? "Done editing" : "Edit text"}
            </button>
            {touched && (
              <button className="btn ghost small" onClick={() => props.onEdit(run.final)}>
                Undo my edits
              </button>
            )}
            <CopyButton text={run.edited} copied={copied} setCopied={setCopied} />
            <span style={{ flex: 1 }} />
            <input className="name" placeholder="Your name" value={reviewer} onChange={(e) => setReviewer(e.target.value)} aria-label="Reviewer name" />
            <button className="btn ok" disabled={!reviewer.trim()} onClick={validate}>
              Validate
            </button>
          </div>
        ))}

      {done && (
        <p className="small" style={{ margin: 0 }}>
          {run.trace && run.trace.calls > 1 ? `${applied.length} correction${applied.length === 1 ? "" : "s"} by the editor` : "No editing step"}
          {" · "}
          {qa.errors + qa.warnings ? (
            <b>
              {qa.errors + qa.warnings} automatic check{qa.errors + qa.warnings === 1 ? "" : "s"} to look at
            </b>
          ) : (
            "all automatic checks passed"
          )}
          {touched ? " (on your edited text)" : ""}
        </p>
      )}
      {done && qa.errors + qa.warnings > 0 && <QAList checks={qaNow} showOk={false} />}

      {done && (
        <details className="more">
          <summary>Details: what each step did, corrections, checks</summary>
          <Stepper steps={run.steps} />
          {run.trace && <StageTrace trace={run.trace} humanShare={humanShare} />}
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={tab === "changes"} onClick={() => setTab("changes")}>
              Changes<span className="count">{applied.length}</span>
            </button>
            <button role="tab" aria-selected={tab === "qa"} onClick={() => setTab("qa")}>
              QA<span className="count">{qa.errors + qa.warnings}</span>
            </button>
          </div>

          {tab === "changes" && (
            <>
              {applied.length ? <Changes list={applied} /> : <p className="muted small">{run.trace && run.trace.calls > 1 ? "The editor found nothing to correct in the draft." : "No editor in this system: the draft is the text."}</p>}
              {refused.length > 0 && (
                <details>
                  <summary>{refused.length} edit(s) the desk refused</summary>
                  <Changes list={refused} />
                </details>
              )}
              {unrepaired.length > 0 && (
                <details>
                  <summary>{unrepaired.length} diagnosed error(s) left as they are</summary>
                  <ul className="qa-list">
                    {unrepaired.map((e, i) => (
                      <li key={i}>
                        <span className={"badge " + (e.severity === "minor" ? "info" : "warn")}>{e.category}</span>
                        <span>
                          “{e.span}” <span className="muted">— {e.explanation}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}

          {tab === "qa" && (
            <>
              <div className="panel-head">
                <span className="small">
                  <span className={"badge " + (qa.errors ? "error" : "ok")}>{qa.errors} errors</span>{" "}
                  <span className={"badge " + (qa.warnings ? "warn" : "ok")}>{qa.warnings} warnings</span>{" "}
                  <span className="muted">
                    {qa.passed} checks passed{touched ? " — on your edited text" : ""}
                  </span>
                </span>
                <label className="check small">
                  <input type="checkbox" checked={showOk} onChange={(e) => setShowOk(e.target.checked)} /> show passed
                </label>
              </div>
              <QAList checks={qaNow} showOk={showOk} />
              {run.verdicts.length > 0 && (
                <details>
                  <summary>The editor’s ruling on {run.verdicts.length} flag(s) raised on the draft</summary>
                  <ul className="qa-list">
                    {run.verdicts.map((v, i) => (
                      <li key={i}>
                        <span className={"badge " + (v.action === "fixed" ? "warn" : "info")}>{v.action === "fixed" ? "real" : "false alarm"}</span>
                        <span>
                          {v.check}
                          <br />
                          <span className="muted small">{v.reason}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
          <details className="inspect">
          <summary>Inspect: draft, reasoning, prompts, cost</summary>
          {done && (
            <>
              <div className="label">Draft → {touched ? "your text" : "final"}</div>
              <div className="diff" lang={lang}>
                {draftDiff.map((p, i) => (p.op === "=" ? <span key={i}>{p.text}</span> : p.op === "-" ? <del key={i}>{p.text}</del> : <ins key={i}>{p.text}</ins>))}
              </div>
            </>
          )}
          {run.alternative && (
            <>
              <div className="label">DeepL’s version, shown to the editor</div>
              <div className="diff" lang={lang}>
                {run.alternative}
              </div>
            </>
          )}
          {run.thinking && (
            <>
              <div className="label">Reasoning summary (last step)</div>
              <div className="thinking" style={{ maxHeight: 260 }}>
                {run.thinking}
              </div>
            </>
          )}
          {run.prompts.map((p, i) => (
            <details key={i}>
              <summary>
                {p.title} — {(p.system.length + p.user.length).toLocaleString()} characters
              </summary>
              <pre>{(p.system ? p.system + "\n\n────────── user ──────────\n\n" : "") + p.user}</pre>
            </details>
          ))}
          {done && (
            <p className="muted small" style={{ margin: 0 }}>
              {run.usage.length} Claude call(s), ≈ ${usd.toFixed(3)} at list price ({run.usage.reduce((s, u) => s + u.input + u.cacheWrite + u.cacheRead, 0).toLocaleString()} tokens in,{" "}
              {run.usage.reduce((s, u) => s + u.output, 0).toLocaleString()} out, reasoning included)
              {run.deeplChars ? ` · DeepL ${run.deeplChars.toLocaleString("en")} characters (≈ €${((run.deeplChars * 22) / 1e6).toFixed(3)})` : ""}.
            </p>
          )}
          </details>
        </details>
      )}
    </section>
  );
}

function CopyButton({ text, copied, setCopied }: { text: string; copied: boolean; setCopied: (v: boolean) => void }) {
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
