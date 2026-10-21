"""Helpers shared by web collectors: paragraph → sentence alignment of documents."""

from trad_gmt.align import SentenceAligner
from trad_gmt.schemas import ParallelSegment
from trad_gmt.text import guess_lang, split_sentences


def align_document(
    source: str,
    doc_id: str,
    paragraphs: dict[str, list[str]],
    aligner: SentenceAligner,
    url: str | None = None,
) -> list[ParallelSegment]:
    """Sentence-align one document given its paragraphs in fr + target languages.

    When every language has the same number of paragraphs, sentences are aligned
    inside each paragraph pair (tighter search space); otherwise across the whole
    document. Rows keep the French span and whatever targets aligned to it.
    """
    if "fr" not in paragraphs or len(paragraphs) < 2:
        return []
    split = {lang: [split_sentences(p) for p in paras] for lang, paras in paragraphs.items()}
    aligner.warm([s for paras in split.values() for s in paras])

    if len({len(p) for p in split.values()}) == 1:
        units = [{lang: paras[k] for lang, paras in split.items()} for k in range(len(split["fr"]))]
    else:
        units = [{lang: [s for p in paras for s in p] for lang, paras in split.items()}]

    segments: list[ParallelSegment] = []
    for u, unit in enumerate(units):
        targets = {lang: sents for lang, sents in unit.items() if lang != "fr"}
        for j, link in enumerate(aligner.align_pivot(unit["fr"], targets)):
            if guess_lang(link.fr) not in (None, "fr"):
                continue
            link.targets = {
                lang: t
                for lang, t in link.targets.items()
                if guess_lang(t) in (None, lang) and t != link.fr
            }
            if not link.targets:
                continue
            segments.append(
                ParallelSegment(
                    id=f"{doc_id}:{u}.{j}",
                    source=source,
                    doc_id=doc_id,
                    granularity="sentence",
                    alignment="embedding",
                    score_en=link.scores.get("en") if "en" in link.targets else None,
                    score_de=link.scores.get("de") if "de" in link.targets else None,
                    fr=link.fr,
                    url=url,
                    **link.targets,
                )
            )
    return segments
