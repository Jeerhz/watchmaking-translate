// One pipeline step per request (draft | review | fix), streamed as NDJSON events so the
// client can show the prompt, the model's reasoning summary and the text as they arrive.
// The client orchestrates the steps, so every call stays well inside the function limit.

import Anthropic from "@anthropic-ai/sdk";
import { evidence, getEngine } from "@/lib/server/engine";
import { fields, fill } from "@/lib/server/prompts";
import { LANGS, type StreamEvent, type TranslateRequest } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const MODEL = "claude-opus-5-5";
const MAX_WORDS = 1600;
const client = new Anthropic();

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json()) as TranslateRequest;
  const { step, lang, source } = body;
  if (!LANGS.includes(lang) || !["draft", "review", "fix"].includes(step) || !source?.trim()) {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  if (source.split(/\s+/).length > MAX_WORDS) {
    return Response.json({ error: `chunk longer than ${MAX_WORDS} words` }, { status: 413 });
  }
  if (step !== "draft" && !body.draft?.trim()) {
    return Response.json({ error: "draft required" }, { status: 400 });
  }

  const { bundle } = getEngine();
  const { hits, examples } = evidence(source, lang);
  const f = fields(source, lang, hits, examples, body.context, Boolean(body.swiss));
  const p = bundle.prompts;
  let system: string;
  let user: string;
  let schema: Record<string, unknown> | null = null;
  if (step === "draft") {
    system = fill(p.translate_system, f);
    user = fill(p.translate_user, f);
  } else if (step === "review") {
    system = fill(p.review_system, f);
    user = fill(p.review_user, { ...f, draft: body.draft! });
    schema = bundle.schemas.review;
  } else {
    system = fill(p.review_system, f);
    const issues = (body.issues ?? []).map((i) => `- ${i}`).join("\n") || "- (none)";
    user = fill(p.fix_user, { ...f, draft: body.draft!, issues });
    schema = bundle.schemas.fix;
  }

  const encoder = new TextEncoder();
  const started = Date.now();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: StreamEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      send({ t: "prompt", system, user, terms: hits.length, examples: examples.length });
      try {
        const run = client.beta.messages.stream(
          {
            model: MODEL,
            max_tokens: 64000,
            thinking: { type: "adaptive", display: "summarized" },
            // the style guide is the stable prefix; cached across steps and languages' calls
            system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
            messages: [{ role: "user", content: user }],
            output_config: {
              effort: body.effort ?? "xhigh",
              ...(schema ? { format: { type: "json_schema", schema } } : {}),
            },
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
          },
          { signal: req.signal },
        );
        for await (const event of run) {
          if (event.type !== "content_block_delta") continue;
          if (event.delta.type === "thinking_delta") send({ t: "thinking", text: event.delta.thinking });
          else if (event.delta.type === "text_delta") send({ t: "text", text: event.delta.text });
        }
        const message = await run.finalMessage();
        if (message.stop_reason === "refusal") throw new Error("The model declined this text.");
        if (message.stop_reason === "max_tokens") throw new Error("Output truncated — shorten the text.");
        const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
        const u = message.usage;
        send({
          t: "done",
          text,
          stop: message.stop_reason,
          usage: {
            input: u.input_tokens,
            output: u.output_tokens,
            cacheRead: u.cache_read_input_tokens ?? 0,
            cacheWrite: u.cache_creation_input_tokens ?? 0,
            ms: Date.now() - started,
            model: message.model,
          },
        });
      } catch (err) {
        if (!req.signal.aborted) {
          const message =
            err instanceof Anthropic.RateLimitError
              ? "Rate limited by the Claude API — retry in a minute."
              : err instanceof Anthropic.APIError
                ? `Claude API error ${err.status ?? ""}: ${err.message}`
                : err instanceof Error
                  ? err.message
                  : "Unknown error";
          send({ t: "error", message });
        }
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
