// Prompt assembly — the templates themselves come from trad_gmt/mt/prompts.py via the bundle,
// so the app and the batch pipeline send the same text.

import { LANG_NAME, type Example, type Lang, type TermHit } from "../types";
import { getEngine } from "./engine";

const SOURCE_LABEL: Record<string, string> = {
  gmt: "GMT usage",
  berner: "FH Berner",
  patek: "Patek Philippe",
  fhh: "FHH",
  wikidata: "Wikidata",
};

export function fill(tpl: string, f: Record<string, string>): string {
  return tpl.replace(/\{\{|\}\}|\{(\w+)\}/g, (m, k: string | undefined) =>
    m === "{{" ? "{" : m === "}}" ? "}" : k !== undefined && k in f ? f[k] : m,
  );
}

export function renderGlossary(hits: TermHit[], lang: Lang): string {
  if (!hits.length) return "(no glossary term found)";
  return hits
    .map((h) => {
      const t = h[lang];
      const homonyms = t.length > 1 && new Set(t.map((x) => x[3])).size > 1;
      const parts = t
        .slice(0, 4)
        .map((x) => `${x[0]} [${SOURCE_LABEL[x[1]] ?? x[1]}]` + (homonyms && x[3] ? ` — ${x[3]}` : ""));
      return `- ${h.fr} → ${parts.join(" | ")}`;
    })
    .join("\n");
}

export function renderExamples(examples: Example[], lang: Lang): string {
  if (!examples.length) return "(no example)";
  const code = lang.toUpperCase();
  return examples
    .map((e) => `[${e.pool === "style" ? "GMT" : "industry"}]\nFR: ${e.fr}\n${code}: ${e.tgt}`)
    .join("\n\n");
}

export function fields(
  source: string,
  lang: Lang,
  hits: TermHit[],
  examples: Example[],
  context: string | null | undefined,
  swiss: boolean,
): Record<string, string> {
  const { bundle } = getEngine();
  return {
    target: lang,
    target_name: LANG_NAME[lang],
    style_guide: bundle.style[lang] + (lang === "de" && swiss ? bundle.swiss_de : ""),
    glossary: renderGlossary(hits, lang),
    examples: renderExamples(examples, lang),
    context: context ? `\n<context>\n${context}\n</context>\n` : "",
    source,
  };
}
