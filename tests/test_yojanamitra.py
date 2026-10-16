"""Test suite.

The tests that matter most are the invariants at the bottom: the ones that
would catch the system starting to promise people money they will not get.
"""

from __future__ import annotations

import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from yojanamitra import corpus, explain, extraction, normalize as N, rules, translate  # noqa: E402
from yojanamitra.models import (  # noqa: E402
    Clause, Constraint, Profile, Result, Scheme, Status, Verdict,
)
from yojanamitra.pipeline import YojanaMitra  # noqa: E402


@pytest.fixture(scope="module")
def schemes():
    return corpus.load()


@pytest.fixture(scope="module")
def engine(schemes):
    return YojanaMitra(schemes=schemes)


def profile(**kw) -> Profile:
    p = Profile()
    for k, v in kw.items():
        p.set(k, v, 1.0, "user")
    return p


# --------------------------------------------------------------------------
# Normalisation
# --------------------------------------------------------------------------

@pytest.mark.parametrize("text,expected", [
    ("my annual income is 2 lakh", 200_000),
    ("I earn Rs 1,50,000 per year", 150_000),
    ("income 45000 per month", 540_000),
    ("family income 2.5 lakhs per annum", 250_000),
    ("60000 saal ka", 60_000),
    ("salary of 12 lakh", 1_200_000),
    ("I am 44 years old", None),
    ("my daughter is in 11th class", None),
])
def test_parse_money(text, expected):
    assert N.parse_money(text) == expected


@pytest.mark.parametrize("text,expected", [
    ("I own 2 acres", 2.0),
    ("1.5 hectares of land", pytest.approx(3.7066, rel=1e-3)),
    ("landless labourer", 0.0),
    ("I have no land", 0.0),
    ("I earn 2 lakh", None),
])
def test_parse_land(text, expected):
    assert N.parse_land(text) == expected


@pytest.mark.parametrize("text,expected", [
    ("I am 22 years old", 22),
    ("aged 45", 45),
    ("I own 2 acres", None),
    ("my daughter is in 11th class", None),
])
def test_parse_age(text, expected):
    assert N.parse_age(text) == expected


def test_state_aliases():
    assert N.parse_state("I live in AP") == "andhra pradesh"
    assert N.parse_state("from Tamilnadu") == "tamil nadu"
    assert N.parse_state("nowhere in particular") is None


def test_class_to_stage():
    assert N.class_to_stage(5) == "class_1_8"
    assert N.class_to_stage(9) == "class_9_10"
    assert N.class_to_stage(11) == "class_11_12"
    assert N.class_to_stage(15) is None


# --------------------------------------------------------------------------
# Extraction
# --------------------------------------------------------------------------

def test_extracts_the_deck_example():
    p = extraction.extract(
        "I'm a farmer in Andhra, I own 2 acres, and my daughter is in 11th class"
    )
    assert p.get("occupation") == ["farmer"]
    assert p.get("land_acres") == 2.0
    assert p.get("state") == "andhra pradesh"
    deps = p.get("dependents")
    assert deps and deps[0]["gender"] == "female"
    assert deps[0]["education_stage"] == "class_11_12"


def test_education_attributed_to_child_not_speaker():
    """'my daughter is in 11th' must not make the speaker a Class 11 student."""
    p = extraction.extract("I am a farmer, my daughter is in 11th class")
    assert p.get("education_stage") is None
    assert p.get("dependents")[0]["education_stage"] == "class_11_12"


def test_education_attributed_to_speaker_when_no_dependant():
    p = extraction.extract("I am 20, doing B.Tech in Kerala")
    assert p.get("education_stage") == "undergraduate"
    assert "student" in p.get("occupation")


def test_clarifying_question_only_for_relevant_fields():
    p = profile(age=30)
    assert extraction.needed_clarification(p, relevant={"age"}) is None
    q = extraction.needed_clarification(p, relevant={"state"})
    assert q and "state" in q.lower()


def test_low_confidence_field_still_triggers_a_question():
    p = Profile()
    p.set("age", 65, extraction.CONF_RULE_WEAK, "rule")
    assert extraction.needed_clarification(p, relevant={"age"}) is not None


def test_profile_set_keeps_higher_confidence():
    p = Profile()
    p.set("age", 30, 0.9)
    p.set("age", 99, 0.5)
    assert p.get("age") == 30
    p.set("age", 41, 0.5, force=True)
    assert p.get("age") == 41


# --------------------------------------------------------------------------
# Rule filter
# --------------------------------------------------------------------------

def test_numeric_threshold_satisfied_and_violated():
    con = Constraint("annual_income_inr", "<=", 250_000)
    assert rules.check_constraint(con, profile(annual_income_inr=200_000))[0] is Status.SATISFIED
    assert rules.check_constraint(con, profile(annual_income_inr=900_000))[0] is Status.VIOLATED


def test_missing_value_is_unknown_never_satisfied():
    con = Constraint("annual_income_inr", "<=", 250_000)
    status, reason = rules.check_constraint(con, profile(age=30))
    assert status is Status.UNKNOWN
    assert "not stated" in reason


def test_between_bounds_are_inclusive():
    con = Constraint("age", "between", [18, 40])
    for age, expected in [(18, Status.SATISFIED), (40, Status.SATISFIED),
                          (17, Status.VIOLATED), (41, Status.VIOLATED)]:
        assert rules.check_constraint(con, profile(age=age))[0] is expected


def test_household_resolution_for_education():
    """A parent's child satisfies an education condition; it is stated as such."""
    p = profile(dependents=[{"gender": "female", "education_stage": "class_11_12"}])
    con = Constraint("education_stage", "in", ["class_11_12"])
    status, reason = rules.check_constraint(con, p)
    assert status is Status.SATISFIED
    assert "daughter" in reason


def test_state_scheme_excludes_other_states(schemes):
    ap = next(s for s in schemes if s.id == "ap-rythu-bharosa")
    verdict, checks = rules.check_scheme(ap, profile(state="kerala", occupation=["farmer"]))
    assert verdict is Verdict.INELIGIBLE
    assert any(c.status is Status.VIOLATED for c in checks)


def test_state_scheme_unknown_state_is_not_a_rejection(schemes):
    ap = next(s for s in schemes if s.id == "ap-rythu-bharosa")
    verdict, _ = rules.check_scheme(ap, profile(occupation=["farmer"]))
    assert verdict is Verdict.LIKELY_ELIGIBLE


def test_land_threshold_is_never_described_as_landless():
    con = Constraint("land_acres", ">", 0)
    _, reason = rules.check_constraint(con, profile(land_acres=2.0))
    assert "landless" not in reason


# --------------------------------------------------------------------------
# Corpus integrity
# --------------------------------------------------------------------------

def test_corpus_loads_and_validates(schemes):
    assert len(schemes) >= 20
    corpus.validate(schemes)


def test_every_scheme_has_an_apply_link(schemes):
    assert all(s.apply_url.startswith("http") for s in schemes)


def test_every_constraint_field_is_one_the_extractor_can_fill(schemes):
    from yojanamitra.models import PROFILE_FIELDS
    for s in schemes:
        for c in s.clauses:
            if c.constraint:
                assert c.constraint.field in PROFILE_FIELDS, (
                    f"{c.id} constrains {c.constraint.field}, which nothing extracts"
                )


def test_corpus_rejects_a_scheme_with_no_clauses():
    bad = Scheme("x", "X", "central", None, "", [], "", [], [], "u", "u")
    with pytest.raises(corpus.CorpusError):
        corpus.validate([bad])


def test_corpus_rejects_an_unknown_operator():
    bad = Scheme(
        "x", "X", "central", None, "", [], "",
        [Clause("x-c1", "text", Constraint("age", "≈", 30))], [], "u", "u",
    )
    with pytest.raises(corpus.CorpusError):
        corpus.validate([bad])


# --------------------------------------------------------------------------
# Translation / code-mixed input
# --------------------------------------------------------------------------

def test_romanised_glosses_do_not_corrupt_numbers():
    english, _ = translate.to_english("34 saal, viklang hoon, 60000 saal ka")
    assert N.parse_money(english) == 60_000


def test_script_detection():
    assert translate.detect_language("मैं किसान हूँ") == "hi"
    assert translate.detect_language("நான் விவசாயி") == "ta"
    assert translate.detect_language("I am a farmer") == "en"


# --------------------------------------------------------------------------
# Explanation
# --------------------------------------------------------------------------

def test_explanation_reports_open_conditions():
    from yojanamitra.models import ClauseCheck
    checks = [
        ClauseCheck("c1", "Must be a farmer.", Status.SATISFIED, "your occupation is farmer"),
        ClauseCheck("c2", "Income must not exceed Rs. 2,50,000.", Status.UNKNOWN,
                    "your annual income is not stated"),
    ]
    text = explain.extractive("S", Verdict.LIKELY_ELIGIBLE, checks)
    assert "qualify because" in text
    assert "Still to confirm" in text


def test_llm_output_with_an_invented_number_is_rejected():
    from yojanamitra.models import ClauseCheck
    checks = [ClauseCheck("c1", "Must be a farmer.", Status.SATISFIED, "occupation is farmer")]
    result = Result(
        scheme=Scheme("s", "S", "central", None, "", [], "", [Clause("c1", "Must be a farmer.")],
                      [], "u", "u"),
        verdict=Verdict.ELIGIBLE, retrieval_score=1.0, checks=checks,
    )
    rogue = lambda _: "You qualify and will receive Rs. 90000 every month."  # noqa: E731
    assert "90000" not in explain.explain(result, llm=rogue)


def test_llm_output_that_stays_grounded_is_accepted():
    from yojanamitra.models import ClauseCheck
    checks = [ClauseCheck("c1", "Must be a farmer.", Status.SATISFIED, "occupation is farmer")]
    result = Result(
        scheme=Scheme("s", "S", "central", None, "", [], "", [Clause("c1", "Must be a farmer.")],
                      [], "u", "u"),
        verdict=Verdict.ELIGIBLE, retrieval_score=1.0, checks=checks,
    )
    good = lambda _: "You qualify because you are a farmer, as the rule requires."  # noqa: E731
    assert "as the rule requires" in explain.explain(result, llm=good)


# --------------------------------------------------------------------------
# Pipeline invariants — the safety properties
# --------------------------------------------------------------------------

def test_no_result_is_eligible_with_an_unproven_condition(engine):
    """The central abstention property, checked across many inputs."""
    inputs = [
        "I'm a farmer in Andhra with 2 acres and my daughter is in 11th class",
        "20 year old girl doing B.Tech in Tamil Nadu, SC, family income 2 lakh",
        "52 saal ki vidhwa hoon, Bihar ke gaon mein, koi zameen nahi, BPL card",
        "I am 68, village in UP, no land, BPL card, income 30000",
        "unemployed, 25, Kerala city, family income 12 lakh",
        "handloom weaver in a West Bengal village, 45, income 1.1 lakh",
    ]
    seen_eligible = 0
    for text in inputs:
        for r in engine.answer(text, top_k=8).results:
            if r.verdict is Verdict.ELIGIBLE:
                seen_eligible += 1
                assert not [c for c in r.checks if c.status is Status.UNKNOWN], (
                    f"{r.scheme.id} claimed eligible with an unverified condition"
                )
                assert [c for c in r.checks if c.status is Status.SATISFIED], (
                    f"{r.scheme.id} claimed eligible with nothing satisfied"
                )
    # Guard against the test passing because nothing was ever eligible.
    assert seen_eligible >= 10, f"only {seen_eligible} eligible verdicts to check"


def test_every_check_cites_a_clause_that_exists(engine):
    checked = 0
    for text in ["I'm a farmer in Andhra with 2 acres", "widow, 52, Bihar, BPL, no land"]:
        for r in engine.answer(text, top_k=8).results:
            checked += len(r.checks)
            valid = {c.id for c in r.scheme.clauses} | {f"{r.scheme.id}-implicit-state"}
            for check in r.checks:
                assert check.clause_id in valid
    assert checked >= 20, f"only {checked} clause checks exercised"


def test_violated_schemes_are_excluded_by_default(engine):
    answer = engine.answer("I am a farmer in Kerala with 2 acres", top_k=20)
    assert all(r.verdict is not Verdict.INELIGIBLE for r in answer.results)
    ids = {r.scheme.id for r in answer.results}
    assert "ap-rythu-bharosa" not in ids  # Andhra-only scheme, user is in Kerala


def test_ineligible_can_be_requested_with_reasons(engine):
    answer = engine.answer("I am a farmer in Kerala with 2 acres", top_k=40,
                           include_ineligible=True)
    ruled_out = [r for r in answer.results if r.verdict is Verdict.INELIGIBLE]
    assert ruled_out
    assert all(
        any(c.status is Status.VIOLATED for c in r.checks) for r in ruled_out
    )


def test_empty_and_junk_input_do_not_crash(engine):
    for text in ["   ", "asdfghjkl", "?", "1234567890" * 20]:
        answer = engine.answer(text)
        assert isinstance(answer.results, list)


def test_answer_serialises_to_json(engine):
    import json
    answer = engine.answer("I'm a farmer in Andhra with 2 acres")
    json.dumps(answer.to_dict())


def test_rule_scope_all_finds_at_least_as_much_as_retrieved_only(schemes):
    """Checking every scheme should never surface fewer eligible schemes."""
    text = "I am 30, a farmer in Punjab with 3 acres, income 1.7 lakh, village"
    all_scope = YojanaMitra(schemes=schemes, rule_scope="all")
    narrow = YojanaMitra(schemes=schemes, rule_scope="retrieved")
    a = {r.scheme.id for r in all_scope.answer(text, top_k=40).results}
    b = {r.scheme.id for r in narrow.answer(text, top_k=40).results}
    assert b <= a


def test_invalid_rule_scope_is_rejected(schemes):
    with pytest.raises(ValueError):
        YojanaMitra(schemes=schemes, rule_scope="nonsense")
