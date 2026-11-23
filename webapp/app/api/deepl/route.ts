// Translation by DeepL customised for GMT, as the same NDJSON events as /api/translate.
// GET reports whether DEEPL_API_KEY is set.

import { buildRequest, DEEPL, translateDeepL } from "@/lib/server/deepl";
import { TARGETS, isSrc, type Lang, type Src, type StreamEvent } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_WORDS = 1500;
const EUR_PER_MILLION = 22; // DeepL API Growth, extra characters

export async function GET(): Promise<Response> {
  return Response.json({ configured: DEEPL.configured, label: DEEPL.label, plan: DEEPL.plan });
}

export async function POST(req: Request): Promise<Response> {
  const { lang, source, swiss = true, context = null, src = "fr" } = (await req.json()) as {
    lang: Lang;
    src?: Src;
    source: string;
    swiss?: boolean;
    context?: string | null;
  };
  if (!isSrc(src) || !TARGETS[src].includes(lang) || !source?.trim()) return Response.json({ error: "bad request" }, { status: 400 });
  if (source.split(/\s+/).length > MAX_WORDS) return Response.json({ error: `text longer than ${MAX_WORDS} words` }, { status: 413 });
  if (!DEEPL.configured) return Response.json({ error: "DeepL not configured" }, { status: 503 });

  const request = buildRequest(source, lang, swiss, context, src);
  const started = Date.now();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (e: StreamEvent) => controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      // the "prompt" panel shows the exact DeepL request (minus the text itself)
      const { text: _text, ...shown } = request.body;
      send({ t: "prompt", system: "", user: JSON.stringify(shown, null, 1), terms: request.soft.length, examples: 0 });
      try {
        const { text, billed } = await translateDeepL(request, req.signal);
        send({ t: "text", text });
        send({
          t: "done",
          text,
          stop: null,
          usage: {
            input: billed,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            ms: Date.now() - started,
            model: `${DEEPL.label} (≈ €${((billed * EUR_PER_MILLION) / 1e6).toFixed(4)})`,
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
