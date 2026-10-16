"""The deterministic rule filter.

This module is the whole safety argument of the project. Every eligibility
threshold is settled here, in ordinary code, against values the extractor
produced. No model is consulted, no probability is involved, and every outcome
carries the clause it came from.

Three outcomes per constraint:

* ``SATISFIED`` — the profile provably meets the condition.
* ``VIOLATED``  — the profile provably fails it. The scheme is dropped.
* ``UNKNOWN``   — the profile does not say. The scheme survives, but the
  condition is surfaced to the user as something still to confirm. This is the
  abstention path: the system never upgrades silence into a yes.
"""

from __future__ import annotations

from typing import Any

from .models import Clause, ClauseCheck, Constraint, Profile, Scheme, Status, Verdict

#: Fields where a condition may legitimately be met by a household member
#: rather than the speaker — a parent asking about a child's scholarship is
#: the normal case, not an edge case. Matching is reported explicitly in the
#: reason string so the user can see whom it applied to.
HOUSEHOLD_FIELDS = {"education_stage", "gender"}

FIELD_LABEL = {
    "age": "age",
    "annual_income_inr": "annual income",
    "land_acres": "landholding",
    "state": "state",
    "occupation": "occupation",
    "category": "social category",
    "education_stage": "stage of education",
    "gender": "gender",
    "residence": "place of residence",
    "special_categories": "declared status",
    "dependents": "family details",
}


def _fmt(field: str, value: Any, threshold: bool = False) -> str:
    """Render a value for a human.

    ``threshold=True`` marks the rule's own limit rather than the person's
    value, so we never render a "> 0 acres" limit as the word "landless".
    """
    if value is None:
        return "not stated"
    if field == "annual_income_inr":
        return f"Rs. {int(value):,}"
    if field == "land_acres":
        if not threshold and float(value) == 0:
            return "landless"
        return f"{float(value):g} acres"
    if field == "state":
        if isinstance(value, list):
            return ", ".join(str(v).title() for v in value)
        return str(value).title()
    if isinstance(value, list):
        return ", ".join(str(v).replace("_", " ") for v in value) or "none"
    return str(value).replace("_", " ")


def _numeric(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _dependent_matches(dependents: list[dict], spec: dict) -> bool:
    for dep in dependents or []:
        if "gender" in spec and dep.get("gender") not in (spec["gender"], None):
            continue
        if "gender" in spec and dep.get("gender") is None:
            # An unspecified child cannot prove a girl-child condition.
            continue
        if "max_age" in spec:
            age = dep.get("age")
            if age is None:
                return False  # cannot prove; caller turns this into UNKNOWN
            if age > spec["max_age"]:
                continue
        return True
    return False


def _household_values(profile: Profile, field: str) -> list[Any]:
    """Applicant's own value plus any dependants', for household fields."""
    out: list[Any] = []
    own = profile.get(field)
    if own is not None:
        out.append(("you", own))
    if field in HOUSEHOLD_FIELDS:
        for dep in profile.get("dependents") or []:
            v = dep.get(field)
            if v is not None:
                who = {"female": "your daughter", "male": "your son"}.get(
                    dep.get("gender") or "", "a member of your household"
                )
                out.append((who, v))
    return out


def check_constraint(con: Constraint, profile: Profile) -> tuple[Status, str]:
    """Evaluate one constraint. Returns (status, human-readable reason)."""
    field = con.field
    label = FIELD_LABEL.get(field, field)

    # --- dependant-shaped conditions ------------------------------------
    if con.op == "contains_dependent":
        deps = profile.get("dependents")
        if not deps:
            return Status.UNKNOWN, "you have not mentioned any children"
        spec = con.value if isinstance(con.value, dict) else {}
        if "max_age" in spec and all(d.get("age") is None for d in deps):
            return (
                Status.UNKNOWN,
                "the child's age is needed to confirm this condition",
            )
        if _dependent_matches(deps, spec):
            return Status.SATISFIED, "you mentioned a daughter in your family"
        return Status.VIOLATED, "no child in your family matches this condition"

    # --- list-membership conditions -------------------------------------
    if con.op in {"contains", "contains_any"}:
        have = profile.get(field) or []
        if not isinstance(have, list):
            have = [have]
        wanted = con.value if con.op == "contains_any" else [con.value]
        hit = [w for w in wanted if w in have]
        if hit:
            return Status.SATISFIED, f"you stated: {_fmt(field, hit)}"
        if not have:
            return Status.UNKNOWN, f"your {label} is not stated"
        # A stated list that lacks the term is weak evidence of absence, not
        # proof: people rarely enumerate every status they hold.
        return Status.UNKNOWN, f"you did not mention {_fmt(field, wanted, threshold=True)}"

    candidates = _household_values(profile, field)
    if not candidates:
        return Status.UNKNOWN, f"your {label} is not stated"

    statuses: list[tuple[Status, str]] = []
    for who, value in candidates:
        statuses.append(_compare(con, field, label, who, value))

    for st, reason in statuses:
        if st is Status.SATISFIED:
            return st, reason
    for st, reason in statuses:
        if st is Status.UNKNOWN:
            return st, reason
    return statuses[0]


def _compare(
    con: Constraint, field: str, label: str, who: str, value: Any
) -> tuple[Status, str]:
    op, target = con.op, con.value
    subject = "your" if who == "you" else f"{who}'s"
    shown = _fmt(field, value)

    if op == "in" or op == "not_in":
        have = value if isinstance(value, list) else [value]
        wanted = target if isinstance(target, list) else [target]
        overlap = bool(set(map(str, have)) & set(map(str, wanted)))
        if op == "in":
            if overlap:
                return Status.SATISFIED, f"{subject} {label} is {shown}"
            return Status.VIOLATED, (
                f"{subject} {label} is {shown}; this requires "
                f"{_fmt(field, wanted, threshold=True)}"
            )
        if overlap:
            return Status.VIOLATED, f"{subject} {label} is excluded: {shown}"
        return Status.SATISFIED, f"{subject} {label} is not in the excluded list"

    if op in {"==", "!="}:
        equal = str(value) == str(target)
        ok = equal if op == "==" else not equal
        if ok:
            return Status.SATISFIED, f"{subject} {label} is {shown}"
        return Status.VIOLATED, (
            f"{subject} {label} is {shown}; this requires {_fmt(field, target, threshold=True)}"
        )

    num = _numeric(value)
    tnum = _numeric(target)
    if op == "between":
        if not (isinstance(target, (list, tuple)) and len(target) == 2):
            return Status.UNKNOWN, "the rule's range could not be read"
        lo, hi = float(target[0]), float(target[1])
        if num is None:
            return Status.UNKNOWN, f"{subject} {label} is not a number"
        if lo <= num <= hi:
            return Status.SATISFIED, f"{subject} {label} of {shown} is within {lo:g}-{hi:g}"
        return Status.VIOLATED, (
            f"{subject} {label} of {shown} is outside the required {lo:g}-{hi:g}"
        )

    if num is None or tnum is None:
        return Status.UNKNOWN, f"{subject} {label} could not be compared numerically"

    ops = {
        "<=": (num <= tnum, "at most"),
        "<": (num < tnum, "under"),
        ">=": (num >= tnum, "at least"),
        ">": (num > tnum, "more than"),
    }
    if op not in ops:
        return Status.UNKNOWN, f"unsupported comparison {op!r}"
    ok, word = ops[op]
    limit = _fmt(field, target, threshold=True)
    if ok:
        return Status.SATISFIED, f"{subject} {label} of {shown} is {word} {limit}"
    return Status.VIOLATED, f"{subject} {label} of {shown} is not {word} {limit}"


def check_scheme(scheme: Scheme, profile: Profile) -> tuple[Verdict, list[ClauseCheck]]:
    """Evaluate every constraint on a scheme and return an overall verdict."""
    checks: list[ClauseCheck] = []
    for clause in scheme.clauses:
        if clause.constraint is None:
            continue
        status, reason = check_constraint(clause.constraint, profile)
        checks.append(ClauseCheck(clause.id, clause.text, status, reason))

    # A state scheme is only relevant to residents of that state; treat the
    # state as an implicit constraint even when no clause states it.
    if scheme.level == "state" and scheme.state:
        user_state = profile.get("state")
        if user_state is None:
            checks.append(
                ClauseCheck(
                    f"{scheme.id}-implicit-state",
                    f"This is a scheme of the Government of {scheme.state.title()} "
                    f"and is available to residents of that state.",
                    Status.UNKNOWN,
                    "your state is not stated",
                )
            )
        elif user_state != scheme.state:
            checks.append(
                ClauseCheck(
                    f"{scheme.id}-implicit-state",
                    f"This is a scheme of the Government of {scheme.state.title()} "
                    f"and is available to residents of that state.",
                    Status.VIOLATED,
                    f"you stated {user_state.title()}, not {scheme.state.title()}",
                )
            )

    if any(c.status is Status.VIOLATED for c in checks):
        return Verdict.INELIGIBLE, checks
    if any(c.status is Status.UNKNOWN for c in checks):
        return Verdict.LIKELY_ELIGIBLE, checks
    return Verdict.ELIGIBLE, checks


def relevant_fields(schemes: list[Scheme]) -> set[str]:
    """Which profile fields the given schemes actually test."""
    fields: set[str] = set()
    for s in schemes:
        for c in s.clauses:
            if c.constraint:
                fields.add(c.constraint.field)
        if s.level == "state":
            fields.add("state")
    return fields
