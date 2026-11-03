"""GMT Publishing house style for English and German watchmaking copy.

The English rules were measured on GMT's own translations (WorldTempus editorial
segments, ``type:maison-*`` / *GMT Magazine*, ≈190k sentences in the train split); the
counts in brackets are occurrences in that corpus, so the guide can be re-checked when
the data changes (``uv run trad-gmt style-stats``). There is no German GMT material in
the dataset yet (the magazine PDFs will bring it), so the German rules follow the
FH Berner dictionary and the German editions of the brand sites, which are the closest
published register.
"""

from collections.abc import Iterable

TARGET_NAMES: dict[str, str] = {"en": "English", "de": "German"}

STYLE_EN = """\
House style — GMT Publishing English (GMT Magazine, WorldTempus)

Voice
- Polished, knowledgeable magazine English for watch enthusiasts and collectors. Write as a
  native editor would, not as a translator: recast heavy French syntax, split very long
  sentences, drop French rhetorical padding only when English would sound inflated — but
  never drop information.
- Keep the register of the source: lyrical feature prose stays elegant; spec sheets,
  captions and technical lists stay terse and in list form ("Movement: self-winding
  calibre …; Case: 41 mm, titanium").
- Headings and titles in sentence case unless they are proper names.

Spelling and typography
- British spelling: colour, centre, calibre (never caliber), grey, jewellery, aluminium,
  programme, -ise verbs (realise, characterise).
- Curly quotes “…” for quotations (‘…’ inside them) and the curly apostrophe ’. French
  guillemets « » become “ ”.
- Spaced en dash " – " for parenthetical dashes (not em dashes). Remove French spaces
  before : ; ! ?
- Numbers: thousands with a comma, decimals with a point (28,800; 1.63 carats). Prices
  "CHF 16,800". Percent as "%".

Watchmaking conventions observed in GMT's translations
- "à 6 h" → "at 6 o’clock"; "3 h" (as a position) → "3 o’clock".
- Dimensions with a space: "41 mm"; as a compound adjective "a 41 mm case".
- "28 800 alt/h (4 Hz)" → "28,800 vibrations per hour (4 Hz)".
- "étanche à 100 m" → "water-resistant to 100 metres".
- "or gris/rose 18 carats" → "18-carat white/rose gold"; "70 heures de réserve de marche"
  → "a 70-hour power reserve".
- Preferred: timepiece (as variation for watch), hour-markers, self-winding (or
  automatic), balance spring, oscillating weight, moon phase, minute repeater,
  sapphire crystal, caseback, in-house movement, limited edition of 50 pieces.
- "la Manufacture" / "la Maison" for a brand → "the Manufacture" / "the Maison" (capitalised)
  when the source uses the institutional sense, otherwise "the brand".
- Brand, collection, model, calibre and material trade names stay exactly as in the source
  (Royal Oak Perpétuelle, Calibre 5134, Parachrom, Oystersteel), including ™/® symbols.
"""

STYLE_DE = """\
Hausstil — GMT Publishing Deutsch (Uhrenmagazin)

Stimme
- Gewandtes, sachkundiges Magazindeutsch für Uhrenliebhaber und Sammler. Natürlich formulieren
  wie ein deutschsprachiger Redakteur: französische Satzgefüge umbauen, Nominalstil vermeiden,
  aber keine Information weglassen.
- Register der Vorlage beibehalten: Reportagen elegant und flüssig, technische Datenblätter
  knapp und als Liste ("Werk: Automatikkaliber …; Gehäuse: 41 mm, Titan").
- Leserinnen und Leser werden, falls nötig, mit "Sie" angesprochen.

Rechtschreibung und Typografie
- Standardhochdeutsch mit ß (außer der Auftrag verlangt Schweizer Rechtschreibung mit "ss").
- Deutsche Anführungszeichen „…“ (innen ‚…‘); französische « » werden zu „ “.
- Gedankenstrich mit Leerzeichen " – ".
- Zahlen: Dezimalkomma (1,63 Karat); Tausender mit Punkt (28.800). Preise "CHF 16’800".
- Maße mit Leerzeichen: "41 mm"; als Kompositum mit Bindestrichen: "das 41-mm-Gehäuse".

Uhrmacherische Konventionen (Berner-Wörterbuch, deutschsprachige Markenseiten)
- "à 6 h" → "bei 6 Uhr"; "28 800 alt/h (4 Hz)" → "28.800 Halbschwingungen pro Stunde (4 Hz)".
- "étanche à 100 m" → "wasserdicht bis 100 m"; "or rose 18 carats" → "18 Karat Roségold"
  bzw. "aus 18-karätigem Roségold".
- Bevorzugt: Uhrwerk / Kaliber, Automatikwerk (Selbstaufzug), Gangreserve, Unruh,
  Spiralfeder, Ankerhemmung, Schwungmasse (Rotor), Mondphase, ewiger Kalender,
  Minutenrepetition, Saphirglas, Gehäuseboden (Saphirglasboden), Zifferblatt, Indizes,
  Lünette, Manufakturkaliber, limitierte Auflage von 50 Exemplaren.
- "la Manufacture" → "die Manufaktur"; "la Maison" im institutionellen Sinn → "die Maison".
- Marken-, Kollektions-, Modell-, Kaliber- und Materialnamen exakt wie in der Vorlage
  belassen (Royal Oak Perpétuelle, Calibre 5134, Parachrom), inklusive ™/®.
"""

SWISS_DE = "\n- Auftrag: Schweizer Rechtschreibung — kein ß, sondern ss (gross, schliesslich)."


def style_guide(lang: str, swiss_german: bool = False) -> str:
    if lang == "en":
        return STYLE_EN
    if lang == "de":
        return STYLE_DE + (SWISS_DE if swiss_german else "")
    raise ValueError(f"unsupported target language {lang!r}")


# (label, regex) pairs re-measured by ``trad-gmt style-stats`` on GMT's English.
EN_STYLE_PROBES: tuple[tuple[str, str], ...] = (
    ("colour", r"\bcolour"),
    ("color", r"\bcolor\b"),
    ("calibre", r"\b[Cc]alibre\b"),
    ("caliber", r"\b[Cc]aliber\b"),
    ("grey", r"\bgrey"),
    ("gray", r"\bgray"),
    ("o’clock", r"o[’']clock"),
    ("“ curly", r"“"),
    ('" straight', r'"'),
    ("spaced en dash", r" – "),
    ("em dash", r"—"),
    ("41 mm (spaced)", r"\d mm\b"),
    ("41mm", r"\dmm\b"),
    ("metres", r"\bmetres\b"),
    ("meters", r"\bmeters\b"),
    ("vibrations per hour", r"vibrations per hour"),
    ("vph", r"\bvph\b"),
)


def style_stats(sentences: Iterable[str]) -> dict[str, int]:
    import re

    text = "\n".join(sentences)
    return {label: len(re.findall(pattern, text)) for label, pattern in EN_STYLE_PROBES}


# House usage that overrides the termbase where GMT's published texts consistently differ
# from it. Counts: occurrences in GMT's English editorial translations (train split) and,
# for German, in the German brand pages (no GMT German yet). Ranked above FH Berner.
HOUSE_TERMS: tuple[dict[str, str], ...] = (
    # "lugs" 854 vs "horns" 125 (Berner: horn); Bandanstöße 61 vs Hörner 2
    {"fr": "cornes", "en": "lugs", "de": "Bandanstöße"},
    {"fr": "corne", "en": "lug", "de": "Bandanstoß"},
    # "white gold" 1,637 vs "grey gold" 17; Weißgold 720
    {"fr": "or gris", "en": "white gold", "de": "Weißgold"},
    {"fr": "or blanc", "en": "white gold", "de": "Weißgold"},
    # "rose gold" 1,509 vs "pink gold" 1,013; Roségold 508 vs Rotgold 140
    {"fr": "or rose", "en": "rose gold", "de": "Roségold"},
    # "Côtes de Genève" 324 vs "Geneva stripes" 33; Genfer Streifen 16 vs Côtes de Genève 12
    {"fr": "Côtes de Genève", "en": "Côtes de Genève", "de": "Genfer Streifen"},
    # "small seconds" 870; kleine Sekunde 36
    {"fr": "petite seconde", "en": "small seconds", "de": "kleine Sekunde"},
    # "self-winding" 1,511 vs "automatic winding" 278; Automatikaufzug 72 vs Selbstaufzug 29
    {"fr": "remontage automatique", "en": "self-winding", "de": "Automatikaufzug"},
    # "limited edition" 1,733 vs "limited series" 537; limitierte Auflage 17
    {"fr": "série limitée", "en": "limited edition", "de": "limitierte Auflage"},
    {"fr": "édition limitée", "en": "limited edition", "de": "limitierte Auflage"},
)
