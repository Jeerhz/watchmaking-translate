from trad_gmt.sources.berner import LangEntry, _aligned_segments, _aligned_terms, parse_entry

FR = (
    '<h2><span id="ActiveWord" class="word">accélération</span> n. f.</h2>'
    '<ul class="translations"><li class="flagEN" data-id="7" data-lang="en">'
    "<strong>acceleration</strong> n. </li></ul>"
    '<p>Augmentation de la <a class="word-link" data-id="1">vitesse</a> [s<sup>2</sup>]. '
    "<br /><br />"
    "<strong>accélération linéaire:</strong> grandeur physique. Lors d'un choc, la montre "
    "subit une accélération.</p>"
    '<span style="color:#FFF">(7)</span><hr /><h2><span class="word">autre</span></h2>'
    '<p>Autre.</p><span style="color:#FFF">(8)</span>'
)
EN = (
    '<h2><span class="word">acceleration</span> n.</h2>'
    "<p>Increase in speed [s<sup>2</sup>]. <br /><br />"
    "<strong>linear acceleration:</strong> physical magnitude. In the event of a shock, "
    "a watch will undergo acceleration.</p>"
    '<span style="color:#FFF">(7)</span>'
)


def _entries() -> dict[str, LangEntry]:
    fr = parse_entry(FR, 7, "fr")
    en = parse_entry(EN, 7, "en")
    assert fr is not None and en is not None
    return {"fr": fr, "en": en}


def test_parse_entry_picks_right_homograph_and_blocks() -> None:
    fr = _entries()["fr"]
    assert fr.headword == "accélération"
    assert fr.pos == "n. f."
    assert [b.terms for b in fr.blocks] == [[], ["accélération linéaire"]]
    assert fr.blocks[0].text == "Augmentation de la vitesse [s²]."


def test_aligned_terms_include_sub_entries() -> None:
    terms = _aligned_terms(7, _entries())
    assert [(t.fr, t.en) for t in terms] == [
        ("accélération", "acceleration"),
        ("accélération linéaire", "linear acceleration"),
    ]
    assert terms[1].parent_id == "berner:7"


def test_aligned_segments_sentence_level() -> None:
    segs = _aligned_segments(7, _entries())
    assert [(s.granularity, s.fr) for s in segs] == [
        ("sentence", "Augmentation de la vitesse [s²]."),
        ("sentence", "grandeur physique."),
        ("sentence", "Lors d'un choc, la montre subit une accélération."),
    ]
    assert segs[2].en == "In the event of a shock, a watch will undergo acceleration."
