import json
from types import SimpleNamespace

from trad_gmt.mt import prompts
from trad_gmt.mt.glossary import Glossary
from trad_gmt.mt.memory import Example, MemoryPool, TranslationMemory
from trad_gmt.mt.resources import Resources
from trad_gmt.mt.textnorm import content_tokens, tokens
from trad_gmt.mt.translator import TranslateConfig, Translator, chunk_paragraphs

TERMS = [
    {
        "fr": "échappement à ancre",
        "en": "lever escapement",
        "de": "Ankerhemmung",
        "source": "berner",
        "priority": 1,
    },
    {"fr": "échappement", "en": "escapement", "de": "Hemmung", "source": "berner", "priority": 1},
    {"fr": "Le cadran", "en": "The dial", "source": "fhh", "priority": 3},
    {
        "fr": "réserve de marche",
        "en": "power reserve",
        "de": "Gangreserve",
        "source": "berner",
        "priority": 1,
    },
    {"fr": "réserve de marche", "en": "Shape", "source": "fhh", "priority": 3},
    {
        "fr": "Jour/Nuit, Tourbillon volant",
        "en": "Day/Night, Flying tourbillon",
        "source": "fhh",
        "priority": 3,
    },
    {
        "fr": "pont",
        "en": "bridge",
        "source": "berner",
        "priority": 1,
        "definition_en": "Part of the movement frame",
    },
    {
        "fr": "pont",
        "en": "cock",
        "source": "berner",
        "priority": 1,
        "definition_en": "Bridge with one point of support",
    },
]


def test_tokens_fold_accents_elisions_and_plurals() -> None:
    assert tokens("L’Échappement des cristaux") == ["l", "echappement", "des", "cristal"]
    assert "nous" not in content_tokens("nous plus dans") and content_tokens("nous") == []


def test_glossary_longest_match_articles_and_priority() -> None:
    g = Glossary.from_rows(TERMS)
    text = "Son échappement à ancre et les cadrans offrent 70 h de réserve de marche."
    hits = {h.entry.fr: h for h in g.find(text, "en")}
    assert "échappement à ancre" in hits and "échappement" not in hits  # longest match wins
    assert hits["cadran"].targets("en")[0].term == "dial"  # article dropped, plural matched
    assert [t.term for t in hits["réserve de marche"].targets("en")] == ["power reserve"]
    assert not any("," in fr for fr in g.entries)  # spec-sheet lists skipped
    assert "cadran" not in {h.entry.fr for h in g.find(text, "de")}  # no German target


def test_house_usage_outranks_termbase() -> None:
    rows = [
        {"fr": "cornes", "en": "lugs", "source": "gmt", "priority": 0},
        {"fr": "corne", "en": "horn", "source": "berner", "priority": 1},
        {"fr": "série limitée", "en": "Série limitée", "source": "fhh", "priority": 3},
    ]
    g = Glossary.from_rows(rows)
    hits = {h.entry.fr: h for h in g.find("ses cornes et sa série limitée", "en")}
    assert [t.term for t in hits["cornes"].targets("en")] == ["lugs", "horn"]
    assert "série limitée" not in hits  # untranslated copy dropped


def test_homonyms_show_definitions() -> None:
    g = Glossary.from_rows(TERMS)
    block = prompts.render_glossary(g.find("le pont de balancier", "en"), "en")
    assert "bridge [FH Berner] — Part of the movement frame" in block and "cock" in block


def test_memory_retrieves_closest_and_dedupes() -> None:
    examples = [
        Example(
            fr="Le boîtier en titane mesure 41 mm.",
            tgt="The titanium case is 41 mm.",
            source="worldtempus",
            pool="style",
        ),
        Example(
            fr="Une phase de lune astronomique.",
            tgt="An astronomical moon phase.",
            source="worldtempus",
            pool="style",
        ),
        Example(fr="Le cadran est bleu.", tgt="The dial is blue.", source="brands", pool="style"),
    ]
    mem = TranslationMemory({"style": MemoryPool("style", examples)}, {"style": 1})
    got = mem.retrieve(["Boîtier titane de 41 mm", "boîtiers en titane"], budget=5)
    assert [e.tgt for e in got] == ["The titanium case is 41 mm."]


def test_chunking_keeps_paragraphs_whole() -> None:
    paras = ["a " * 500, "b " * 500, "c " * 500]
    assert [len(c) for c in chunk_paragraphs(paras, 1200)] == [2, 1]


class FakeStream:
    def __init__(self, text: str) -> None:
        self.text = text
        self.text_stream = iter([text])

    def __enter__(self) -> "FakeStream":
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def get_final_message(self) -> SimpleNamespace:
        block = SimpleNamespace(type="text", text=self.text)
        return SimpleNamespace(content=[block], stop_reason="end_turn", stop_details=None)


class FakeClient:
    def __init__(self) -> None:
        self.calls: list[dict] = []
        self.beta = SimpleNamespace(messages=SimpleNamespace(stream=self.stream))

    def stream(self, **kwargs: object) -> FakeStream:
        self.calls.append(kwargs)
        if "format" in kwargs["output_config"]:  # review pass
            return FakeStream(
                json.dumps(
                    {
                        "translation": "Final.",
                        "changes": [
                            {"before": "Draft.", "after": "Final.", "reason": "style: test"}
                        ],
                    }
                )
            )
        return FakeStream("Draft.")


def test_translator_two_passes_request_shape() -> None:
    examples = [
        Example(
            fr="Le cadran est bleu.", tgt="The dial is blue.", source="worldtempus", pool="style"
        )
    ]
    res = Resources(
        glossary=Glossary.from_rows(TERMS),
        memories={"en": TranslationMemory({"style": MemoryPool("style", examples)}, {"style": 2})},
    )
    client = FakeClient()
    out = Translator(res, TranslateConfig(), client=client).translate(
        "Le cadran est noir.\n\nRéserve de marche : 70 heures.", "en"
    )
    assert out.translation == "Final." and out.chunks[0].changes[0].after == "Final."
    draft, review = client.calls
    assert draft["model"] == "claude-opus-5-5" and draft["fallbacks"] == "default"
    assert draft["output_config"] == {"effort": "xhigh"}
    assert review["output_config"]["format"]["type"] == "json_schema"
    user = draft["messages"][0]["content"]
    assert "cadran → dial [FHH]" in user and "EN: The dial is blue." in user
    assert '<draft lang="en">\nDraft.\n</draft>' in review["messages"][0]["content"]
    assert "British spelling" in draft["system"][0]["text"]
