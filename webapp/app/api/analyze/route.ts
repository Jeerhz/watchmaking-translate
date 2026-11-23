// Evidence only (no model call): glossary terms with their offsets, and the reference
// sentences retrieved for every source sentence, for the two target languages of the source language (French by default).

import { analyze, getEngine } from "@/lib/server/engine";
import { isSrc } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const { text, src = "fr" } = (await req.json()) as { text?: string; src?: string };
  if (typeof text !== "string" || !isSrc(src)) return Response.json({ error: "text required" }, { status: 400 });
  return Response.json(analyze(text.slice(0, 40_000), src));
}

export async function GET(): Promise<Response> {
  return Response.json(getEngine().stats);
}
