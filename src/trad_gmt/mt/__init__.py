"""Glossary- and memory-constrained FR → EN / DE translation in GMT Publishing's house style.

Pipeline (see ``translator.Translator``):

1. ``glossary.Glossary`` finds every watchmaking term of the source in the FH Berner /
   Patek / FHH / Wikidata termbase and lists the approved target designations.
2. ``memory.TranslationMemory`` retrieves, per paragraph, the closest French sentences
   already translated by GMT (WorldTempus editorial) and by the brands / FH, so the
   model imitates the house phrasing.
3. ``prompts`` assembles the GMT style guide, the glossary block and the examples.
4. Claude drafts the translation, then a second editor pass checks accuracy,
   terminology and style against the same evidence and returns the final text.
"""
