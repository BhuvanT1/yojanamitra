"""Command-line demo.

    python demo.py "I'm a farmer in Andhra, I own 2 acres, my daughter is in 11th class"
    python demo.py --all          # run the built-in examples
"""

from __future__ import annotations

import argparse
import sys

from yojanamitra import config
from yojanamitra.models import Status, Verdict
from yojanamitra.pipeline import YojanaMitra

EXAMPLES = [
    "I'm a farmer in Andhra, I own 2 acres, my daughter is in 11th class, and I earn about 1.8 lakh a year in my village.",
    "I am a 20 year old girl doing B.Tech in Tamil Nadu, SC category, family income 2 lakh per year, we live in a town.",
    "52 saal ki vidhwa hoon, Bihar ke gaon mein, koi zameen nahi, BPL card hai, saal ka 40000",
    "I am 68, living in a village in Uttar Pradesh, I own no land, BPL card, income around 30000 a year.",
    "I am 29 and work as a fisherman in a coastal village in Kerala, my income is about 1.6 lakh a year.",
]

MARK = {Status.SATISFIED: "OK ", Status.VIOLATED: "NO ", Status.UNKNOWN: "?  "}
BADGE = {
    Verdict.ELIGIBLE: "YOU QUALIFY",
    Verdict.LIKELY_ELIGIBLE: "LIKELY - needs confirming",
    Verdict.INELIGIBLE: "RULED OUT",
}


def show(engine: YojanaMitra, text: str, top_k: int, verbose: bool) -> None:
    print("=" * 78)
    print(f"> {text}")
    print("=" * 78)
    answer = engine.answer(text, top_k=top_k)

    known = ", ".join(
        f"{k}={v.value}" for k, v in sorted(answer.profile.values.items())
    )
    print(f"\nUnderstood: {known or '(nothing)'}")
    if answer.clarifying_question:
        print(f"Would ask:  {answer.clarifying_question}")
    print()

    if not answer.results:
        print("  No schemes matched.")
    for i, r in enumerate(answer.results, 1):
        print(f"{i}. {r.scheme.name}")
        print(f"   [{BADGE[r.verdict]}]  {r.explanation}")
        if r.scheme.documents:
            print(f"   Documents: {', '.join(r.scheme.documents[:4])}")
        print(f"   Apply: {r.scheme.apply_url}")
        if verbose:
            for c in r.checks:
                print(f"     {MARK[c.status]} {c.clause_text}")
                print(f"         -> {c.reason}  [{c.clause_id}]")
        print()

    print("timings: " + " ".join(f"{k}={v:.1f}ms" for k, v in answer.timings_ms.items()))
    for n in answer.notes:
        print(f"note: {n}")
    print()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("text", nargs="*", help="a description of your situation")
    ap.add_argument("--all", action="store_true", help="run the built-in examples")
    ap.add_argument("-k", "--top-k", type=int, default=5)
    ap.add_argument("-v", "--verbose", action="store_true",
                    help="print every clause check")
    args = ap.parse_args()

    engine = YojanaMitra()
    print(f"capabilities: {config.capabilities()}\n")

    if args.all or not args.text:
        for ex in EXAMPLES:
            show(engine, ex, args.top_k, args.verbose)
    else:
        show(engine, " ".join(args.text), args.top_k, args.verbose)


if __name__ == "__main__":
    sys.exit(main())
