// What each stage of one run did: draft → diagnosis → repair → QA → the editor's own changes.

import { CATEGORIES } from "@/lib/types";
import { SYSTEM_LABEL, type Trace } from "./run";

const pct = (v: number) => `${Math.round(v * 100)} %`;

export default function StageTrace({ trace, humanShare }: { trace: Trace; humanShare: number | null }) {
  const edited = trace.calls > 1 || trace.system === "deepl-claude";
  const kinds = CATEGORIES.filter((c) => trace.byCategory[c]).map((c) => `${trace.byCategory[c]} ${c}`);
  const serious = trace.bySeverity.major + trace.bySeverity.critical;
  const flags = (q: { errors: number; warnings: number }) => q.errors + q.warnings;
  const drafter = trace.system === "deepl" || trace.system === "deepl-claude" ? "DeepL" : trace.system === "open" ? "Fine-tuned model" : "Claude";
  return (
    <ol className="trace" aria-label={`What each stage did — ${SYSTEM_LABEL[trace.system]}`}>
      <li>
        <b>Draft</b>
        <span>{drafter}</span>
        <span>
          {trace.terms} terms{trace.pruned ? `, ${trace.pruned} pruned` : ""} · {flags(trace.qaDraft)} QA flag{flags(trace.qaDraft) === 1 ? "" : "s"}
        </span>
      </li>
      {edited && trace.system !== "claude-legacy" && (
        <li>
          <b>Diagnosis</b>
          <span>
            {trace.diagnosed} error{trace.diagnosed === 1 ? "" : "s"}
            {serious ? `, ${serious} major` : ""}
          </span>
          <span>{kinds.join(" · ") || "draft judged ready"}</span>
        </li>
      )}
      {edited && (
        <li>
          <b>{trace.system === "claude-legacy" ? "Rewrite" : "Repair"}</b>
          <span>
            {trace.applied} edit{trace.applied === 1 ? "" : "s"} applied{trace.rejected ? `, ${trace.rejected} refused` : ""}
          </span>
          <span>{pct(trace.editorShare)} of the draft’s words changed</span>
        </li>
      )}
      <li>
        <b>QA</b>
        <span>
          {flags(trace.qaFinal)} flag{flags(trace.qaFinal) === 1 ? "" : "s"} left
        </span>
        <span>
          {trace.qaFinal.errors} error{trace.qaFinal.errors === 1 ? "" : "s"}, {trace.qaFinal.warnings} warning{trace.qaFinal.warnings === 1 ? "" : "s"}
        </span>
      </li>
      <li className={humanShare ? "human" : undefined}>
        <b>Your edit</b>
        <span>{humanShare === null ? "—" : humanShare === 0 ? "nothing changed" : `${pct(humanShare)} of words changed`}</span>
        <span>before validation</span>
      </li>
    </ol>
  );
}
