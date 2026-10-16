"""Free text -> typed eligibility profile.

Three layers, in order of trust:

1. ``rule``  — deterministic patterns over normalised units. High confidence.
2. ``ner``   — an optional fine-tuned tagger for Indic and code-mixed entities.
                Loaded only if the model is present locally; never a hard
                dependency.
3. ``llm``   — an optional last resort that is asked *only* for fields the first
                two left empty, and whose output is re-validated by the same
                deterministic parsers before it is accepted.

The LLM can therefore never introduce a value the rule layer would reject, and
it never sees the eligibility decision — that belongs to ``rules.py``.
"""

from __future__ import annotations

import re
from typing import Callable, Optional

from . import normalize as N
from .models import CRITICAL_FIELDS, Profile

# Confidence assigned by each layer. Rules win ties by construction.
CONF_RULE_STRONG = 0.95
CONF_RULE_WEAK = 0.60
CONF_NER = 0.80
CONF_LLM = 0.55

#: Below this, a critical field is treated as not really known.
CLARIFY_THRESHOLD = 0.65


_EDU_MENTION = re.compile(
    r"\b(?:class|std\.?|standard|grade|b\.?tech|b\.?sc|b\.?com|degree|college|"
    r"graduat\w*|m\.?tech|m\.?sc|mba|mca|masters?|phd|school)\b"
)
_DEPENDENT_CUE = re.compile(
    r"\b(?:my |our |a |one )?(?:daughter|son|child|children|kid|kids|girl child|beti|beta)\b"
)


def _speaker_education(text: str) -> bool:
    """True when an education mention belongs to the speaker.

    The default is that it does: most people describing themselves are the
    subject of their own sentence, and telegraphic input ("20, undergraduate,
    SC") carries no pronoun at all. Attribution moves to a dependant only when a
    dependant is named in the run-up to the mention — which is the case the deck
    calls out, "my daughter is in 11th class".
    """
    t = N.clean(text)
    for m in _EDU_MENTION.finditer(t):
        window = t[max(0, m.start() - 55): m.start()]
        if _DEPENDENT_CUE.search(window):
            continue  # this mention belongs to a child
        return True
    return False


def extract_rules(text: str, profile: Profile) -> None:
    """Layer 1: deterministic patterns."""
    age = N.parse_age(text)
    if age is not None:
        profile.set("age", age, CONF_RULE_STRONG, "rule", f"age pattern in: {text[:80]}")
    else:
        loose = N.parse_age_loose(text)
        if loose is not None:
            profile.set("age", loose, CONF_RULE_WEAK, "rule", "bare number read as age")

    income = N.parse_money(text)
    if income is not None:
        profile.set("annual_income_inr", income, CONF_RULE_STRONG, "rule", "income pattern")

    land = N.parse_land(text)
    if land is not None:
        profile.set("land_acres", land, CONF_RULE_STRONG, "rule", "land pattern")

    state = N.parse_state(text)
    if state is not None:
        profile.set("state", state, CONF_RULE_STRONG, "rule", "state name")

    occ = N.parse_occupations(text)
    if occ:
        profile.set("occupation", occ, CONF_RULE_STRONG, "rule", "occupation vocabulary")

    cat = N.parse_category(text)
    if cat is not None:
        profile.set("category", cat, CONF_RULE_STRONG, "rule", "social category term")

    spec = N.parse_special_categories(text)
    if spec:
        profile.set("special_categories", spec, CONF_RULE_STRONG, "rule", "status terms")

    gender = N.parse_gender(text)
    if gender is not None:
        profile.set("gender", gender, CONF_RULE_WEAK, "rule", "gendered term")

    residence = N.parse_residence(text)
    if residence is not None:
        profile.set("residence", residence, CONF_RULE_STRONG, "rule", "settlement term")

    deps = N.parse_dependents(text)
    if deps:
        profile.set("dependents", deps, CONF_RULE_STRONG, "rule", "dependant mention")

    stage, _ = N.parse_education_stage(text)
    if stage is not None and _speaker_education(text):
        profile.set("education_stage", stage, CONF_RULE_STRONG, "rule", "education term")
        # Being enrolled is itself an occupation for scheme purposes, and it is
        # often the only way "student" is ever expressed ("doing B.Tech").
        if stage != "not_studying":
            occ = list(profile.get("occupation") or [])
            if "student" not in occ:
                occ.append("student")
                profile.set(
                    "occupation", occ, CONF_RULE_STRONG, "rule",
                    "enrolment implies student status", force=True,
                )


# --------------------------------------------------------------------------
# Optional layers
# --------------------------------------------------------------------------

_ner_pipeline = None
_ner_tried = False


def _load_ner():
    """Load a local NER model if one is available. Never raises."""
    global _ner_pipeline, _ner_tried
    if _ner_tried:
        return _ner_pipeline
    _ner_tried = True
    try:  # pragma: no cover - depends on optional local model
        from transformers import pipeline  # type: ignore

        from .config import settings

        if not settings.ner_model:
            return None
        _ner_pipeline = pipeline(
            "token-classification",
            model=settings.ner_model,
            aggregation_strategy="simple",
        )
    except Exception:
        _ner_pipeline = None
    return _ner_pipeline


def extract_ner(text: str, profile: Profile) -> None:
    """Layer 2: entity tagger, used to catch what the patterns missed."""
    nlp = _load_ner()
    if nlp is None:
        return
    try:  # pragma: no cover - optional path
        ents = nlp(text)
    except Exception:
        return
    for ent in ents:
        label = str(ent.get("entity_group", "")).upper()
        word = str(ent.get("word", "")).strip()
        score = float(ent.get("score", 0.0))
        if not word or score < 0.5:
            continue
        if label in {"GPE", "LOC"} and "state" not in profile.values:
            st = N.parse_state(word)
            if st:
                profile.set("state", st, CONF_NER, "ner", f"NER {label}: {word}")
        elif label in {"OCCUPATION", "ORG"} and "occupation" not in profile.values:
            occ = N.parse_occupations(word)
            if occ:
                profile.set("occupation", occ, CONF_NER, "ner", f"NER {label}: {word}")


#: Signature for a pluggable LLM. Returns raw text for a prompt.
LLMFn = Callable[[str], str]

_LLM_PROMPT = """Read the citizen's description and output ONLY a JSON object.
Use these keys when the description states them, and omit any key it does not: \
age (integer), annual_income_inr (integer rupees per year), land_acres (number), \
state (Indian state name), occupation (list), category (one of sc/st/obc/general/ews), \
gender (male/female/transgender), residence (rural/urban), \
education_stage (class_1_8/class_9_10/class_11_12/undergraduate/postgraduate/doctoral).
Do not infer anything that is not stated. Do not comment.

Description: {text}
JSON:"""


def extract_llm(text: str, profile: Profile, llm: Optional[LLMFn]) -> None:
    """Layer 3: fill only what is still missing, then re-validate.

    Every value the model returns is passed back through the deterministic
    parsers. Anything they reject is discarded, so this layer can add coverage
    but cannot widen what the system is willing to believe.
    """
    if llm is None:
        return
    missing = [f for f in CRITICAL_FIELDS if f not in profile.values]
    if not missing:
        return
    try:  # pragma: no cover - optional path
        import json

        raw = llm(_LLM_PROMPT.format(text=text))
        match = re.search(r"\{.*\}", raw, re.S)
        if not match:
            return
        data = json.loads(match.group(0))
    except Exception:
        return

    def keep(field: str, value) -> None:
        profile.set(field, value, CONF_LLM, "llm", "LLM fallback, re-validated")

    if isinstance(data.get("age"), int) and 0 < data["age"] < 120:
        keep("age", data["age"])
    if isinstance(data.get("annual_income_inr"), (int, float)):
        v = int(data["annual_income_inr"])
        if 0 <= v <= 100_000_000:
            keep("annual_income_inr", v)
    if isinstance(data.get("land_acres"), (int, float)) and data["land_acres"] >= 0:
        keep("land_acres", float(data["land_acres"]))
    if isinstance(data.get("state"), str):
        st = N.parse_state(data["state"])
        if st:
            keep("state", st)
    if isinstance(data.get("occupation"), list):
        occ = N.parse_occupations(" ".join(map(str, data["occupation"])))
        if occ:
            keep("occupation", occ)
    if isinstance(data.get("category"), str):
        cat = N.parse_category(data["category"])
        if cat:
            keep("category", cat)
    if data.get("gender") in {"male", "female", "transgender"}:
        keep("gender", data["gender"])
    if data.get("residence") in {"rural", "urban"}:
        keep("residence", data["residence"])
    if isinstance(data.get("education_stage"), str):
        stage, _ = N.parse_education_stage(data["education_stage"].replace("_", " "))
        if stage:
            keep("education_stage", stage)


# --------------------------------------------------------------------------
# Clarifying questions
# --------------------------------------------------------------------------

QUESTION_FOR_FIELD = {
    "age": "How old are you?",
    "annual_income_inr": "Roughly what is your family's total income in a year?",
    "state": "Which state do you live in?",
    "occupation": "What do you do for a living?",
    "land_acres": "Do you own any farmland, and roughly how much?",
    "category": "Do you belong to SC, ST, OBC or the general category?",
}


def needed_clarification(profile: Profile, relevant: set[str] | None = None) -> str | None:
    """Return one question, for the most decisive missing field, or None.

    ``relevant`` restricts the question to fields that actually appear in the
    constraints of the schemes currently in play — there is no point asking
    about landholding when nothing retrieved cares about land.
    """
    for f in CRITICAL_FIELDS:
        if relevant is not None and f not in relevant:
            continue
        if profile.confidence(f) < CLARIFY_THRESHOLD:
            return QUESTION_FOR_FIELD.get(f)
    return None


def extract(text: str, llm: Optional[LLMFn] = None, language: str = "en") -> Profile:
    """Run all available layers and return the profile."""
    profile = Profile(raw_text=text, language=language)
    extract_rules(text, profile)
    extract_ner(text, profile)
    extract_llm(text, profile, llm)
    return profile
