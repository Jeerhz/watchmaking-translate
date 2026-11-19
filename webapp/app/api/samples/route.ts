// Held-out GMT Magazine passages (issues 97–98) with GMT's own EN and DE, for blind comparison.

import { getEngine } from "@/lib/server/engine";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return Response.json(getEngine().bundle.samples ?? []);
}
