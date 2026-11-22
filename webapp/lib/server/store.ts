// The desk's shared store: append-only JSON events (run statistics, validated texts, blind
// judgments), one small file each, in a private Vercel Blob store on GMT's own Vercel team.
// Local development writes to data/store/ instead (data/ is never committed) unless
// DESK_STORE=blob.

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { get, list, put } from "@vercel/blob";
import type { StoreEvent, StoreKind } from "../types";

export const KINDS: StoreKind[] = ["run", "validation", "judgment"];
const useBlob = Boolean(process.env.BLOB_READ_WRITE_TOKEN) && (process.env.NODE_ENV === "production" || process.env.DESK_STORE === "blob");
const LOCAL = path.join(process.cwd(), "data", "store");
export const STORE = { configured: useBlob || process.env.NODE_ENV !== "production", backend: useBlob ? "blob" : "local" };

// events never change once written, so an instance only fetches each file once
const cache = new Map<string, StoreEvent>();

export async function addEvent(kind: StoreKind, payload: Record<string, unknown>): Promise<StoreEvent> {
  const at = new Date().toISOString();
  const id = `${at.replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}`;
  const event: StoreEvent = { ...payload, id, kind, at };
  const name = `events/${kind}/${id}.json`;
  const body = JSON.stringify(event);
  if (useBlob) {
    await put(name, body, { access: "private", addRandomSuffix: false, contentType: "application/json" });
  } else {
    await mkdir(path.join(LOCAL, "events", kind), { recursive: true });
    await writeFile(path.join(LOCAL, name), body);
  }
  cache.set(name, event);
  return event;
}

async function names(kind: StoreKind): Promise<string[]> {
  if (!useBlob) {
    const dir = path.join(LOCAL, "events", kind);
    return (await readdir(dir).catch(() => [])).filter((f) => f.endsWith(".json")).map((f) => `events/${kind}/${f}`);
  }
  const out: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: `events/${kind}/`, limit: 1000, cursor });
    out.push(...page.blobs.map((b) => b.pathname));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

async function read(name: string): Promise<StoreEvent | null> {
  const hit = cache.get(name);
  if (hit) return hit;
  try {
    let text: string;
    if (useBlob) {
      const res = await get(name, { access: "private" });
      if (!res) return null;
      text = await new Response(res.stream).text();
    } else {
      text = await readFile(path.join(LOCAL, name), "utf-8");
    }
    const event = JSON.parse(text) as StoreEvent;
    cache.set(name, event);
    return event;
  } catch {
    return null;
  }
}

/** Every event of a kind, oldest first. */
export async function listEvents(kind: StoreKind): Promise<StoreEvent[]> {
  const all = (await names(kind)).sort();
  const out: StoreEvent[] = [];
  for (let i = 0; i < all.length; i += 24) {
    const batch = await Promise.all(all.slice(i, i + 24).map(read));
    for (const e of batch) if (e) out.push(e);
  }
  return out;
}
