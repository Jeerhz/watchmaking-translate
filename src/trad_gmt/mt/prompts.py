"""Prompt templates for the draft and review passes.

Templates use ``{placeholder}`` fields and are exported verbatim to the web demo
(``trad-gmt export-web``), so the browser and the API pipeline send the same text.
"""

from collections.abc import Sequence

from trad_gmt.mt.glossary import SOURCE_LABEL, Hit
from trad_gmt.mt.memory import Example
from trad_gmt.mt.style import TARGET_NAMES

TRANSLATE_SYSTEM = """\
You are a senior translator at GMT Publishing in Geneva, publisher of GMT Magazine and \
WorldTempus. You translate French watchmaking journalism (features, novelty reviews, \
interviews, spec sheets, press texts) into {target_name} for publication.

{style_guide}
How to use the material supplied with each text
- <glossary>: approved terminology, in order of authority: "GMT usage" (GMT Publishing's \
established house choices), the FH Berner professional dictionary (the industry reference), \
Patek Philippe, the Fondation de la Haute Horlogerie and Wikidata. When a listed French term \
is used in its watchmaking sense, render it with the first listed equivalent unless it is \
clearly the wrong sense; definitions are given to tell homonyms apart. Ordinary words that \
happen to be listed (nuit, phase…) are translated naturally. Use one equivalent consistently \
for one concept throughout the text.
- <examples>: sentences already published by GMT Publishing ("GMT") or by the industry \
("industry"), with their French source. Reuse their phrasing, terminology and rhythm where \
they fit — they show the house voice — but translate the new text faithfully; never copy \
facts from an example.
- <context>, when present, is the end of the previous part of the same article, already \
translated: continue consistently with it.

Faithfulness
- Translate everything; add nothing. Keep every figure, unit, date, price, reference number, \
name and quotation. Convert number and unit formatting to the house style only.
- Keep the paragraph structure: one output paragraph per source paragraph, blank lines between \
paragraphs, headings and list items kept as headings and list items.
- Output only the {target_name} translation — no preamble, notes or quotes around it.\
"""

TRANSLATE_USER = """\
<glossary>
{glossary}
</glossary>

<examples>
{examples}
</examples>
{context}
<source lang="fr">
{source}
</source>

Translate the source into {target_name}.\
"""

REVIEW_SYSTEM = """\
You are the chief sub-editor of GMT Publishing (GMT Magazine, WorldTempus). A translator has \
produced a {target_name} draft of a French watchmaking text. Your job is to make it \
publication-ready in the house style.

{style_guide}
Check the draft against the source, sentence by sentence:
1. Accuracy — mistranslations, omissions, additions, wrong figures, units, names or references.
2. Terminology — watchmaking terms must follow <glossary> (first equivalent, right sense) and \
be used consistently; generic wording where a precise technical term exists is an error.
3. House style — spelling, typography, number and unit formats, conventions above, and the \
phrasing seen in <examples> (GMT's own published translations).
4. Fluency — it must read as if written by a native {target_name} watch journalist.

Correct only what needs correcting; keep sentences that are already right. Preserve the \
paragraph structure exactly.\
"""

REVIEW_USER = """\
<glossary>
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

Return JSON: {{"translation": "<the final {target_name} text>", "changes": [{{"before": \
"<draft wording>", "after": "<your wording>", "reason": "<accuracy|terminology|style|fluency: \
short explanation>"}}]}}. Use an empty "changes" list if the draft needs no correction.\
"""

REVIEW_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "translation": {"type": "string"},
        "changes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "before": {"type": "string"},
                    "after": {"type": "string"},
                    "reason": {"type": "string"},
                },
                "required": ["before", "after", "reason"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["translation", "changes"],
    "additionalProperties": False,
}

POOL_LABEL: dict[str, str] = {"style": "GMT", "domain": "industry"}


def render_glossary(hits: Sequence[Hit], lang: str) -> str:
    if not hits:
        return "(no glossary term found)"
    lines: list[str] = []
    for hit in hits:
        targets = hit.targets(lang)
        homonyms = len(targets) > 1 and len({t.definition for t in targets}) > 1
        parts = []
        for t in targets[:4]:
            part = f"{t.term} [{SOURCE_LABEL.get(t.source, t.source)}]"
            if homonyms and t.definition:
                part += f" — {t.definition}"
            parts.append(part)
        lines.append(f"- {hit.entry.fr} → " + " | ".join(parts))
    return "\n".join(lines)


def render_examples(examples: Sequence[Example], lang: str) -> str:
    if not examples:
        return "(no example)"
    code = lang.upper()
    return "\n\n".join(
        f"[{POOL_LABEL.get(e.pool, e.pool)}]\nFR: {e.fr}\n{code}: {e.tgt}" for e in examples
    )


def render_context(context: str | None) -> str:
    return f"\n<context>\n{context}\n</context>\n" if context else ""


def fill(template: str, **fields: str) -> str:
    return template.format(**fields)


def target_name(lang: str) -> str:
    return TARGET_NAMES[lang]
