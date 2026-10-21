from trad_gmt.text import normalize, split_sentences


def test_split_protects_abbreviations() -> None:
    text = "Rythme cardiaque (p.ex. pouls). La montre subit un choc. Voir z.B. Uhr."
    assert split_sentences(text) == [
        "Rythme cardiaque (p.ex. pouls).",
        "La montre subit un choc.",
        "Voir z.B. Uhr.",
    ]


def test_split_keeps_french_quotes_and_decimals() -> None:
    text = "« Il dit. » Puis g vaut 9.80665 m/s². Fin."
    assert split_sentences(text) == ["« Il dit. »", "Puis g vaut 9.80665 m/s².", "Fin."]


def test_normalize_spaces() -> None:
    assert normalize("  montre : cadran  ") == "montre : cadran"
