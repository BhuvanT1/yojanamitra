"""Loading and validating the scheme corpus."""

from __future__ import annotations

import json
import pathlib
from typing import Iterable

from .models import Scheme

DATA_DIR = pathlib.Path(__file__).resolve().parents[1] / "data"
DEFAULT_PATH = DATA_DIR / "schemes.json"

VALID_OPS = {
    "==", "!=", "<", "<=", ">", ">=", "in", "not_in", "between",
    "contains", "contains_any", "contains_dependent",
}


class CorpusError(ValueError):
    pass


def validate(schemes: list[Scheme]) -> None:
    """Fail loudly on a malformed corpus rather than silently mis-ranking."""
    seen_ids: set[str] = set()
    seen_clause_ids: set[str] = set()
    for s in schemes:
        if s.id in seen_ids:
            raise CorpusError(f"duplicate scheme id: {s.id}")
        seen_ids.add(s.id)
        if not s.clauses:
            raise CorpusError(f"scheme {s.id} has no clauses")
        if s.level == "state" and not s.state:
            raise CorpusError(f"state-level scheme {s.id} has no state")
        for c in s.clauses:
            if c.id in seen_clause_ids:
                raise CorpusError(f"duplicate clause id: {c.id}")
            seen_clause_ids.add(c.id)
            if not c.text.strip():
                raise CorpusError(f"empty clause text in {c.id}")
            if c.constraint is None:
                continue
            if c.constraint.op not in VALID_OPS:
                raise CorpusError(f"unknown op {c.constraint.op!r} in {c.id}")
            if c.constraint.op == "between":
                v = c.constraint.value
                if not (isinstance(v, (list, tuple)) and len(v) == 2):
                    raise CorpusError(f"'between' needs a 2-item value in {c.id}")


def load(path: str | pathlib.Path | None = None) -> list[Scheme]:
    path = pathlib.Path(path) if path else DEFAULT_PATH
    if not path.exists():
        raise CorpusError(
            f"corpus not found at {path}. Run: python scripts/build_corpus.py"
        )
    payload = json.loads(path.read_text())
    raw: Iterable[dict] = (
        payload["schemes"] if isinstance(payload, dict) else payload
    )
    schemes = [Scheme.from_dict(d) for d in raw]
    validate(schemes)
    return schemes


def provenance(path: str | pathlib.Path | None = None) -> dict:
    path = pathlib.Path(path) if path else DEFAULT_PATH
    payload = json.loads(path.read_text())
    if isinstance(payload, dict):
        return payload.get("provenance", {})
    return {}


def stale_ids(schemes: list[Scheme]) -> list[str]:
    """Schemes that have never been verified against the live source."""
    return [s.id for s in schemes if not s.last_verified]
