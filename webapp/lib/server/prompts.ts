// Prompt assembly — the templates themselves come from trad_gmt/mt/prompts.py via the bundle,
// so the app and the batch pipeline send the same text.

import { CATEGORIES, LANG_NAME, TARGETS, type Decision, type Diagnosis, type Example, type Lang, type Off, type Src, type TermHit } from "../types";
import { getEngine } from "./engine";
import { STYLE_DE_FROM_EN, STYLE_FR } from "./style-en-source";

const SOURCE_LABEL: Record<string, string> = {
  gmt: "GMT usage",
  berner: "FH Berner",
  patek: "Patek Philippe",
  fhh: "FHH",
  wikidata: "Wikidata",
};

/** The templates are written for a French source. For an English source the same templates are
 *  used with the source language renamed, so the French-source prompts stay exactly as measured.
 *  Apply before fill(): the fields (target name, style guide, texts) must not be touched. */
export function forSource(tpl: string, src: Src): string {
  if (src === "fr") return tpl;
  return tpl
    .replace(/French/g, "English")
    .replace(/lang="fr"/g, 'lang="en"')
    .replace("(nuit, phase…)", "(night, phase…)");
}

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
      return `- ${h.term} → ${parts.join(" | ")}`;
    })
    .join("\n");
}

export function renderExamples(examples: Example[], lang: Lang, src: Src = "fr"): string {
  if (!examples.length) return "(no example)";
  const code = lang.toUpperCase();
  const from = src.toUpperCase();
  return examples
    .map((e) => `[${e.pool === "style" ? "GMT" : "industry"}]\n${from}: ${e.src}\n${code}: ${e.tgt}`)
    .join("\n\n");
}

const VARIETY: Record<Lang, (swiss: boolean) => string> = {
  en: () => "Write British English.\n",
  de: (swiss) => (swiss ? "Write Swiss Standard German (ss, never ß).\n" : "Write German as used in Germany.\n"),
  fr: () => "Write French as published in French-speaking Switzerland.\n",
};

/** Everything the model is told about the rest of the article: the French original, the term
 *  choices already made, and the end of the translation so far. Each block explains itself,
 *  so the bundled system prompts need no change. */
export function renderContext(o: { context?: string | null; article?: string | null; decisions?: Decision[] }, lang: Lang, src: Src = "fr"): string {
  const blocks: string[] = [];
  const from = LANG_NAME[src];
  if (o.article?.trim()) {
    blocks.push(
      `<article lang="${src}" note="The whole ${from} article this part belongs to, for understanding only: who and what is being discussed, what comes before and after. Translate only <source>.">\n${o.article.trim()}\n</article>`,
    );
  }
  if (o.decisions?.length) {
    blocks.push(
      `<decisions note="Choices already made earlier in this article. Reuse exactly these ${LANG_NAME[lang]} renderings for the same ${from} terms and names, so the article stays consistent.">\n` +
        o.decisions.map((d) => `- ${d.src} → ${d.tgt}`).join("\n") +
        "\n</decisions>",
    );
  }
  if (o.context?.trim()) blocks.push(`<context>\n${o.context.trim()}\n</context>`);
  return blocks.length ? "\n" + blocks.join("\n\n") + "\n" : "";
}

export function fields(
  source: string,
  lang: Lang,
  hits: TermHit[],
  examples: Example[],
  ctx: { context?: string | null; article?: string | null; decisions?: Decision[] },
  swiss: boolean,
  off: Off[] = [],
  src: Src = "fr",
): Record<string, string> {
  const { bundle } = getEngine();
  const variety = lang === "de" ? (swiss ? bundle.swiss_de : bundle.germany_de ?? "") : "";
  // the guides give their cues in the source language, so each direction has its own
  const guide = lang === "fr" ? STYLE_FR : src === "en" ? STYLE_DE_FROM_EN : bundle.style[lang];
  const style = guide + variety;
  return {
    target: lang,
    target_name: LANG_NAME[lang],
    style_guide: off.includes("style") ? VARIETY[lang](swiss) : style,
    glossary: renderGlossary(off.includes("termbase") ? [] : hits, lang),
    examples: renderExamples(off.includes("examples") ? [] : examples, lang, src),
    context: renderContext(ctx, lang, src),
    source,
  };
}

// ---------------------------------------------------------------------------------------------
// The editor, in two passes (Diagnose, Then Repair — Wang & Wu, ACL 2026 Industry): first list
// the errors as MQM spans, then repair only those spans. The desk applies the replacements
// itself, so nothing outside a diagnosed span can change, and drops any edit that makes the
// automatic checks worse (MQM-APE, TEaR).

export const DIAGNOSE_SYSTEM = `You are the chief sub-editor of GMT Publishing (GMT Magazine, WorldTempus). You are given a French watchmaking text and a {target_name} draft translation. In this pass you diagnose; you do not rewrite. List every error that must be corrected before publication, and nothing else.

{style_guide}
Error categories
- accuracy: mistranslation, omission, addition, wrong figure, unit, name or reference, text left in French.
- terminology: a watchmaking term that departs from <glossary> (first equivalent, right sense), contradicts <decisions> or is used inconsistently; generic wording where a precise technical term exists.
- style: departs from the house style above or from the voice of the GMT <examples>: wrong register, press-release tone, a calque of French syntax.
- fluency: grammar, idiom, or phrasing a native {target_name} watch journalist would not write.
- typography: spelling variant, punctuation, quotation marks, number and unit formats of the house style.

Severity
- critical: changes a fact (figure, reference, name, reversed meaning) or leaves text untranslated.
- major: a reader would notice it: wrong term, distorted meaning, clearly unidiomatic sentence, a visible breach of the house style.
- minor: small polish that does not affect understanding.

Rules
- Quote each error span verbatim from the draft, character for character. Keep it as short as possible but long enough to occur only once in the draft: a few words, at most one sentence.
- Report only real errors. A correct sentence that you would merely have phrased differently is not an error. If the draft is ready for publication, return an empty list.
- <qa_flags>, when present, come from automatic string checks and are often false alarms (a legitimate inflection, compound or synonym, an intentional recasting, a figure written out in words). Give a verdict on each flag: "fixed" if it is a real error (then also list it among the errors), "kept" if the draft is right.`;

export const DIAGNOSE_USER = `<glossary>
{glossary}
</glossary>

<examples>
{examples}
</examples>
{context}
<source lang="fr">
{source}
</source>

<draft lang="{target}">
{draft}
</draft>
{notes}
Return JSON: {{"errors": [{{"span": "<verbatim draft wording>", "category": "accuracy|terminology|style|fluency|typography", "severity": "minor|major|critical", "explanation": "<what is wrong and what it should say>"}}], "verdicts": [{{"check": "<the flag, verbatim>", "action": "fixed|kept", "reason": "<why>"}}]}}. Use empty lists when there is nothing to report.`;

export const REPAIR_SYSTEM = `You are the chief sub-editor of GMT Publishing (GMT Magazine, WorldTempus). A {target_name} draft translation of a French watchmaking text has been checked, and the errors to correct are listed in <errors>. In this pass you repair them, under an edit contract.

{style_guide}
Edit contract
- Change only the diagnosed spans, plus the few neighbouring words grammar requires. Everything else in the draft stays exactly as it is.
- One edit per error: the smallest replacement that corrects it, following <glossary>, <decisions>, the house style and the voice of the GMT <examples>.
- "before" is copied verbatim from the draft, character for character, and must occur only once in it; "after" is the wording that replaces it. Never include a paragraph break in either.
- If a listed error turns out not to be one, or cannot be corrected without rewriting text that is right, leave it out.`;

export const REPAIR_USER = `<glossary>
{glossary}
</glossary>

<examples>
{examples}
</examples>
{context}
<source lang="fr">
{source}
</source>

<draft lang="{target}">
{draft}
</draft>

<errors>
{errors}
</errors>
{notes}
Return JSON: {{"edits": [{{"error": <number of the error in the list>, "before": "<verbatim draft wording>", "after": "<replacement>", "reason": "<short explanation>"}}]}}.`;

const VERDICTS = {
  type: "array",
  items: {
    type: "object",
    properties: { check: { type: "string" }, action: { type: "string", enum: ["fixed", "kept"] }, reason: { type: "string" } },
    required: ["check", "action", "reason"],
    additionalProperties: false,
  },
};

export const DIAGNOSE_SCHEMA = {
  type: "object",
  properties: {
    errors: {
      type: "array",
      items: {
        type: "object",
        properties: {
          span: { type: "string" },
          category: { type: "string", enum: CATEGORIES },
          severity: { type: "string", enum: ["minor", "major", "critical"] },
          explanation: { type: "string" },
        },
        required: ["span", "category", "severity", "explanation"],
        additionalProperties: false,
      },
    },
    verdicts: VERDICTS,
  },
  required: ["errors", "verdicts"],
  additionalProperties: false,
};

export const REPAIR_SCHEMA = {
  type: "object",
  properties: {
    edits: {
      type: "array",
      items: {
        type: "object",
        properties: { error: { type: "integer" }, before: { type: "string" }, after: { type: "string" }, reason: { type: "string" } },
        required: ["error", "before", "after", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["edits"],
  additionalProperties: false,
};

export function renderErrors(errors: Diagnosis[]): string {
  return errors.map((e, i) => `${i + 1}. [${e.category}, ${e.severity}] “${e.span}” — ${e.explanation}`).join("\n") || "(none)";
}

// ---------------------------------------------------------------------------------------------
// Term pruning: the termbase lookup is a longest string match, so it also catches ordinary words
// (“approche”, “soleil”, “nuit”). One cheap call removes those before any prompt or check uses them.

const PRUNE_FR = `You prepare terminology for translators of French watchmaking journalism. A dictionary lookup matched the entries below in a French text by string matching alone. Decide which matches are spurious: the French word or phrase is NOT used in the text in the technical or watchmaking sense the dictionary entry describes — it is an ordinary word (for example “approche” meaning approach, “soleil” meaning the sun, “nuit” in “bleu nuit”), part of a name, or part of a different expression.

List only the entries that are clearly spurious. When in doubt, keep the entry: a missing term costs more than an extra one.`;

const PRUNE_EN = `You prepare terminology for translators of English watchmaking journalism. A dictionary lookup matched the entries below in an English text by string matching alone. Decide which matches are spurious: the English word or phrase is NOT used in the text in the technical or watchmaking sense the dictionary entry describes — it is an ordinary word (for example “train” meaning a railway train, “bridge” meaning a river bridge, “spring” meaning the season, “second” meaning the ordinal), part of a name, or part of a different expression.

List only the entries that are clearly spurious. When in doubt, keep the entry: a missing term costs more than an extra one.`;

export const PRUNE_SYSTEM: Record<Src, string> = { fr: PRUNE_FR, en: PRUNE_EN };

export const PRUNE_SCHEMA = {
  type: "object",
  properties: {
    drop: {
      type: "array",
      items: {
        type: "object",
        properties: { n: { type: "integer" }, reason: { type: "string" } },
        required: ["n", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["drop"],
  additionalProperties: false,
};

export function pruneUser(text: string, hits: TermHit[], src: Src = "fr"): string {
  const rows = hits.map((h, i) => {
    const t = (lang: Lang) => h[lang].slice(0, 2).map((x) => x[0] + (x[3] ? ` (${x[3]})` : "")).join(" / ") || "—";
    return `${i + 1}. “${h.surface}” [entry: ${h.term}] → ${TARGETS[src].map((l) => `${l.toUpperCase()}: ${t(l)}`).join(" · ")}`;
  });
  return `<text lang="${src}">\n${text}\n</text>\n\n<matches>\n${rows.join("\n")}\n</matches>\n\nReturn JSON: {"drop": [{"n": <number of the match>, "reason": "<a few words>"}]}. Use an empty list if every match is used in its technical sense.`;
}
