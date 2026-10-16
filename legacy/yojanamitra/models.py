"""Typed data models for YojanaMitra.

Design constraint from the project spec: eligibility is decided by explicit
constraint objects, never by a language model. Every constraint is therefore a
first-class, machine-checkable value bound to the clause it came from, so any
verdict can be traced back to a rule and a number.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Any, Optional


# --------------------------------------------------------------------------
# Profile fields the system understands
# --------------------------------------------------------------------------

PROFILE_FIELDS = (
    "age",
    "gender",
    "occupation",
    "annual_income_inr",
    "land_acres",
    "state",
    "category",
    "education_stage",
    "residence",
    "special_categories",
    "dependents",
)

#: Fields that, when missing, most often change the outcome. Used to decide
#: whether to ask a clarifying question instead of guessing.
CRITICAL_FIELDS = ("age", "annual_income_inr", "state", "occupation")

EDUCATION_STAGES = (
    "pre_primary",
    "class_1_8",
    "class_9_10",
    "class_9_12",
    "class_11_12",
    "undergraduate",
    "postgraduate",
    "doctoral",
    "not_studying",
)

GENDERS = ("male", "female", "transgender")

RESIDENCE = ("rural", "urban")


class Status(str, Enum):
    """Outcome of checking one constraint, or of a whole scheme."""

    SATISFIED = "satisfied"
    VIOLATED = "violated"
    UNKNOWN = "unknown"


class Verdict(str, Enum):
    """Scheme-level verdict produced by the deterministic rule filter."""

    ELIGIBLE = "eligible"
    LIKELY_ELIGIBLE = "likely_eligible"  # nothing violated, something unverifiable
    INELIGIBLE = "ineligible"


@dataclass
class Value:
    """A single extracted attribute plus the evidence that produced it."""

    value: Any
    confidence: float
    source: str = "rule"  # rule | ner | llm | user
    evidence: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Profile:
    """Structured eligibility profile extracted from free text."""

    values: dict[str, Value] = field(default_factory=dict)
    raw_text: str = ""
    language: str = "en"

    # -- access helpers ----------------------------------------------------
    def get(self, field_name: str, default: Any = None) -> Any:
        v = self.values.get(field_name)
        return default if v is None else v.value

    def confidence(self, field_name: str) -> float:
        v = self.values.get(field_name)
        return 0.0 if v is None else v.confidence

    def set(
        self,
        field_name: str,
        value: Any,
        confidence: float,
        source: str = "rule",
        evidence: str = "",
        force: bool = False,
    ) -> None:
        """Set a field, keeping whichever value has the higher confidence.

        ``force`` is for deliberate refinements of a value the same layer just
        wrote (for example widening an occupation list), which must not be
        blocked by the equal-confidence guard.
        """
        existing = self.values.get(field_name)
        if not force and existing is not None and existing.confidence >= confidence:
            return
        self.values[field_name] = Value(value, confidence, source, evidence)

    def known_fields(self) -> list[str]:
        return sorted(self.values.keys())

    def to_dict(self) -> dict:
        return {
            "language": self.language,
            "raw_text": self.raw_text,
            "values": {k: v.to_dict() for k, v in self.values.items()},
        }


@dataclass
class Constraint:
    """One machine-checkable eligibility condition."""

    field: str
    op: str  # ==, !=, <=, <, >=, >, in, not_in, between, contains_dependent
    value: Any

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Clause:
    """A clause-level chunk of a scheme's eligibility text.

    ``constraint`` is None for clauses that are informative but not
    machine-checkable; those can still be retrieved and cited, they just never
    decide a verdict.
    """

    id: str
    text: str
    constraint: Optional[Constraint] = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "text": self.text,
            "constraint": self.constraint.to_dict() if self.constraint else None,
        }


@dataclass
class Scheme:
    id: str
    name: str
    level: str  # central | state
    state: Optional[str]
    ministry: str
    category: list[str]
    benefits: str
    clauses: list[Clause]
    documents: list[str]
    apply_url: str
    source_url: str
    last_verified: Optional[str] = None

    def eligibility_text(self) -> str:
        return " ".join(c.text for c in self.clauses)

    def search_text(self) -> str:
        """Everything worth indexing for retrieval."""
        return " ".join(
            [self.name, " ".join(self.category), self.benefits, self.eligibility_text()]
        )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "level": self.level,
            "state": self.state,
            "ministry": self.ministry,
            "category": self.category,
            "benefits": self.benefits,
            "clauses": [c.to_dict() for c in self.clauses],
            "documents": self.documents,
            "apply_url": self.apply_url,
            "source_url": self.source_url,
            "last_verified": self.last_verified,
        }

    @staticmethod
    def from_dict(d: dict) -> "Scheme":
        clauses = []
        for c in d.get("clauses", []):
            con = c.get("constraint")
            clauses.append(
                Clause(
                    id=c["id"],
                    text=c["text"],
                    constraint=Constraint(**con) if con else None,
                )
            )
        return Scheme(
            id=d["id"],
            name=d["name"],
            level=d.get("level", "central"),
            state=d.get("state"),
            ministry=d.get("ministry", ""),
            category=d.get("category", []),
            benefits=d.get("benefits", ""),
            clauses=clauses,
            documents=d.get("documents", []),
            apply_url=d.get("apply_url", ""),
            source_url=d.get("source_url", ""),
            last_verified=d.get("last_verified"),
        )


@dataclass
class ClauseCheck:
    """Result of evaluating one clause's constraint against a profile."""

    clause_id: str
    clause_text: str
    status: Status
    reason: str

    def to_dict(self) -> dict:
        return {
            "clause_id": self.clause_id,
            "clause_text": self.clause_text,
            "status": self.status.value,
            "reason": self.reason,
        }


@dataclass
class Result:
    """One scheme as returned to the user."""

    scheme: Scheme
    verdict: Verdict
    retrieval_score: float
    checks: list[ClauseCheck]
    explanation: str = ""
    unverified: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "scheme_id": self.scheme.id,
            "name": self.scheme.name,
            "verdict": self.verdict.value,
            "retrieval_score": round(self.retrieval_score, 4),
            "explanation": self.explanation,
            "unverified": self.unverified,
            "checks": [c.to_dict() for c in self.checks],
            "benefits": self.scheme.benefits,
            "documents": self.scheme.documents,
            "apply_url": self.scheme.apply_url,
            "source_url": self.scheme.source_url,
        }


@dataclass
class Answer:
    """Full pipeline output."""

    profile: Profile
    results: list[Result]
    clarifying_question: Optional[str] = None
    timings_ms: dict[str, float] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "profile": self.profile.to_dict(),
            "clarifying_question": self.clarifying_question,
            "results": [r.to_dict() for r in self.results],
            "timings_ms": {k: round(v, 2) for k, v in self.timings_ms.items()},
            "notes": self.notes,
        }
