// Term pruning: one cheap Claude call that removes termbase matches which are ordinary words in
// this text ("approche", "soleil"), before any prompt, check or highlight uses them.
// (WMT25 terminology task: the best document-level system let the model pick the relevant
// glossary entries first; soft, relevant terms beat hard enforcement of every match.)

import Anthropic from "@anthropic-ai/sdk";
import { findTerms } from "@/lib/server/engine";
import { PRUNE_SCHEMA, PRUNE_SYSTEM, pruneUser } from "@/lib/server/prompts";
import { isSrc, type Src, type Usage } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const MODEL = "claude-opus-5-5";
const client = new Anthropic();

export interface PruneResult {
  drop: { key: string; surface: string; reason: string }[];
  usage: Usage | null;
  system: string;
  user: string;
}

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json()) as { text?: string; src?: string };
  const lang: Src = isSrc(body.src) ? body.src : "fr";
  const { text } = body;
  if (typeof text !== "string" || !text.trim()) return Response.json({ error: "text required" }, { status: 400 });
  const src = text.slice(0, 40_000);
  const hits = findTerms(src, null, 150, lang);
  const system = PRUNE_SYSTEM[lang];
  const empty: PruneResult = { drop: [], usage: null, system, user: "" };
  if (!hits.length) return Response.json(empty);
  const user = pruneUser(src, hits, lang);
  const started = Date.now();
  try {
    const message = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 8000,
        thinking: { type: "adaptive" },
        system,
        messages: [{ role: "user", content: user }],
        output_config: { effort: "low", format: { type: "json_schema", schema: PRUNE_SCHEMA } },
      },
      { signal: req.signal },
    );
    const raw = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const parsed = JSON.parse(raw) as { drop: { n: number; reason: string }[] };
    const drop = parsed.drop.flatMap((d) => {
      const h = hits[d.n - 1];
      return h ? [{ key: h.key, surface: h.surface, reason: d.reason }] : [];
    });
    const u = message.usage;
    const result: PruneResult = {
      drop,
      system,
      user,
      usage: {
        input: u.input_tokens,
        output: u.output_tokens,
        cacheRead: u.cache_read_input_tokens ?? 0,
        cacheWrite: u.cache_creation_input_tokens ?? 0,
        ms: Date.now() - started,
        model: message.model,
      },
    };
    return Response.json(result);
  } catch (err) {
    // pruning is an optimisation: on failure the run continues with every match
    return Response.json({ ...empty, user, error: err instanceof Error ? err.message : "pruning failed" });
  }
}
