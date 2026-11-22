// Shared store: POST records one event; GET lists a kind (JSON, or JSONL to download the
// validated texts as test / training data).

import { addEvent, KINDS, listEvents, STORE } from "@/lib/server/store";
import type { StoreKind } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 400_000;

export async function POST(req: Request): Promise<Response> {
  if (!STORE.configured) return Response.json({ error: "store not configured" }, { status: 503 });
  const raw = await req.text();
  if (raw.length > MAX_BYTES) return Response.json({ error: "event too large" }, { status: 413 });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const { kind, id: _id, at: _at, ...payload } = body;
  if (!KINDS.includes(kind as StoreKind)) return Response.json({ error: "unknown kind" }, { status: 400 });
  try {
    const event = await addEvent(kind as StoreKind, payload);
    return Response.json({ id: event.id });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "store error" }, { status: 502 });
  }
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") as StoreKind | null;
  if (!kind) return Response.json(STORE);
  if (!KINDS.includes(kind)) return Response.json({ error: "unknown kind" }, { status: 400 });
  if (!STORE.configured) return Response.json({ error: "store not configured" }, { status: 503 });
  const events = await listEvents(kind);
  if (url.searchParams.get("format") === "jsonl") {
    return new Response(events.map((e) => JSON.stringify(e)).join("\n") + "\n", {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "content-disposition": `attachment; filename="gmt-${kind}s-${new Date().toISOString().slice(0, 10)}.jsonl"`,
        "cache-control": "no-store",
      },
    });
  }
  return Response.json(events, { headers: { "cache-control": "no-store" } });
}
