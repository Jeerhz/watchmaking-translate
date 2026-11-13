"""The one prompt the fine-tuned model sees, in training, evaluation and serving."""

from pydantic import BaseModel

# "de-ch" is GMT's own German (the magazine's German edition); "de" is brand-site German (ß).
LANG_NAMES: dict[str, str] = {
    "en": "British English",
    "de": "German",
    "de-ch": "Swiss Standard German (ss, never ß; «» quotes)",
}


class TermHint(BaseModel):
    fr: str
    tgt: str


def user_prompt(src: str, lang: str, hints: list[TermHint] | None = None) -> str:
    lines = [
        f"Translate the following French watchmaking text into {LANG_NAMES[lang]}, "
        "in the house style of a haute horlogerie magazine."
    ]
    if hints:
        lines.append("Use this terminology:")
        lines.extend(f"- {h.fr} → {h.tgt}" for h in hints)
    lines += ["", src]
    return "\n".join(lines)
