// Translation by the fine-tuned open model, streamed as the same NDJSON events as
// /api/translate. GET reports whether the model is configured (OPEN_MT_URL + token).

import { OPEN_MT, openPrompt, openTarget, type OpenLang, type OpenTarget } from "@/lib/server/openmt";
import type { StreamEvent } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const MAX_WORDS = 400;

export async function GET(): Promise<Response> {
  return Response.json({ configured: Boolean(OPEN_MT.url && OPEN_MT.token), label: OPEN_MT.label });
}

export async function POST(req: Request): Promise<Response> {
  const { lang, source, swiss = false } = (await req.json()) as { lang: OpenLang; source: string; swiss?: boolean };
  if ((lang !== "en" && lang !== "de") || !source?.trim()) return Response.json({ error: "bad request" }, { status: 400 });
  if (source.split(/\s+/).length > MAX_WORDS) {
    return Response.json({ error: `paragraph longer than ${MAX_WORDS} words` }, { status: 413 });
  }
  if (!OPEN_MT.url || !OPEN_MT.token) return Response.json({ error: "open model not configured" }, { status: 503 });

  const { user, hints } = openPrompt(source, lang, swiss);
  const started = Date.now();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (e: StreamEvent) => controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      send({ t: "prompt", system: "", user, terms: hints.length, examples: 0 });
      try {
        const emit = (delta: string) => send({ t: "text", text: delta });
        const { text, usage } =
          OPEN_MT.kind === "gradio" ? await viaGradio(source, openTarget(lang, swiss), hints, emit, req.signal) : await viaOpenAI(user, emit, req.signal);
        send({
          t: "done",
          text,
          stop: null,
          usage: {
            input: usage.prompt_tokens,
            output: usage.completion_tokens,
            cacheRead: 0,
            cacheWrite: 0,
            ms: Date.now() - started,
            model: OPEN_MT.label,
          },
        });
      } catch (err) {
        if (!req.signal.aborted) send({ t: "error", message: err instanceof Error ? err.message : "Unknown error" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}

type Usage = { prompt_tokens: number; completion_tokens: number };
const auth = () => ({ authorization: `Bearer ${OPEN_MT.token}` });

function wakeError(status: number): Error {
  return new Error(
    status === 502 || status === 503 || status === 404
      ? "The open model's Space is starting (it sleeps when idle) — retry in a minute."
      : `Open model error ${status}`,
  );
}

/** Lines of a server-sent-event stream, as they arrive. */
async function* sseLines(body: NonNullable<Response["body"]>): AsyncGenerator<string> {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      yield buf.slice(0, nl).trimEnd();
      buf = buf.slice(nl + 1);
    }
  }
}

/** OpenAI-compatible chat completions (llama-server, vLLM), streamed. */
async function viaOpenAI(user: string, emit: (d: string) => void, signal: AbortSignal): Promise<{ text: string; usage: Usage }> {
  const res = await fetch(`${OPEN_MT.url}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", ...auth() },
    body: JSON.stringify({
      messages: [{ role: "user", content: user }],
      temperature: 0,
      max_tokens: 1024,
      stream: true,
      stream_options: { include_usage: true },
    }),
    signal,
  });
  if (!res.ok || !res.body) throw wakeError(res.status);
  let text = "";
  let usage: Usage = { prompt_tokens: 0, completion_tokens: 0 };
  for await (const line of sseLines(res.body)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "[DONE]") continue;
    const chunk = JSON.parse(data);
    const delta: string = chunk.choices?.[0]?.delta?.content ?? "";
    if (delta) {
      text += delta;
      emit(delta);
    }
    if (chunk.usage) usage = chunk.usage;
  }
  return { text: text.trim(), usage };
}

/** Gradio call API of the ZeroGPU Space: POST the inputs, then read the event stream. */
async function viaGradio(
  source: string,
  lang: OpenTarget,
  hints: [string, string][],
  emit: (d: string) => void,
  signal: AbortSignal,
): Promise<{ text: string; usage: Usage }> {
  const terms = hints.map(([fr, tgt]) => `${fr} → ${tgt}`).join("\n");
  const start = await fetch(`${OPEN_MT.url}/gradio_api/call/translate`, {
    method: "POST",
    headers: { "content-type": "application/json", ...auth() },
    body: JSON.stringify({ data: [source, lang, terms] }),
    signal,
  });
  if (!start.ok) throw wakeError(start.status);
  const { event_id } = (await start.json()) as { event_id: string };
  const res = await fetch(`${OPEN_MT.url}/gradio_api/call/translate/${event_id}`, { headers: auth(), signal });
  if (!res.ok || !res.body) throw wakeError(res.status);
  let event = "";
  let text = "";
  for await (const line of sseLines(res.body)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) {
      const data = JSON.parse(line.slice(5).trim() || "null");
      if (event === "error") throw new Error(`Open model error: ${typeof data === "string" ? data : "generation failed (GPU quota?)"}`);
      if ((event === "generating" || event === "complete") && Array.isArray(data) && typeof data[0] === "string") {
        // each event carries the whole text so far
        const all: string = data[0];
        if (all.length > text.length) emit(all.slice(text.length));
        text = all;
      }
      if (event === "complete") break;
    }
  }
  return { text: text.trim(), usage: { prompt_tokens: 0, completion_tokens: 0 } };
}
