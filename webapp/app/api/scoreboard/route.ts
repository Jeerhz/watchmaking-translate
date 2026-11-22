// The scoreboard's numbers, aggregated from the shared store on every request.

import { scoreboard } from "@/lib/server/scoreboard";
import { STORE } from "@/lib/server/store";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(): Promise<Response> {
  if (!STORE.configured) return Response.json({ error: "store not configured" }, { status: 503 });
  return Response.json(await scoreboard(), { headers: { "cache-control": "no-store" } });
}
