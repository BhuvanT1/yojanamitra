"""Grounded explanation.

The contract, in both modes:

* every sentence of a reason is tied to a clause that was actually checked;
* nothing that was not checked is asserted;
* conditions the rule filter could not verify are reported as open questions,
  never quietly dropped or turned into a yes.

The default mode is extractive: it composes the reasons the rule filter already
produced. That has no hallucination surface at all. The LLM mode exists for
fluency, and is post-validated — if the model's output mentions a scheme or a
number that is not in the retrieved clauses, it is rejected and the extractive
text is used instead.
"""

from __future__ import annotations

import re
from typing import Callable, Optional

from .models import ClauseCheck, Result, Status, Verdict

LLMFn = Callable[[str], str]

_PROMPT = """You are explaining a government scheme eligibility result to a citizen.

Scheme: {name}
Verdict already decided by rule checks (do NOT change it): {verdict}

Checked conditions:
{checks}

Write two or three short sentences in plain English telling the person why this
scheme applies to them, quoting the condition text where useful. Do not invent
any condition, number or benefit that is not listed above. If any condition is
marked unknown, say plainly that it still needs to be confirmed.
"""


def _bullet(check: ClauseCheck) -> str:
    mark = {
        Status.SATISFIED: "met",
        Status.VIOLATED: "not met",
        Status.UNKNOWN: "unknown",
    }[check.status]
    return f"- [{mark}] {check.clause_text} (because {check.reason})"


def extractive(scheme_name: str, verdict: Verdict, checks: list[ClauseCheck]) -> str:
    """Compose an explanation purely from what the rule filter established."""
    met = [c for c in checks if c.status is Status.SATISFIED]
    unknown = [c for c in checks if c.status is Status.UNKNOWN]
    failed = [c for c in checks if c.status is Status.VIOLATED]

    if verdict is Verdict.INELIGIBLE:
        if failed:
            return f"You do not qualify: {failed[0].reason}."
        return "You do not qualify for this scheme."

    parts: list[str] = []
    if met:
        reasons = "; ".join(c.reason for c in met[:3])
        parts.append(f"You qualify because {reasons}.")
    else:
        parts.append("This scheme looks relevant to your situation.")

    if unknown:
        conditions = "; ".join(c.reason for c in unknown[:2])
        parts.append(
            f"Still to confirm: {conditions}. "
            "The scheme has not been ruled out, but this has not been proven either."
        )
    return " ".join(parts)


def _grounded(text: str, checks: list[ClauseCheck], scheme_name: str) -> bool:
    """Reject generated text that asserts numbers absent from the clauses."""
    allowed = " ".join(c.clause_text + " " + c.reason for c in checks) + " " + scheme_name
    allowed_numbers = set(re.findall(r"\d[\d,]*", allowed.replace(",", "")))
    for num in re.findall(r"\d[\d,]*", text.replace(",", "")):
        if len(num) >= 3 and num not in allowed_numbers:
            return False
    return True


def explain(
    result: Result,
    llm: Optional[LLMFn] = None,
) -> str:
    """Return the explanation for one result, preferring the safe path."""
    base = extractive(result.scheme.name, result.verdict, result.checks)
    if llm is None:
        return base
    try:  # pragma: no cover - optional path
        prompt = _PROMPT.format(
            name=result.scheme.name,
            verdict=result.verdict.value,
            checks="\n".join(_bullet(c) for c in result.checks) or "- (none recorded)",
        )
        text = (llm(prompt) or "").strip()
    except Exception:
        return base
    if not text or len(text) > 900:
        return base
    if not _grounded(text, result.checks, result.scheme.name):
        return base
    return text


def unverified_conditions(checks: list[ClauseCheck]) -> list[str]:
    return [c.clause_text for c in checks if c.status is Status.UNKNOWN]
