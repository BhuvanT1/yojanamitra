"""Refresh the scheme corpus from the official portal.

This module is deliberately conservative. It does not silently overwrite the
corpus: it writes a candidate file, reports what changed, and requires an
explicit ``--apply`` to replace the working corpus. Eligibility text is what the
system quotes to citizens, so a bad scrape is worse than a stale record.

Constraints are NOT invented by the scraper. Free text is captured verbatim and
the typed constraints from the existing record are carried over where the clause
text is unchanged; where it changed, the constraint is dropped and the clause is
flagged for human re-annotation. A condition nobody has checked must not silently
start deciding people's eligibility.

Usage
-----
    python -m yojanamitra.scraper refresh --limit 50
    python -m yojanamitra.scraper refresh --apply

Requires network access. The portal is a JavaScript application whose public
JSON endpoint has changed shape before, so ``SEARCH_ENDPOINT`` and the field
names in ``_parse_scheme`` are the two places to look when it breaks.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import sys
import time
from typing import Any, Iterable

from .corpus import DEFAULT_PATH, load

BASE = "https://www.myscheme.gov.in"
SEARCH_ENDPOINT = f"{BASE}/api/search"
DETAIL_ENDPOINT = f"{BASE}/api/schemes"
USER_AGENT = (
    "YojanaMitra/0.1 (academic project; contact via repository) "
    "python-requests"
)
POLITE_DELAY_S = 1.0


class ScrapeError(RuntimeError):
    pass


def _session():
    try:
        import requests
    except ImportError as exc:  # pragma: no cover
        raise ScrapeError("requests is required for scraping") from exc
    s = requests.Session()
    s.headers.update({"User-Agent": USER_AGENT, "Accept": "application/json"})
    return s


def fetch_index(limit: int = 200) -> list[dict]:  # pragma: no cover - network
    """Page through the portal's search endpoint."""
    session = _session()
    out: list[dict] = []
    page = 0
    while len(out) < limit:
        resp = session.get(
            SEARCH_ENDPOINT,
            params={"lang": "en", "q": "[]", "keyword": "", "sort": "", "from": page * 20, "size": 20},
            timeout=30,
        )
        if resp.status_code != 200:
            raise ScrapeError(f"search returned HTTP {resp.status_code}")
        payload = resp.json()
        items = (
            payload.get("data", {}).get("hits", {}).get("items")
            or payload.get("data", {}).get("items")
            or []
        )
        if not items:
            break
        out.extend(items)
        page += 1
        time.sleep(POLITE_DELAY_S)
    return out[:limit]


def _text(node: Any) -> str:
    """Flatten the portal's rich-text blocks into plain text."""
    if node is None:
        return ""
    if isinstance(node, str):
        return node.strip()
    if isinstance(node, list):
        return " ".join(_text(n) for n in node).strip()
    if isinstance(node, dict):
        for key in ("text", "content", "children", "value"):
            if key in node:
                return _text(node[key])
    return ""


def split_clauses(text: str) -> list[str]:
    """Split eligibility prose into clause-sized chunks.

    Clause-level chunking is what makes a citation precise: quoting a whole
    eligibility section back at someone proves nothing.
    """
    import re

    parts = re.split(r"(?<=[.;])\s+(?=[A-Z(])|\n+|(?:^|\n)\s*[-•*]\s*", text)
    return [p.strip(" -•*\n\t") for p in parts if p and len(p.strip()) > 25]


def _parse_scheme(raw: dict) -> dict:  # pragma: no cover - network shape
    slug = raw.get("slug") or raw.get("schemeShortTitle") or ""
    return {
        "id": slug,
        "name": _text(raw.get("schemeName")) or slug,
        "level": (_text(raw.get("level")) or "central").lower(),
        "state": (_text(raw.get("state")) or None),
        "ministry": _text(raw.get("nodalMinistryName")),
        "category": [c for c in (raw.get("schemeCategory") or []) if isinstance(c, str)],
        "benefits": _text(raw.get("briefDescription")) or _text(raw.get("benefits")),
        "eligibility_text": _text(raw.get("eligibilityDescription")),
        "documents": [d for d in (raw.get("documents_required") or []) if isinstance(d, str)],
        "apply_url": raw.get("applicationUrl") or f"{BASE}/schemes/{slug}",
        "source_url": f"{BASE}/schemes/{slug}",
    }


def merge(existing: list, scraped: Iterable[dict]) -> tuple[list[dict], dict]:
    """Merge scraped text into the corpus, carrying constraints forward safely."""
    by_id = {s.id: s for s in existing}
    stamp = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    out: list[dict] = []
    stats = {"new": 0, "updated": 0, "constraints_kept": 0, "constraints_dropped": 0}

    for rec in scraped:
        old = by_id.get(rec["id"])
        old_by_text = {}
        if old:
            old_by_text = {c.text.strip(): c for c in old.clauses}

        clauses = []
        for i, text in enumerate(split_clauses(rec.get("eligibility_text", "")), start=1):
            prior = old_by_text.get(text.strip())
            if prior is not None and prior.constraint is not None:
                stats["constraints_kept"] += 1
                constraint = prior.constraint.to_dict()
                needs_review = False
            else:
                constraint = None
                needs_review = True
                if old:
                    stats["constraints_dropped"] += 1
            clauses.append(
                {
                    "id": f"{rec['id']}-c{i}",
                    "text": text,
                    "constraint": constraint,
                    "needs_annotation": needs_review,
                }
            )

        if not clauses:
            # Never publish a scheme with no eligibility text: with no clauses
            # the rule filter would mark everyone eligible.
            continue

        out.append(
            {
                "id": rec["id"],
                "name": rec["name"],
                "level": rec["level"],
                "state": rec["state"],
                "ministry": rec["ministry"],
                "category": rec["category"],
                "benefits": rec["benefits"],
                "clauses": clauses,
                "documents": rec["documents"],
                "apply_url": rec["apply_url"],
                "source_url": rec["source_url"],
                "last_verified": stamp,
            }
        )
        stats["new" if old is None else "updated"] += 1
    return out, stats


def refresh(limit: int, apply: bool, out_path: pathlib.Path) -> int:  # pragma: no cover
    try:
        index = fetch_index(limit=limit)
    except Exception as exc:
        print(f"scrape failed: {exc}", file=sys.stderr)
        print(
            "The existing corpus is unchanged. If this machine has no network "
            "access to the portal, run this on one that does.",
            file=sys.stderr,
        )
        return 2

    parsed = [_parse_scheme(r) for r in index]
    parsed = [p for p in parsed if p["id"]]
    merged, stats = merge(load(), parsed)
    if not merged:
        print("scrape produced no usable records; corpus unchanged", file=sys.stderr)
        return 3

    needs = sum(
        1 for s in merged for c in s["clauses"] if c.get("needs_annotation")
    )
    payload = {
        "provenance": {
            "kind": "scraped",
            "source": BASE,
            "fetched": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "count": len(merged),
            "clauses_awaiting_annotation": needs,
        },
        "schemes": merged,
    }
    candidate = out_path.with_suffix(".candidate.json")
    candidate.write_text(json.dumps(payload, indent=2, ensure_ascii=False))
    print(json.dumps(stats, indent=2))
    print(f"{needs} clauses need human annotation before they can decide eligibility")
    print(f"candidate written -> {candidate}")
    if apply:
        out_path.write_text(candidate.read_text())
        print(f"applied -> {out_path}")
    else:
        print("review it, then re-run with --apply to replace the working corpus")
    return 0


def main() -> None:  # pragma: no cover
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("command", choices=["refresh"])
    ap.add_argument("--limit", type=int, default=200)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--out", default=str(DEFAULT_PATH))
    args = ap.parse_args()
    sys.exit(refresh(args.limit, args.apply, pathlib.Path(args.out)))


if __name__ == "__main__":
    main()
