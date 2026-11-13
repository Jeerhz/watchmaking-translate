// The fine-tuned open model (Gemma 4 + LoRA on GMT data). Two ways to reach it:
//  - "gradio": the private ZeroGPU Space (space-zerogpu/), which builds the prompt itself
//    from the text, language and terms;
//  - "openai": any OpenAI-compatible server (llama.cpp llama-server, vLLM), given the full
//    prompt, which must match training exactly (src/trad_gmt/ft/prompt.py).

import { findTerms } from "@/lib/server/engine";
import type { Lang } from "@/lib/types";

// "de-ch" = GMT's own German (Swiss: ss, «»), as in the magazine's German edition
export type OpenTarget = Lang | "de-ch";
const LANG_NAMES: Record<OpenTarget, string> = {
  en: "British English",
  de: "German",
  "de-ch": "Swiss Standard German (ss, never ß; «» quotes)",
};

export const openTarget = (lang: Lang, swiss: boolean): OpenTarget => (lang === "de" && swiss ? "de-ch" : lang);

export const OPEN_MT = {
  url: process.env.OPEN_MT_URL?.replace(/\/$/, "") ?? "",
  kind: (process.env.OPEN_MT_KIND ?? "gradio") as "gradio" | "openai",
  token: process.env.OPEN_MT_KEY ?? process.env.HF_TOKEN ?? "",
  label: process.env.OPEN_MT_LABEL ?? "Gemma 4 E4B · GMT fine-tune",
};

export function openPrompt(source: string, lang: Lang, swiss = false): { user: string; hints: [string, string][] } {
  const target = openTarget(lang, swiss);
  const hints = findTerms(source, lang, 10).map((h): [string, string] => [
    h.surface,
    target === "de-ch" ? h[lang][0][0].replace(/ß/g, "ss") : h[lang][0][0],
  ]);
  const lines = [
    `Translate the following French watchmaking text into ${LANG_NAMES[target]}, in the house style of a haute horlogerie magazine.`,
  ];
  if (hints.length) {
    lines.push("Use this terminology:", ...hints.map(([fr, tgt]) => `- ${fr} → ${tgt}`));
  }
  lines.push("", source);
  return { user: lines.join("\n"), hints };
}
