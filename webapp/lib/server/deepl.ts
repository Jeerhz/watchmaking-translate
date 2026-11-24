// DeepL customised for GMT (docs/deepl-system.md): EN-GB / DE-CH, the GMT glossary (terms GMT's
// own translations render consistently), the GMT English style rule list or inline house rules
// for German, the remaining watchmaking termbase hits as one-term instructions, and the
// preceding paragraph as context (free, not translated). Setup is created by
// `trad_gmt.mt.deepl.setup` and exported to deepl-setup.json.

import setup from "@/lib/deepl-setup.json";
import { findTerms } from "@/lib/server/engine";
import type { Lang, Src } from "@/lib/types";

const KEY = process.env.DEEPL_API_KEY ?? "";
const BASE = KEY.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";
const HARD: Record<Lang, Set<string>> = { en: new Set(setup.hard.en), de: new Set(setup.hard.de), fr: new Set() };
const WATCH = new Set(setup.watch_words);

export const DEEPL = {
  configured: Boolean(KEY),
  label: "DeepL · GMT glossary + house style",
  plan: KEY.endsWith(":fx") ? "free" : "pro",
};

/** EN common nouns lower-case; German nouns keep their capital. */
function caseFor(tgt: string, lang: Lang): string {
  return lang === "en" && /^[A-Z][a-z]/.test(tgt) && !/^(Arabic|Roman|Maltese|Gregorian|Swiss|GMT|Geneva)/.test(tgt)
    ? tgt[0].toLowerCase() + tgt.slice(1)
    : tgt;
}

/** Watchmaking termbase hits the glossary does not cover, as one-term instructions (≤ limit). */
export function softInstructions(source: string, lang: Lang, swiss: boolean, limit = 5, src: Src = "fr"): string[] {
  const out: string[] = [];
  for (const h of findTerms(source, lang, 30, src)) {
    const fr = h.term.toLowerCase();
    if (HARD[lang].has(fr) || HARD[lang].has(h.surface.toLowerCase())) continue;
    // everyday words are left to DeepL: one-word terms pass only if they are watchmaking words
    // (French source) or carry a GMT house rule (English source)
    if (!fr.includes(" ") && !(src === "fr" ? WATCH.has(fr) : h[lang][0][2] <= 0)) continue;
    let tgt = caseFor(h[lang][0][0], lang);
    // dictionary headwords are capitalised ("Phases de lune"); GMT house terms keep their own case
    if (lang === "fr" && h[lang][0][2] > 0 && /^\p{Lu}\p{Ll}/u.test(tgt)) tgt = tgt[0].toLowerCase() + tgt.slice(1);
    if (lang === "de" && swiss) tgt = tgt.replace(/ß/g, "ss");
    out.push(`Translate '${h.surface}' as '${tgt}'.`);
    if (out.length === limit) break;
  }
  return out;
}

export interface DeepLRequest {
  body: Record<string, unknown>;
  soft: string[];
}

const TARGET_CODE = (lang: Lang, swiss: boolean): string => (lang === "en" ? "EN-GB" : lang === "fr" ? "FR" : swiss ? "DE-CH" : "DE-DE");

/** English source: the GMT glossary and style list exist for French → English / German only, so
 *  DeepL gets what was measured to matter most there, the surrounding paragraphs as context, plus
 *  the termbase's French equivalents as one-term instructions. German gets context only, as for
 *  a French source. Not measured yet in this direction. */
function buildFromEnglish(source: string, lang: Lang, swiss: boolean, context: string | null): DeepLRequest {
  const soft = lang === "fr" ? softInstructions(source, lang, swiss, 5, "en") : [];
  const body: Record<string, unknown> = {
    text: [source],
    source_lang: "EN",
    target_lang: TARGET_CODE(lang, swiss),
    model_type: "quality_optimized",
    preserve_formatting: true,
    formality: "prefer_more",
    show_billed_characters: true,
  };
  if (soft.length) body.custom_instructions = soft;
  if (context) body.context = context;
  return { body, soft };
}

export function buildRequest(source: string, lang: Lang, swiss: boolean, context: string | null, src: Src = "fr"): DeepLRequest {
  if (src === "en") return buildFromEnglish(source, lang, swiss, context);
  const soft = lang === "en" ? softInstructions(source, lang, swiss) : [];
  const body: Record<string, unknown> = {
    text: [source],
    source_lang: "FR",
    target_lang: TARGET_CODE(lang, swiss),
    model_type: "quality_optimized",
    preserve_formatting: true,
    formality: "prefer_more",
    glossary_id: setup.glossary_id,
    show_billed_characters: true,
  };
  // Measured on GMT Magazine (docs/translation-systems.md): English gains from the style list and
  // soft terms; German inline rules cost 0.7 COMET, so German gets glossary + context only.
  if (lang === "en") {
    if (setup.style_en) body.style_id = setup.style_en;
    const instr = setup.style_en ? soft : [...setup.rules.en, ...soft];
    if (instr.length) body.custom_instructions = instr.slice(0, 10);
  }
  if (context) body.context = context;
  return { body, soft };
}

export async function translateDeepL(req: DeepLRequest, signal: AbortSignal): Promise<{ text: string; billed: number }> {
  const res = await fetch(`${BASE}/v2/translate`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `DeepL-Auth-Key ${KEY}` },
    body: JSON.stringify(req.body),
    signal,
  });
  if (res.status === 456) throw new Error("DeepL character quota exhausted for this billing period.");
  if (!res.ok) throw new Error(`DeepL error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { translations: { text: string; billed_characters?: number }[] };
  return { text: data.translations[0].text, billed: data.translations[0].billed_characters ?? 0 };
}
