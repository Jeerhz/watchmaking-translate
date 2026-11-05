// Evidence only (no model call): glossary terms with their offsets, and the reference
// sentences retrieved for every source sentence, for English and German.

import { analyze, getEngine } from "@/lib/server/engine";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const { text } = (await req.json()) as { text?: string };
  if (typeof text !== "string") return Response.json({ error: "text required" }, { status: 400 });
  return Response.json(analyze(text.slice(0, 40_000)));
}

export async function GET(): Promise<Response> {
  return Response.json(getEngine().stats);
}
