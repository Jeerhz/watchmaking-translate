// Client-side orchestration of one language: draft → editorial review → QA → correction,
// chunk by chunk, with every intermediate state kept for display.

import { AccessError, runStep } from "@/lib/client";
import { runQA, type QACheck } from "@/lib/qa";
import { chunkParagraphs, splitParagraphs } from "@/lib/textnorm";
import type { Change, Effort, Lang, TermHit, Usage, Verdict } from "@/lib/types";

export type StepId = "evidence" | "draft" | "review" | "qa" | "fix" | "validate";
export type StepState = "pending" | "active" | "done" | "skipped" | "error";

export const STEP_LABEL: Record<StepId, string> = {
  evidence: "Terms & references",
  draft: "Translator draft",
  review: "Editorial review",
  qa: "QA checks",
  fix: "Correction",
  validate: "Human validation",
};

export interface PromptLog {
  title: string;
  system: string;
  user: string;
}

export interface LangRun {
  status: "idle" | "running" | "done" | "error" | "stopped";
  steps: Record<StepId, StepState>;
  part: string;
  live: string;
  liveLabel: string;
  thinking: string;
  draft: string;
  reviewed: string;
  final: string;
  edited: string;
  changes: Change[];
  fixChanges: Change[];
  verdicts: Verdict[];
  qaDraft: QACheck[];
  qaReviewed: QACheck[];
  qaFinal: QACheck[];
  prompts: PromptLog[];
  usage: Usage[];
  error?: string;
  approved?: { by: string; at: string; edited: boolean };
}

export function emptyRun(): LangRun {
  return {
    status: "idle",
    steps: { evidence: "pending", draft: "pending", review: "pending", qa: "pending", fix: "pending", validate: "pending" },
    part: "",
    live: "",
    liveLabel: "",
    thinking: "",
    draft: "",
    reviewed: "",
    final: "",
    edited: "",
    changes: [],
    fixChanges: [],
    verdicts: [],
    qaDraft: [],
    qaReviewed: [],
    qaFinal: [],
    prompts: [],
    usage: [],
  };
}

type Patch = (fn: (r: LangRun) => LangRun) => void;

function parseJSON<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("The editor returned unreadable JSON — retry the translation.");
  }
}

export async function runLanguage(opts: {
  lang: Lang;
  text: string;
  terms: TermHit[];
  effort: Effort;
  swiss: boolean;
  signal: AbortSignal;
  patch: Patch;
}): Promise<void> {
  const { lang, text, terms, effort, swiss, signal, patch } = opts;
  const setStep = (id: StepId, s: StepState) => patch((r) => ({ ...r, steps: { ...r.steps, [id]: s } }));
  const chunks = chunkParagraphs(splitParagraphs(text)).map((c) => c.join("\n\n"));
  const drafts: string[] = [];
  const reviewed: string[] = [];
  const finals: string[] = [];
  let context: string | null = null;
  let anyFix = false;
  patch(() => ({ ...emptyRun(), status: "running", steps: { ...emptyRun().steps, evidence: "done" } }));

  try {
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const part = chunks.length > 1 ? ` (part ${i + 1}/${chunks.length})` : "";
      const chunkTerms = terms.filter((h) => h.spans.some(([s, e]) => chunk.includes(text.slice(s, e))));
      const prior = finals.join("\n\n");
      const base = { lang, source: chunk, context, swiss, effort };
      const live = (label: string) => ({
        prompt: (e: { system: string; user: string }) =>
          patch((r) => ({ ...r, prompts: [...r.prompts, { title: label + part, system: e.system, user: e.user }] })),
        thinking: (all: string) => patch((r) => ({ ...r, thinking: all })),
        text: (all: string) => patch((r) => ({ ...r, live: (prior ? prior + "\n\n" : "") + all })),
      });

      // 1. draft (streamed)
      setStep("draft", "active");
      patch((r) => ({ ...r, part, liveLabel: "Translator is drafting" + part, thinking: "" }));
      const d = await runStep({ step: "draft", ...base }, live("Draft prompt"), signal);
      drafts.push(d.text);
      patch((r) => ({ ...r, usage: [...r.usage, d.usage], draft: drafts.join("\n\n"), live: [prior, d.text].filter(Boolean).join("\n\n") }));
      setStep("draft", i === chunks.length - 1 ? "done" : "active");

      // 2. editorial review (structured JSON: final text + changes with reasons)
      setStep("review", "active");
      patch((r) => ({ ...r, liveLabel: "Chief sub-editor is reviewing" + part, thinking: "" }));
      const rv = await runStep({ step: "review", ...base, draft: d.text }, { ...live("Review prompt"), text: undefined }, signal);
      const review = parseJSON<{ translation: string; changes: Change[] }>(rv.text);
      let final = review.translation.trim() || d.text;
      reviewed.push(final);
      patch((r) => ({ ...r, usage: [...r.usage, rv.usage], changes: [...r.changes, ...review.changes], reviewed: reviewed.join("\n\n") }));
      setStep("review", i === chunks.length - 1 ? "done" : "active");

      // 3. automatic QA on the reviewed text
      setStep("qa", "active");
      const flags = runQA(chunk, final, lang, chunkTerms, swiss).filter((c) => c.flag);
      setStep("qa", i === chunks.length - 1 ? "done" : "active");

      // 4. correction pass, only when QA flagged something; the editor rules on each flag
      if (flags.length) {
        anyFix = true;
        setStep("fix", "active");
        patch((r) => ({ ...r, liveLabel: `Editor is checking ${flags.length} QA flag(s)` + part, thinking: "" }));
        const fx = await runStep(
          { step: "fix", ...base, draft: final, issues: flags.map((c) => c.flag!) },
          { ...live("Correction prompt"), text: undefined },
          signal,
        );
        const fixed = parseJSON<{ translation: string; changes: Change[]; verdicts: Verdict[] }>(fx.text);
        final = fixed.translation.trim() || final;
        patch((r) => ({
          ...r,
          usage: [...r.usage, fx.usage],
          fixChanges: [...r.fixChanges, ...fixed.changes],
          verdicts: [...r.verdicts, ...fixed.verdicts],
        }));
      }
      finals.push(final);
      patch((r) => ({ ...r, live: finals.join("\n\n") }));
      context = splitParagraphs(final).slice(-2).join("\n\n");
    }

    const all = (parts: string[]) => parts.join("\n\n");
    const finalText = all(finals);
    patch((r) => ({
      ...r,
      status: "done",
      liveLabel: "",
      final: finalText,
      edited: finalText,
      qaDraft: runQA(text, all(drafts), lang, terms, swiss),
      qaReviewed: runQA(text, all(reviewed), lang, terms, swiss),
      qaFinal: runQA(text, finalText, lang, terms, swiss),
      steps: { ...r.steps, evidence: "done", draft: "done", review: "done", qa: "done", fix: anyFix ? "done" : "skipped", validate: "active" },
    }));
  } catch (err) {
    if (err instanceof AccessError) {
      window.location.assign("/login?next=/");
      return;
    }
    const stopped = signal.aborted;
    patch((r) => ({
      ...r,
      status: stopped ? "stopped" : "error",
      error: stopped ? undefined : err instanceof Error ? err.message : String(err),
      liveLabel: "",
      steps: Object.fromEntries(Object.entries(r.steps).map(([k, v]) => [k, v === "active" ? "error" : v])) as LangRun["steps"],
    }));
  }
}
