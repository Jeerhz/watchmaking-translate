// Browser helpers: the NDJSON step stream, a word diff and the cost estimate.

import type { Lang, Src, StoreKind, StreamEvent, TranslateRequest, Usage } from "./types";

export class AccessError extends Error {}

export interface StepResult {
  text: string;
  usage: Usage;
  system: string;
  user: string;
}

type StreamHandlers = {
  text?: (all: string) => void;
  thinking?: (all: string) => void;
  prompt?: (e: Extract<StreamEvent, { t: "prompt" }>) => void;
};

export function runStep(req: TranslateRequest, on: StreamHandlers, signal: AbortSignal): Promise<StepResult> {
  return streamStep("/api/translate", req, on, signal);
}

/** One paragraph through the fine-tuned open model (/api/open-mt). */
export function runOpen(req: { lang: Lang; source: string; swiss?: boolean }, on: StreamHandlers, signal: AbortSignal): Promise<StepResult> {
  return streamStep("/api/open-mt", req, on, signal);
}

/** One paragraph through DeepL customised for GMT (/api/deepl). */
export function runDeepL(
  req: { lang: Lang; src?: Src; source: string; swiss?: boolean; context?: string | null },
  on: StreamHandlers,
  signal: AbortSignal,
): Promise<StepResult> {
  return streamStep("/api/deepl", req, on, signal);
}

/** Record one event (run statistics, a validated text, a blind judgment) in the shared store.
 *  Returns false when the store is not configured or unreachable — callers keep a local copy. */
export async function saveEvent(kind: StoreKind, payload: Record<string, unknown>): Promise<boolean> {
  try {
    const res = await fetch("/api/store", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, ...payload }), keepalive: true });
    return res.ok;
  } catch {
    return false;
  }
}

/** Fire-and-forget variant for statistics nobody waits on. */
export function logEvent(kind: StoreKind, payload: Record<string, unknown>): void {
  void saveEvent(kind, payload);
}

export interface Pruned {
  drop: { key: string; surface: string; reason: string }[];
  usage: Usage | null;
  system: string;
  user: string;
  error?: string;
}

/** Ask Claude which termbase matches are ordinary words in this text (/api/terms). */
export async function pruneTerms(text: string, signal: AbortSignal, src: Src = "fr"): Promise<Pruned> {
  const none: Pruned = { drop: [], usage: null, system: "", user: "" };
  try {
    const res = await fetch("/api/terms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, src }), signal });
    if (res.status === 401) throw new AccessError("access code required");
    return res.ok ? ((await res.json()) as Pruned) : none;
  } catch (err) {
    if (err instanceof AccessError || signal.aborted) throw err;
    return none;
  }
}

const NAME_KEY = "gmt-desk-name";
/** The editor's name, typed once and remembered in this browser. */
export function rememberedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}
export function rememberName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name.trim());
  } catch {}
}

async function streamStep(path: string, req: object, on: StreamHandlers, signal: AbortSignal): Promise<StepResult> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });
  if (res.status === 401) throw new AccessError("access code required");
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  let text = "";
  let thinking = "";
  let prompt: { system: string; user: string } = { system: "", user: "" };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      const e = JSON.parse(line) as StreamEvent;
      if (e.t === "prompt") {
        prompt = { system: e.system, user: e.user };
        on.prompt?.(e);
      } else if (e.t === "thinking") on.thinking?.((thinking += e.text));
      else if (e.t === "text") on.text?.((text += e.text));
      else if (e.t === "error") throw new Error(e.message);
      else if (e.t === "done") return { text: e.text, usage: e.usage, ...prompt };
    }
  }
  throw new Error("The connection closed before the step finished (function time limit?). Try a shorter text or lower effort.");
}

/** Claude Opus 5.5 list prices, USD per million tokens (cache write = 1.25 × input). */
const PRICE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };

export function cost(u: Usage[]): number {
  return u.reduce(
    (s, x) =>
      s + (x.input * PRICE.input + x.output * PRICE.output + x.cacheRead * PRICE.cacheRead + x.cacheWrite * PRICE.cacheWrite) / 1e6,
    0,
  );
}

export type DiffPart = { op: "=" | "-" | "+"; text: string };

/** Word-level LCS diff (whitespace kept attached to tokens). */
export function diffWords(a: string, b: string): DiffPart[] {
  const ta = a.match(/\s+|[^\s]+/g) ?? [];
  const tb = b.match(/\s+|[^\s]+/g) ?? [];
  const n = ta.length;
  const m = tb.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i][j] = ta[i] === tb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffPart[] = [];
  const push = (op: DiffPart["op"], text: string) => {
    const last = out[out.length - 1];
    if (last && last.op === op) last.text += text;
    else out.push({ op, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (ta[i] === tb[j]) push("=", ta[i++]), j++;
    else if (dp[i + 1][j] >= dp[i][j + 1]) push("-", ta[i++]);
    else push("+", tb[j++]);
  }
  while (i < n) push("-", ta[i++]);
  while (j < m) push("+", tb[j++]);
  return out;
}

export function editRate(parts: DiffPart[]): number {
  const words = (s: string) => (s.match(/[^\s]+/g) ?? []).length;
  const changed = parts.filter((p) => p.op !== "=").reduce((s, p) => s + words(p.text), 0);
  const base = parts.filter((p) => p.op !== "+").reduce((s, p) => s + words(p.text), 0);
  return base ? changed / base : 0;
}
