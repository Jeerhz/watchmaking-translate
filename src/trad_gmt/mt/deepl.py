"""DeepL as a third system, customised with GMT's data (see docs/deepl-system.md).

Levers (DeepL API, Nov 2026): target EN-GB / DE-CH; a multilingual glossary (hard, inflected
by DeepL) built only from terms GMT's own translations render consistently; house style as a
style rule list (configured rules + stored instructions) and/or inline ``custom_instructions``
(≤ 10 per request, ≤ 300 chars); the remaining termbase hits as one-term soft instructions;
``context`` = the preceding French sentences of the article (free, not translated).
"""

import json
import logging
import os
from pathlib import Path
from collections import Counter, defaultdict

import httpx
from pydantic import BaseModel

from trad_gmt.io import DATA
from trad_gmt.mt.glossary import Glossary
from trad_gmt.mt.style import HOUSE_TERMS

log = logging.getLogger(__name__)

DEEPL_DIR = DATA / "deepl"
TARGET = {"en": "EN-GB", "de": "DE-CH"}  # GMT: British English, Swiss German

# Single words are glossary-safe only when they are watchmaking terms: everyday words
# ("approche", "presse", "orient") would be forced in idioms ("à l'approche de").
WATCH_WORDS = frozenset(
    """couronne boîte boîtier boite balancier échappement barillet pont roue rouage poussoir
    rehaut corne cornes guillochage came émail laque automate oscillateur silicium caoutchouc
    titane lunette cadran aiguille aiguilles rubis spiral platine ancre carrure fond""".split()
)
# Context-dependent or translated inconsistently by GMT itself: soft hints only.
NEVER_HARD = frozenset("platine fond index spiral ancre soleil épaisseur chronométrage".split()) | {
    "pièce unique",
    "pièces uniques",
    "chronographe mécanique",
    "chronographes mécaniques",
}
PROPER = ("Arabic", "Roman", "Maltese", "Gregorian", "Swiss", "GMT", "Genève", "Geneva")

# House style as DeepL instructions: one directive each, positive, ≤ 300 chars (DeepL guide).
# House style as DeepL instructions: one directive each, positive, ≤ 300 chars (DeepL guide).
# No concrete figures or materials in them: DeepL copies examples into the output
# ("18-carat white gold" in a rule turned "or gris" into "18-carat grey gold").
RULES: dict[str, list[str]] = {
    "en": [
        "Write polished British magazine English for watch collectors, in the register of the source.",
        "Use British spelling (colour, centre, calibre, jewellery, aluminium, programme).",
        "Write dial positions with o'clock.",
        "Keep brand, collection, model and calibre names exactly as in the source, with ™ and ®.",
        "Translate 'la Maison' and 'la Manufacture' as 'the Maison' and 'the Manufacture' when they refer to the brand.",
        "Use double curly quotation marks for quotations.",
    ],
    "de": [
        "Schreibe gewandtes Magazindeutsch für Uhrensammler im Register der Vorlage.",
        "Übersetze 'la Maison' als 'die Marke' oder 'das Haus'.",
        "Übersetze 'mouvement' als 'Werk'.",
        "Übersetze 'acier' als 'Stahl'.",
        "Belasse Marken-, Kollektions-, Modell- und Kalibernamen exakt wie in der Vorlage.",
    ],
}
# style rule list (one per account on the free plan): GMT English
EN_CONFIGURED = {
    "punctuation": {"sentence_break_indicator": "use_en_dash_with_space_on_either_side"},
    "numbers": {"units_of_measure_spacing": "use_space_between_numeral_and_unit_of_measure"},
}


class AttestedTerm(BaseModel):
    fr: str  # termbase French designation
    tgt: str  # the termbase target GMT uses most
    n: int  # GMT sentences whose French contains the term
    share: float  # share of them whose translation uses ``tgt``


def attested_terms(gl: Glossary, lang: str, sample: int = 80_000) -> list[AttestedTerm]:
    """How consistently GMT's own translations (house-style pool) follow each termbase entry."""
    path = DEEPL_DIR / f"attested_{lang}.json"
    if path.exists():
        return [AttestedTerm(**r) for r in json.loads(path.read_text())]
    from trad_gmt.ft.data import uses_term
    from trad_gmt.mt.resources import ResourceConfig, load_segments, select_pool

    df = select_pool(load_segments(ResourceConfig()), lang, "style", ResourceConfig())
    df = df.sample(min(sample, len(df)), random_state=0)
    seen: Counter[str] = Counter()
    used: dict[str, Counter[str]] = defaultdict(Counter)
    for fr, ref in zip(df.fr, df[lang], strict=True):
        for hit in gl.find(fr, lang):
            key = hit.entry.fr
            seen[key] += 1
            tgt = next((t.term for t in hit.targets(lang) if uses_term(ref, t.term)), None)
            used[key][tgt or ""] += 1
    out = []
    for key, n in seen.items():
        tgt, m = used[key].most_common(1)[0]
        if tgt:
            out.append(AttestedTerm(fr=key, tgt=tgt, n=n, share=m / n))
    DEEPL_DIR.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps([t.model_dump() for t in out], ensure_ascii=False, indent=0))
    return out


def _case(tgt: str, lang: str) -> str:
    """English common nouns lower-case ("Bridge" → "bridge"); German nouns keep their capital."""
    if lang == "en" and tgt[:1].isupper() and tgt[1:2].islower() and not tgt.startswith(PROPER):
        return tgt[0].lower() + tgt[1:]
    return tgt


def glossary_entries(
    terms: list[AttestedTerm], lang: str, min_share: float = 0.8
) -> dict[str, str]:
    """Hard terms: GMT house overrides + consistently translated multi-word or watch terms."""
    min_n = 8 if lang == "en" else 4
    out: dict[str, str] = {}
    for t in sorted(terms, key=lambda t: -t.n):
        fr = t.fr.lower()
        if t.n < min_n or t.share < min_share or fr in NEVER_HARD:
            continue
        if " " in fr or fr in WATCH_WORDS:
            out.setdefault(fr, _case(t.tgt, lang))
    for h in HOUSE_TERMS:
        out[h["fr"].lower()] = h[lang]
    if lang == "de":
        out = {k: v.replace("ß", "ss") for k, v in out.items()}  # the FR→DE dictionary serves DE-CH
    return out


def soft_instructions(
    gl: Glossary, text: str, lang: str, hard: dict[str, str], limit: int
) -> list[str]:
    """Watchmaking termbase hits the glossary does not cover, as one-term DeepL instructions.
    Everyday words the termbase also lists ("approche") are left to DeepL."""
    out = []
    for hit in gl.find(text, lang, limit=30):
        fr = hit.entry.fr.lower()
        if fr in hard or hit.surface.lower() in hard:
            continue
        if " " not in fr and fr not in WATCH_WORDS:
            continue
        tgt = hit.targets(lang)[0].term
        tgt = tgt.replace("ß", "ss") if lang == "de" else _case(tgt, lang)
        out.append(f"Translate '{hit.surface}' as '{tgt}'.")
        if len(out) == limit:
            break
    return out


class DeepL:
    """Minimal DeepL API client (free keys end in ':fx')."""

    def __init__(self, key: str | None = None) -> None:
        key = key or os.environ["DEEPL_API_KEY"]
        base = "https://api-free.deepl.com" if key.endswith(":fx") else "https://api.deepl.com"
        self.http = httpx.Client(
            base_url=base, headers={"Authorization": f"DeepL-Auth-Key {key}"}, timeout=120
        )

    def _call(self, method: str, path: str, **kw: object) -> dict:
        for attempt in range(5):
            r = self.http.request(method, path, **kw)
            if r.status_code in (429, 500, 503, 504, 529):
                import time

                time.sleep(2 * (attempt + 1))
                continue
            if r.status_code >= 400:
                raise RuntimeError(f"DeepL {r.status_code}: {r.text[:300]}")
            return r.json() if r.content else {}
        raise RuntimeError(f"DeepL {r.status_code} after retries")

    def usage(self) -> dict:
        return self._call("GET", "/v2/usage")

    def translate(
        self,
        text: str,
        lang: str,
        *,
        glossary_id: str | None = None,
        style_id: str | None = None,
        instructions: list[str] | None = None,
        context: str | None = None,
    ) -> str:
        body: dict[str, object] = {
            "text": [text],
            "source_lang": "FR",
            "target_lang": TARGET[lang],
            "model_type": "quality_optimized",
            "preserve_formatting": True,
            "formality": "prefer_more",
        }
        if glossary_id:
            body["glossary_id"] = glossary_id
        if style_id:
            body["style_id"] = style_id
        if instructions:
            body["custom_instructions"] = [i[:300] for i in instructions[:10]]
        if context:
            body["context"] = context
        return self._call("POST", "/v2/translate", json=body)["translations"][0]["text"]

    def replace_glossary(self, name: str, dictionaries: dict[str, dict[str, str]]) -> str:
        """(Re)create the one GMT glossary: a FR→lang dictionary per target."""
        for g in self._call("GET", "/v3/glossaries")["glossaries"]:
            if g["name"] == name:
                self._call("DELETE", f"/v3/glossaries/{g['glossary_id']}")
        dicts = [
            {
                "source_lang": "fr",
                "target_lang": lang,
                "entries": "\n".join(f"{fr}\t{tgt}" for fr, tgt in entries.items()),
                "entries_format": "tsv",
            }
            for lang, entries in dictionaries.items()
        ]
        return self._call("POST", "/v3/glossaries", json={"name": name, "dictionaries": dicts})[
            "glossary_id"
        ]

    def replace_style(self, name: str, language: str, configured: dict, rules: list[str]) -> str:
        for s in self._call("GET", "/v3/style_rules")["style_rules"]:
            if s["name"] == name:
                self._call("DELETE", f"/v3/style_rules/{s['style_id']}")
        body = {
            "name": name,
            "language": language,
            "configured_rules": configured,
            "custom_instructions": [
                {"label": f"GMT {i + 1}", "prompt": r, "source_language": "fr"}
                for i, r in enumerate(rules)
            ],
        }
        return self._call("POST", "/v3/style_rules", json=body)["style_id"]


class Setup(BaseModel):
    glossary_id: str
    style_en: str | None = None
    n_terms: dict[str, int]


def setup(client: DeepL, gl: Glossary) -> Setup:
    """Create the GMT glossary (FR→EN, FR→DE) and the GMT English style rule list."""
    dicts = {lang: glossary_entries(attested_terms(gl, lang), lang) for lang in ("en", "de")}
    DEEPL_DIR.mkdir(parents=True, exist_ok=True)
    for lang, d in dicts.items():
        (DEEPL_DIR / f"glossary_{lang}.tsv").write_text(
            "".join(f"{k}\t{v}\n" for k, v in d.items())
        )
    gid = client.replace_glossary("GMT watchmaking", dicts)
    try:
        sid = client.replace_style("GMT English", "en", EN_CONFIGURED, RULES["en"])
    except RuntimeError as e:  # plan without style rules: fall back to inline instructions
        log.warning("style rules unavailable: %s", e)
        sid = None
    s = Setup(glossary_id=gid, style_en=sid, n_terms={k: len(v) for k, v in dicts.items()})
    (DEEPL_DIR / "setup.json").write_text(s.model_dump_json(indent=1))
    return s


def load_setup() -> Setup:
    return Setup.model_validate_json((DEEPL_DIR / "setup.json").read_text())


WEB_CONFIG = Path(__file__).resolve().parents[3] / "webapp" / "lib" / "deepl-setup.json"


def export_web_config(gl: Glossary, out: Path = WEB_CONFIG) -> Path:
    """What the desk's /api/deepl needs: resource IDs, hard terms (excluded from soft hints),
    house rules and the watch-word whitelist. IDs are not secrets; the API key stays in env."""
    s = load_setup()
    cfg = {
        "glossary_id": s.glossary_id,
        "style_en": s.style_en,
        "target": TARGET,
        "hard": {
            lang: sorted(glossary_entries(attested_terms(gl, lang), lang)) for lang in ("en", "de")
        },
        "rules": RULES,
        "watch_words": sorted(WATCH_WORDS),
    }
    out.write_text(json.dumps(cfg, ensure_ascii=False, indent=1) + "\n")
    return out
