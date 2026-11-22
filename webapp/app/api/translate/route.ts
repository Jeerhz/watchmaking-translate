// One pipeline step per request, streamed as NDJSON events so the client can show the prompt,
// the model's reasoning summary and the text as they arrive. The client orchestrates the steps
// (draft → diagnose → repair), so every call stays well inside the function limit.

import Anthropic from "@anthropic-ai/sdk";
import { evidence, getEngine } from "@/lib/server/engine";
import {
  DIAGNOSE_SCHEMA,
  DIAGNOSE_SYSTEM,
  DIAGNOSE_USER,
  REPAIR_SCHEMA,
  REPAIR_SYSTEM,
  REPAIR_USER,
  fields,
  fill,
  renderErrors,
} from "@/lib/server/prompts";
import { LANGS, type Step, type StreamEvent, type TranslateRequest } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const MODEL = "claude-opus-5-5";
const MAX_WORDS = 1600;
const STEPS: Step[] = ["draft", "diagnose", "repair", "review", "fix"];
const client = new Anthropic();

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json()) as TranslateRequest;
  const { step, lang, source } = body;
  if (!LANGS.includes(lang) || !STEPS.includes(step) || !source?.trim()) {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  if (source.split(/\s+/).length > MAX_WORDS) {
    return Response.json({ error: `chunk longer than ${MAX_WORDS} words` }, { status: 413 });
  }
  if (step !== "draft" && !body.draft?.trim()) {
    return Response.json({ error: "draft required" }, { status: 400 });
  }

  const { bundle } = getEngine();
  const off = body.off ?? [];
  const found = evidence(source, lang);
  const drop = new Set(body.dropTerms ?? []);
  const hits = off.includes("termbase") ? [] : found.hits.filter((h) => !drop.has(h.key));
  const examples = off.includes("examples") ? [] : found.examples;
  const f = fields(source, lang, hits, examples, { context: body.context, article: body.article, decisions: body.decisions }, Boolean(body.swiss), off);
  const p = bundle.prompts;
  const issues = (body.issues ?? []).map((i) => `- ${i}`).join("\n");
  let system: string;
  let user: string;
  let schema: Record<string, unknown> | null = null;
  if (step === "draft") {
    system = fill(p.translate_system, f);
    user = fill(p.translate_user, f);
  } else if (step === "diagnose") {
    const notes = [...editorNotes(body, "diagnose"), ...(issues ? [`<qa_flags>\n${issues}\n</qa_flags>`] : [])];
    system = fill(DIAGNOSE_SYSTEM, f);
    user = fill(DIAGNOSE_USER, { ...f, draft: body.draft!, notes: notes.length ? "\n" + notes.join("\n\n") + "\n" : "" });
    schema = DIAGNOSE_SCHEMA;
  } else if (step === "repair") {
    const notes = editorNotes(body, "repair");
    system = fill(REPAIR_SYSTEM, f);
    user = fill(REPAIR_USER, { ...f, draft: body.draft!, errors: renderErrors(body.errors ?? []), notes: notes.length ? "\n" + notes.join("\n\n") + "\n" : "" });
    schema = REPAIR_SCHEMA;
  } else if (step === "review") {
    system = fill(p.review_system, f);
    user = withEditorNotes(fill(p.review_user, { ...f, draft: body.draft! }), body);
    schema = bundle.schemas.review;
  } else {
    system = fill(p.review_system, f);
    user = fill(p.fix_user, { ...f, draft: body.draft!, issues: issues || "- (none)" });
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

/** Where the draft comes from, and the other engines' versions of the same source. */
function editorNotes(body: TranslateRequest, pass: "diagnose" | "repair" | "review"): string[] {
  const notes: string[] = [];
  if (body.draftBy && pass !== "repair") {
    notes.push(
      `The draft above is raw machine translation by ${body.draftBy}, not a GMT translator's work. ` +
        "Check it as strictly as a junior translator's draft: approved glossary terms, GMT house style, and the voice of the GMT examples.",
    );
  }
  const alts = (body.alternatives ?? []).filter((a) => a.text?.trim()).slice(0, 3);
  if (alts.length) {
    const how =
      pass === "diagnose"
        ? "Where one renders a passage more accurately, more idiomatically or closer to the GMT examples than the draft does, report the draft's wording as an error and quote the better wording in the explanation."
        : pass === "repair"
          ? "Where one already has the right wording for a diagnosed span, use it. Never copy an error."
          : "Where one renders a passage more accurately, more idiomatically or closer to the GMT examples, use that wording in your final text and list it as a change. Never copy an error.";
    notes.push(
      `<alternatives>\nOther translations of the same source by other engines. ${how}\n` +
        alts.map((a) => `<alternative engine="${a.engine}">\n${a.text.trim()}\n</alternative>`).join("\n") +
        "\n</alternatives>",
    );
  }
  return notes;
}

function withEditorNotes(user: string, body: TranslateRequest): string {
  const notes = editorNotes(body, "review");
  if (!notes.length) return user;
  const at = user.lastIndexOf("\n\nReturn JSON");
  const block = "\n\n" + notes.join("\n\n");
  return at >= 0 ? user.slice(0, at) + block + user.slice(at) : user + block;
}
