"""Table-driven tests from real 2026 handbook rule strings."""
import pytest

from planner_scraper.requisites import is_fully_parsed, parse_rule

U = lambda c: {"unit": c}  # noqa: E731


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("None", None),
        ("", None),
        ("FINC2011 /", U("FINC2011")),
        ("INFO1110 or INFO1910 or ENGG1810", {"op": "or", "args": [U("INFO1110"), U("INFO1910"), U("ENGG1810")]}),
        (
            "( COMP2017 or COMP2129 ) and ( COMP2022 or COMP2922 )",
            {"op": "and", "args": [
                {"op": "or", "args": [U("COMP2017"), U("COMP2129")]},
                {"op": "or", "args": [U("COMP2022"), U("COMP2922")]},
            ]},
        ),
        ("96 credit points", {"cp": 96}),
        ("Completion of 96 credit points", {"cp": 96}),
        ("12 credit points of MATH2XXX", {"cp": 12, "pattern": "MATH2XXX"}),
        (
            "Completion of at least 112 credit points including FINC2011 and FINC2012",
            {"op": "and", "args": [{"cp": 112}, U("FINC2011"), U("FINC2012")]},
        ),
        ("MATH1X61 or MATH1971", {"op": "or", "args": [{"unitPattern": "MATH1X61"}, U("MATH1971")]}),
    ],
)
def test_parse(raw, expected):
    assert parse_rule(raw) == expected


def test_distinction_keeps_units():
    tree = parse_rule("Distinction level results in ( INFO1110 or INFO1910 )")
    assert tree["op"] == "and"
    assert tree["args"][0] == {"text": "Distinction level results in"}
    assert tree["args"][1] == {"op": "or", "args": [U("INFO1110"), U("INFO1910")]}
    assert not is_fully_parsed(tree)


def test_mark_or_above_is_not_an_operator():
    tree = parse_rule("MATH1061 or MATH1961 or (a mark of 65 or above in MATH1014 )")
    assert tree["op"] == "or"
    assert len(tree["args"]) == 3
    assert tree["args"][2]["op"] == "and"
    assert U("MATH1014") in tree["args"][2]["args"]


def test_mixed_operators_flagged_ambiguous():
    tree = parse_rule("INFO1110 or INFO1910 and INFO1113")
    assert tree.get("ambiguous") is True


def test_unbalanced_falls_back_to_text():
    assert parse_rule("( COMP2017 or COMP2129") == {"text": "( COMP2017 or COMP2129"}


def test_nested_braces():
    tree = parse_rule(
        "{(MATH1X61 or MATH1971 ) or [(MATH1X21 or MATH1931 ) and (MATH1XX2 )]} and [(MATH1X62 or MATH1972 )]"
    )
    assert tree["op"] == "and"
    assert is_fully_parsed(tree)


def test_note_sentence_after_rule_is_dropped():
    tree = parse_rule("ENGG4000 or ENGP1000 Students must enrol in ENGP1002 in the semester immediately following")
    assert tree == {"op": "or", "args": [U("ENGG4000"), U("ENGP1000")]}


def test_capitalised_rule_words_are_not_notes():
    # "Distinction" follows "or", not a code, so it is kept.
    tree = parse_rule("COMP2123 or Distinction level results in COMP2823")
    assert tree["op"] == "or"
