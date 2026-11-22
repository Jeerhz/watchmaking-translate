// Client-side orchestration of one language, part by part, with every intermediate state kept
// for display:  draft → diagnosis → repair → QA.
//
// The editor works in two passes (Diagnose, Then Repair): it first lists the draft's errors as
// typed spans with a severity, then proposes one replacement per error. The desk applies the
// replacements itself, so nothing outside a diagnosed span can change, and refuses any edit
// that makes the automatic checks worse.

import { AccessError, cost, diffWords, editRate, logEvent, runDeepL, runOpen, runStep } from "@/lib/client";
import { runQA, summarize, termUsage, type QACheck } from "@/lib/qa";
import { chunkParagraphs, splitParagraphs } from "@/lib/textnorm";
import {
  CATEGORIES,
  type Category,
  type Change,
  type Decision,
  type Diagnosis,
  type Effort,
  type ErrorSeverity,
  type Lang,
  type Off,
  type TermHit,
  type Usage,
  type Verdict,
} from "@/lib/types";

export type StepId = "evidence" | "draft" | "diagnose" | "repair" | "qa" | "validate";
export type StepState = "pending" | "active" | "done" | "skipped" | "error";

export const STEP_LABEL: Record<StepId, string> = {
  evidence: "Terms & references",
  draft: "Draft",
  diagnose: "Diagnosis",
  repair: "Repair",
  qa: "QA checks",
  validate: "Validation",
};

/** A whole translation system: who drafts and who edits. */
export type SystemId = "claude" | "deepl-claude" | "fusion" | "deepl" | "open" | "claude-legacy";

export const SYSTEMS: { id: SystemId; label: string; help: string; needs?: "deepl" | "open" }[] = [
  { id: "claude", label: "Claude + editor", help: "Claude drafts with GMT’s terms, examples and style guide; the editor diagnoses the errors, then repairs only those" },
  { id: "deepl-claude", label: "DeepL + Claude editor", help: "DeepL drafts (GMT glossary, context); Claude’s editor diagnoses and repairs the draft", needs: "deepl" },
  { id: "fusion", label: "Claude + DeepL, one editor", help: "Both draft; the editor checks Claude’s draft with DeepL’s version beside it", needs: "deepl" },
  { id: "deepl", label: "DeepL alone", help: "DeepL with the GMT glossary, house style and context — no editor", needs: "deepl" },
  { id: "open", label: "Fine-tuned model alone", help: "Our fine-tuned open model, one pass with termbase hints — no editor", needs: "open" },
  { id: "claude-legacy", label: "Claude + previous editor", help: "The editor used until November 2026: one free rewrite, then a QA correction pass" },
];
export const SYSTEM_LABEL = Object.fromEntries(SYSTEMS.map((s) => [s.id, s.label])) as Record<SystemId, string>;

/** Components switched off for one run, to measure what each contributes. */
export interface Variant {
  off?: Off[]; // termbase, examples, style guide
  noEditor?: boolean; // keep the draft as it is
  noContext?: boolean; // no article, no earlier decisions, no surrounding paragraphs for DeepL
}

export interface PromptLog {
  title: string;
  system: string;
  user: string;
}

/** What each stage did in one run — the numbers behind the stage strip and the scoreboard. */
export interface Trace {
  system: SystemId;
  variant: string | null;
  lang: Lang;
  words: number;
  ms: number;
  usd: number;
  deeplChars: number;
  calls: number;
  terms: number;
  pruned: number;
  diagnosed: number;
  byCategory: Record<Category, number>;
  bySeverity: Record<ErrorSeverity, number>;
  applied: number;
  rejected: number;
  /** share of the draft's words the editor changed */
  editorShare: number;
  qaDraft: { errors: number; warnings: number };
  qaFinal: { errors: number; warnings: number };
}

export interface LangRun {
  status: "idle" | "running" | "done" | "error" | "stopped";
  system: SystemId;
  steps: Record<StepId, StepState>;
  live: string;
  liveLabel: string;
  thinking: string;
  draft: string;
  final: string;
  edited: string;
  errors: Diagnosis[];
  changes: Change[];
  verdicts: Verdict[];
  qaDraft: QACheck[];
  qaFinal: QACheck[];
  prompts: PromptLog[];
  usage: Usage[];
  deeplChars: number;
  alternative: string; // DeepL's version shown to the editor (fusion)
  trace: Trace | null;
  error?: string;
  approved?: { by: string; at: string; edited: boolean };
}

export function emptyRun(system: SystemId = "claude"): LangRun {
  return {
    status: "idle",
    system,
    steps: { evidence: "pending", draft: "pending", diagnose: "pending", repair: "pending", qa: "pending", validate: "pending" },
    live: "",
    liveLabel: "",
    thinking: "",
    draft: "",
    final: "",
    edited: "",
    errors: [],
    changes: [],
    verdicts: [],
    qaDraft: [],
    qaFinal: [],
    prompts: [],
    usage: [],
    deeplChars: 0,
    alternative: "",
    trace: null,
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

/** How much the automatic checks object to a text: one point per failed check, one per missing
 *  figure or reference. An edit may never raise it. */
function qaLoad(checks: QACheck[]): number {
  let n = 0;
  for (const c of checks) {
    if (c.severity === "ok") continue;
    n += c.kind === "figures" || (c.kind === "references" && c.severity === "error") ? (c.message.split(": ").pop() ?? "").split(", ").length : 1;
  }
  return n;
}

/** Apply the editor's replacements one by one. An edit is refused when its wording is not in the
 *  draft exactly once (it would touch text nobody diagnosed) or when it makes QA worse. */
export function applyEdits(
  draft: string,
  edits: { error: number; before: string; after: string; reason: string }[],
  errors: Diagnosis[],
  qa: (text: string) => QACheck[],
): { text: string; changes: Change[] } {
  let text = draft;
  let load = qaLoad(qa(text));
  const changes: Change[] = [];
  for (const e of edits) {
    const err = errors[e.error - 1];
    const ch: Change = { before: e.before, after: e.after, reason: e.reason, type: err?.category, severity: err?.severity };
    const n = e.before ? text.split(e.before).length - 1 : 0;
    if (n === 0) ch.rejected = "its wording is not in the draft";
    else if (n > 1) ch.rejected = "its wording occurs more than once in the draft";
    else if (e.before === e.after) ch.rejected = "it changes nothing";
    else if (/\n/.test(e.after) !== /\n/.test(e.before)) ch.rejected = "it would change the paragraph structure";
    else {
      const next = text.replace(e.before, () => e.after);
      const nextLoad = qaLoad(qa(next));
      if (nextLoad > load) ch.rejected = "it would fail an automatic check that the draft passes";
      else {
        text = next;
        load = nextLoad;
      }
    }
    changes.push(ch);
  }
  return { text, changes };
}

const tail = (text: string, chars: number) => (text.length > chars ? text.slice(-chars) : text);
const words = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);

export async function runLanguage(opts: {
  lang: Lang;
  text: string;
  terms: TermHit[]; // termbase hits kept after pruning
  dropTerms?: string[]; // keys pruned as ordinary words
  effort: Effort;
  swiss: boolean;
  signal: AbortSignal;
  patch: Patch;
  system?: SystemId;
  variant?: Variant;
  variantId?: string | null;
  origin?: "desk" | "compare";
  /** cost of calls shared by the languages of this run (term pruning), already divided */
  sharedUsd?: number;
}): Promise<void> {
  const { lang, text, terms, effort, swiss, signal, patch, system = "claude", variant = {}, dropTerms = [] } = opts;
  const off = variant.off ?? [];
  const qaTerms = off.includes("termbase") ? [] : terms;
  const setStep = (id: StepId, s: StepState) => patch((r) => ({ ...r, steps: { ...r.steps, [id]: s } }));
  const paragraphs = splitParagraphs(text);
  const chunkParas = chunkParagraphs(paragraphs);
  const chunks = chunkParas.map((c) => c.join("\n\n"));
  const editor = !variant.noEditor && (system === "claude" || system === "deepl-claude" || system === "fusion" || system === "claude-legacy");
  const drafts: string[] = [];
  const finals: string[] = [];
  const alternatives: string[] = [];
  const decisions: Decision[] = [];
  const started = Date.now();
  let deeplChars = 0;
  // local copies of what the state accumulates, for the trace
  const usage: Usage[] = [];
  const errs: Diagnosis[] = [];
  const chg: Change[] = [];
  let paraIndex = 0;
  patch(() => ({ ...emptyRun(system), status: "running", steps: { ...emptyRun().steps, evidence: "done" } }));

  try {
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const last = i === chunks.length - 1;
      const part = chunks.length > 1 ? ` (part ${i + 1}/${chunks.length})` : "";
      const chunkTerms = qaTerms.filter((h) => h.spans.some(([s, e]) => chunk.includes(text.slice(s, e))));
      const qa = (t: string) => runQA(chunk, t, lang, chunkTerms, swiss);
      const prior = finals.join("\n\n");
      const base = {
        lang,
        source: chunk,
        swiss,
        effort,
        dropTerms,
        off,
        // the whole article and the choices made so far, so names and terms stay consistent
        context: variant.noContext ? null : tail(prior, 6000) || null,
        article: variant.noContext || chunks.length === 1 ? null : text.slice(0, 60_000),
        decisions: variant.noContext ? [] : decisions,
      };
      const live = (label: string) => ({
        prompt: (e: { system: string; user: string }) =>
          patch((r) => ({ ...r, prompts: [...r.prompts, { title: label + part, system: e.system, user: e.user }] })),
        thinking: (all: string) => patch((r) => ({ ...r, thinking: all })),
        text: (all: string) => patch((r) => ({ ...r, live: (prior ? prior + "\n\n" : "") + all })),
      });
      const quiet = (label: string) => ({ ...live(label), text: undefined });

      // One paragraph at a time through a single-pass engine. DeepL also reads the paragraphs
      // around it (its context is neither translated nor billed).
      const single = async (engine: "deepl" | "open"): Promise<string> => {
        const out: string[] = [];
        for (const [k, para] of chunkParas[i].entries()) {
          const at = paraIndex + k;
          const context = variant.noContext
            ? null
            : [tail(paragraphs.slice(0, at).join("\n\n"), 2500), (paragraphs[at + 1] ?? "").slice(0, 800)].filter(Boolean).join("\n\n") || null;
          const title = `${engine === "deepl" ? "DeepL request" : "Open model prompt"} (paragraph ${at + 1}/${paragraphs.length})`;
          const r = await (engine === "deepl" ? runDeepL : runOpen)(
            { lang, source: para, swiss, context },
            {
              prompt: (e) => patch((x) => ({ ...x, prompts: [...x.prompts, { title, system: e.system, user: e.user }] })),
              text: system === engine ? (all) => patch((x) => ({ ...x, live: [prior, ...out, all].filter(Boolean).join("\n\n") })) : undefined,
            },
            signal,
          );
          out.push(r.text);
          if (engine === "deepl") deeplChars += r.usage.input;
        }
        patch((x) => ({ ...x, deeplChars }));
        return out.join("\n\n");
      };

      // 1. draft
      setStep("draft", "active");
      const who = system === "deepl" || system === "deepl-claude" ? "DeepL" : system === "open" ? "The fine-tuned model" : system === "fusion" ? "Claude and DeepL" : "Claude";
      patch((r) => ({ ...r, liveLabel: `${who} ${system === "fusion" ? "are" : "is"} drafting${part}`, thinking: "" }));
      let draft: string;
      let alt: string | null = null;
      if (system === "deepl" || system === "deepl-claude") draft = await single("deepl");
      else if (system === "open") draft = await single("open");
      else {
        const [d, a] = await Promise.all([
          runStep({ step: "draft", ...base }, live("Draft prompt"), signal),
          system === "fusion" ? single("deepl") : Promise.resolve(null),
        ]);
        draft = d.text;
        usage.push(d.usage);
        patch((r) => ({ ...r, usage: [...r.usage, d.usage] }));
        if (a) {
          alt = a;
          alternatives.push(a);
          patch((r) => ({ ...r, alternative: alternatives.join("\n\n") }));
        }
      }
      paraIndex += chunkParas[i].length;
      drafts.push(draft);
      patch((r) => ({ ...r, draft: drafts.join("\n\n"), live: [prior, draft].filter(Boolean).join("\n\n") }));
      setStep("draft", last ? "done" : "active");

      let final = draft;
      const origin = { ...(system === "deepl-claude" ? { draftBy: "DeepL" } : {}), ...(alt ? { alternatives: [{ engine: "DeepL", text: alt }] } : {}) };
      if (editor && system === "claude-legacy") {
        // the previous editor: one free rewrite, then a correction pass on QA flags
        setStep("diagnose", "active");
        patch((r) => ({ ...r, liveLabel: "Editor is rewriting" + part, thinking: "" }));
        const rv = await runStep({ step: "review", ...base, draft, ...origin }, quiet("Review prompt"), signal);
        const review = parseJSON<{ translation: string; changes: Change[] }>(rv.text);
        final = review.translation.trim() || draft;
        usage.push(rv.usage);
        chg.push(...review.changes);
        patch((r) => ({ ...r, usage: [...r.usage, rv.usage], changes: [...r.changes, ...review.changes] }));
        const flags = qa(final).filter((c) => c.flag);
        if (flags.length) {
          setStep("repair", "active");
          patch((r) => ({ ...r, liveLabel: `Editor is checking ${flags.length} QA flag(s)` + part, thinking: "" }));
          const fx = await runStep({ step: "fix", ...base, draft: final, issues: flags.map((c) => c.flag!) }, quiet("Correction prompt"), signal);
          const fixed = parseJSON<{ translation: string; changes: Change[]; verdicts: Verdict[] }>(fx.text);
          final = fixed.translation.trim() || final;
          usage.push(fx.usage);
          chg.push(...fixed.changes);
          patch((r) => ({ ...r, usage: [...r.usage, fx.usage], changes: [...r.changes, ...fixed.changes], verdicts: [...r.verdicts, ...fixed.verdicts] }));
        }
      } else if (editor) {
        // 2. diagnosis: typed error spans with a severity, and a ruling on each QA flag
        setStep("diagnose", "active");
        const flags = qa(draft).filter((c) => c.flag);
        patch((r) => ({ ...r, liveLabel: "Editor is diagnosing the draft" + part, thinking: "" }));
        const dg = await runStep({ step: "diagnose", ...base, draft, issues: flags.map((c) => c.flag!), ...origin }, quiet("Diagnosis prompt"), signal);
        const diagnosis = parseJSON<{ errors: Diagnosis[]; verdicts: Verdict[] }>(dg.text);
        const errors = diagnosis.errors.filter((e) => e.span.trim());
        usage.push(dg.usage);
        errs.push(...errors);
        patch((r) => ({ ...r, usage: [...r.usage, dg.usage], errors: [...r.errors, ...errors], verdicts: [...r.verdicts, ...diagnosis.verdicts] }));

        // 3. repair: one replacement per error, applied here and only if QA does not get worse
        if (errors.length) {
          setStep("repair", "active");
          patch((r) => ({ ...r, liveLabel: `Editor is repairing ${errors.length} error(s)` + part, thinking: "" }));
          const rp = await runStep({ step: "repair", ...base, draft, errors, ...origin }, quiet("Repair prompt"), signal);
          const { edits } = parseJSON<{ edits: { error: number; before: string; after: string; reason: string }[] }>(rp.text);
          const applied = applyEdits(draft, edits, errors, qa);
          final = applied.text;
          usage.push(rp.usage);
          chg.push(...applied.changes);
          patch((r) => ({ ...r, usage: [...r.usage, rp.usage], changes: [...r.changes, ...applied.changes] }));
        }
      }
      finals.push(final);
      patch((r) => ({ ...r, live: finals.join("\n\n") }));

      // remember how each term was rendered, for the next parts
      for (const u of termUsage(final, lang, chunkTerms)) {
        if (u.target && !decisions.some((d) => d.fr === u.hit.fr)) decisions.push({ fr: u.hit.fr, tgt: u.target });
      }
    }

    const draftText = drafts.join("\n\n");
    const finalText = finals.join("\n\n");
    const qaDraft = runQA(text, draftText, lang, qaTerms, swiss);
    const qaFinal = runQA(text, finalText, lang, qaTerms, swiss);
    const applied = chg.filter((c) => !c.rejected);
    const count = <K extends string>(keys: readonly K[], of: (e: Diagnosis) => K) =>
      Object.fromEntries(keys.map((k) => [k, errs.filter((e) => of(e) === k).length])) as Record<K, number>;
    const sd = summarize(qaDraft);
    const sf = summarize(qaFinal);
    const trace: Trace = {
      system,
      variant: opts.variantId ?? null,
      lang,
      words: words(text),
      ms: Date.now() - started,
      usd: cost(usage) + (opts.sharedUsd ?? 0),
      deeplChars,
      calls: usage.length,
      terms: qaTerms.length,
      pruned: dropTerms.length,
      diagnosed: system === "claude-legacy" ? applied.length : errs.length,
      byCategory: count(CATEGORIES, (e) => e.category),
      bySeverity: count(["minor", "major", "critical"] as const, (e) => e.severity),
      applied: applied.length,
      rejected: chg.length - applied.length,
      editorShare: editRate(diffWords(draftText, finalText)),
      qaDraft: { errors: sd.errors, warnings: sd.warnings },
      qaFinal: { errors: sf.errors, warnings: sf.warnings },
    };
    logEvent("run", { ...trace, effort, swiss, origin: opts.origin ?? "desk" });
    patch((r) => ({
      ...r,
      status: "done",
      liveLabel: "",
      final: finalText,
      edited: finalText,
      qaDraft,
      qaFinal,
      trace,
      steps: {
        evidence: "done",
        draft: "done",
        diagnose: editor ? "done" : "skipped",
        repair: editor && chg.length ? "done" : "skipped",
        qa: "done",
        validate: "active",
      },
    }));
  } catch (err) {
    if (err instanceof AccessError) {
      window.location.assign("/login?next=" + encodeURIComponent(window.location.pathname));
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
