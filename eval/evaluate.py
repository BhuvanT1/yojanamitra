"""Evaluation harness.

Reports the metrics the project committed to:

* extraction  — per-field precision / recall / F1 against ground-truth profiles
* retrieval   — Recall@5, Recall@10 and MRR, against a keyword-search baseline
* explanation — citation accuracy and hallucinated-eligibility rate
* usability   — end-to-end latency

Run: python -m eval.evaluate [--json report.json]
"""

from __future__ import annotations

import argparse
import json
import pathlib
import statistics
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from yojanamitra import config, corpus  # noqa: E402
from yojanamitra.models import Status, Verdict  # noqa: E402
from yojanamitra.pipeline import YojanaMitra  # noqa: E402

GOLD = pathlib.Path(__file__).resolve().parents[1] / "data" / "gold_set.json"

#: Fields compared exactly vs. numerically (with tolerance).
NUMERIC_FIELDS = {"age", "annual_income_inr", "land_acres"}
SET_FIELDS = {"occupation", "special_categories"}
COMPARED_FIELDS = [
    "age", "annual_income_inr", "land_acres", "state",
    "occupation", "category", "gender", "residence", "education_stage",
]


def values_match(field: str, pred, truth) -> bool:
    if pred is None or truth is None:
        return False
    if field in NUMERIC_FIELDS:
        try:
            return abs(float(pred) - float(truth)) <= max(1e-6, abs(float(truth)) * 0.02)
        except (TypeError, ValueError):
            return False
    if field in SET_FIELDS:
        return bool(set(pred or []) & set(truth or []))
    return str(pred) == str(truth)


def recall_at_k(retrieved: list[str], expected: list[str], k: int) -> float:
    if not expected:
        return float("nan")
    top = set(retrieved[:k])
    return len(top & set(expected)) / len(expected)


def recall_at_k_capped(retrieved: list[str], expected: list[str], k: int) -> float:
    """Recall normalised by what k slots can physically hold.

    Personas here average ~8 provably-eligible schemes, so plain recall@5 is
    capped at 5/8 no matter how good retrieval is. This variant divides by
    min(k, |expected|), so 1.0 means "every slot was used correctly" and the
    number is comparable across items with different numbers of targets. Both
    are reported; the uncapped one is the conservative reading.
    """
    if not expected:
        return float("nan")
    top = set(retrieved[:k])
    return len(top & set(expected)) / min(k, len(expected))


def mrr(retrieved: list[str], expected: list[str]) -> float:
    exp = set(expected)
    for rank, sid in enumerate(retrieved, start=1):
        if sid in exp:
            return 1.0 / rank
    return 0.0


def answer_metrics(ym: YojanaMitra, items: list[dict], top_k: int = 5) -> dict:
    """Precision/recall of the FINAL answer, which is what a user sees.

    Retrieval metrics alone understate the system, because the rule filter runs
    over the whole corpus and can promote a scheme that ranked poorly on text
    similarity. This measures the list the user is actually shown.
    """
    precs, recs, hit1 = [], [], []
    for item in items:
        expected = set(item["expected_schemes"])
        shown = [r.scheme.id for r in ym.answer(item["text"], top_k=top_k).results]
        if not expected:
            continue
        inter = len(set(shown) & expected)
        precs.append(inter / len(shown) if shown else 0.0)
        recs.append(inter / min(top_k, len(expected)))
        hit1.append(1.0 if shown and shown[0] in expected else 0.0)
    n = len(precs) or 1
    return {
        f"precision@{top_k}": sum(precs) / n,
        f"recall@{top_k}_capped": sum(recs) / n,
        "hit@1": sum(hit1) / n,
    }


def evaluate(limit: int | None = None) -> dict:
    payload = json.loads(GOLD.read_text())
    items = payload["data"][:limit] if limit else payload["data"]
    schemes = corpus.load()
    ym = YojanaMitra(schemes=schemes)

    tp = {f: 0 for f in COMPARED_FIELDS}
    fp = {f: 0 for f in COMPARED_FIELDS}
    fn = {f: 0 for f in COMPARED_FIELDS}

    r5, r10, mrrs, r5c = [], [], [], []
    b5, b10, bmrrs, b5c = [], [], [], []
    latencies = []
    citation_total = citation_ok = 0
    hallucinated = 0
    answered_schemes = 0
    unverified_surfaced = 0
    by_phrasing: dict[str, list[float]] = {}

    for item in items:
        truth = item["profile"]
        expected = item["expected_schemes"]

        # ---- extraction --------------------------------------------------
        profile = ym.profile_for(item["text"])
        for f in COMPARED_FIELDS:
            pred = profile.get(f)
            gold = truth.get(f)
            if gold is None and pred is None:
                continue
            if gold is None and pred is not None:
                fp[f] += 1
            elif gold is not None and pred is None:
                fn[f] += 1
            elif values_match(f, pred, gold):
                tp[f] += 1
            else:
                fp[f] += 1
                fn[f] += 1

        # ---- retrieval ---------------------------------------------------
        retrieved = ym.retrieve_ids(item["text"], k=10)
        r5.append(recall_at_k(retrieved, expected, 5))
        r10.append(recall_at_k(retrieved, expected, 10))
        r5c.append(recall_at_k_capped(retrieved, expected, 5))
        mrrs.append(mrr(retrieved, expected))
        by_phrasing.setdefault(item["phrasing"], []).append(
            recall_at_k(retrieved, expected, 10)
        )

        base = ym.baseline_ids(item["text"], k=10)
        b5.append(recall_at_k(base, expected, 5))
        b10.append(recall_at_k(base, expected, 10))
        b5c.append(recall_at_k_capped(base, expected, 5))
        bmrrs.append(mrr(base, expected))

        # ---- end-to-end answer, explanation checks -----------------------
        t0 = time.perf_counter()
        answer = ym.answer(item["text"], top_k=5)
        latencies.append((time.perf_counter() - t0) * 1000)

        for res in answer.results:
            answered_schemes += 1
            satisfied = [c for c in res.checks if c.status is Status.SATISFIED]
            unknown = [c for c in res.checks if c.status is Status.UNKNOWN]
            if unknown:
                unverified_surfaced += 1

            # Citation accuracy: a positive explanation must rest on at least
            # one clause that the rule filter actually marked satisfied, and
            # the clause must exist in the scheme.
            if res.verdict in (Verdict.ELIGIBLE, Verdict.LIKELY_ELIGIBLE):
                citation_total += 1
                clause_ids = {c.id for c in res.scheme.clauses} | {
                    f"{res.scheme.id}-implicit-state"
                }
                ids_valid = all(c.clause_id in clause_ids for c in res.checks)
                if satisfied and ids_valid:
                    citation_ok += 1

            # Hallucinated eligibility: a fully-eligible verdict that still has
            # an unproven condition, or any verdict asserting eligibility with
            # no satisfied clause at all.
            if res.verdict is Verdict.ELIGIBLE and unknown:
                hallucinated += 1
            if res.verdict is Verdict.ELIGIBLE and not satisfied:
                hallucinated += 1

    def prf(f: str) -> dict:
        p = tp[f] / (tp[f] + fp[f]) if (tp[f] + fp[f]) else float("nan")
        r = tp[f] / (tp[f] + fn[f]) if (tp[f] + fn[f]) else float("nan")
        f1 = 2 * p * r / (p + r) if p and r and (p + r) else 0.0
        return {"precision": p, "recall": r, "f1": f1,
                "tp": tp[f], "fp": fp[f], "fn": fn[f]}

    per_field = {f: prf(f) for f in COMPARED_FIELDS}
    micro_tp = sum(tp.values()); micro_fp = sum(fp.values()); micro_fn = sum(fn.values())
    micro_p = micro_tp / (micro_tp + micro_fp) if (micro_tp + micro_fp) else 0.0
    micro_r = micro_tp / (micro_tp + micro_fn) if (micro_tp + micro_fn) else 0.0
    micro_f1 = 2 * micro_p * micro_r / (micro_p + micro_r) if (micro_p + micro_r) else 0.0

    def mean(xs):
        xs = [x for x in xs if x == x]  # drop NaN
        return sum(xs) / len(xs) if xs else 0.0

    ablation = {
        "rule_filter_over_all_schemes": answer_metrics(ym, items),
        "rule_filter_over_retrieved_only": answer_metrics(
            YojanaMitra(schemes=schemes, rule_scope="retrieved"), items
        ),
    }

    return {
        "n_items": len(items),
        "final_answer": ablation,
        "n_schemes": len(schemes),
        "capabilities": config.capabilities(),
        "methodology": payload["methodology"],
        "extraction": {
            "per_field": per_field,
            "micro": {"precision": micro_p, "recall": micro_r, "f1": micro_f1},
        },
        "retrieval": {
            "system": {"recall@5": mean(r5), "recall@5_capped": mean(r5c),
                       "recall@10": mean(r10), "mrr": mean(mrrs)},
            "keyword_baseline": {
                "recall@5": mean(b5), "recall@5_capped": mean(b5c),
                "recall@10": mean(b10), "mrr": mean(bmrrs)
            },
            "by_phrasing_recall@10": {k: mean(v) for k, v in by_phrasing.items()},
        },
        "explanation": {
            "citation_accuracy": citation_ok / citation_total if citation_total else 0.0,
            "hallucinated_eligibility_rate": (
                hallucinated / answered_schemes if answered_schemes else 0.0
            ),
            "results_with_open_conditions": (
                unverified_surfaced / answered_schemes if answered_schemes else 0.0
            ),
            "n_results_scored": answered_schemes,
        },
        "latency_ms": {
            "median": statistics.median(latencies) if latencies else 0.0,
            "p90": (
                statistics.quantiles(latencies, n=10)[8]
                if len(latencies) >= 10 else max(latencies, default=0.0)
            ),
            "max": max(latencies, default=0.0),
        },
    }


def render(report: dict) -> str:
    L: list[str] = []
    a = L.append
    a("=" * 74)
    a("YojanaMitra evaluation")
    a("=" * 74)
    a(f"items: {report['n_items']}   schemes: {report['n_schemes']}")
    a(f"capabilities: {report['capabilities']}")
    a("")
    a("EXTRACTION (per-field)")
    a(f"  {'field':22s} {'P':>7s} {'R':>7s} {'F1':>7s}   tp/fp/fn")
    for f, m in report["extraction"]["per_field"].items():
        p, r, f1 = m["precision"], m["recall"], m["f1"]
        fmt = lambda x: f"{x:7.3f}" if x == x else "    n/a"  # noqa: E731
        a(f"  {f:22s} {fmt(p)} {fmt(r)} {fmt(f1)}   {m['tp']}/{m['fp']}/{m['fn']}")
    mi = report["extraction"]["micro"]
    a(f"  {'MICRO AVERAGE':22s} {mi['precision']:7.3f} {mi['recall']:7.3f} {mi['f1']:7.3f}")
    a("")
    a("RETRIEVAL (vs keyword-search baseline)")
    s, b = report["retrieval"]["system"], report["retrieval"]["keyword_baseline"]
    a(f"  {'metric':14s} {'system':>10s} {'baseline':>10s} {'delta':>10s}")
    for k in ("recall@5", "recall@5_capped", "recall@10", "mrr"):
        a(f"  {k:14s} {s[k]:10.3f} {b[k]:10.3f} {s[k]-b[k]:+10.3f}")
    a("  recall@10 by phrasing:")
    for k, v in report["retrieval"]["by_phrasing_recall@10"].items():
        a(f"    {k:14s} {v:.3f}")
    a("")
    a("FINAL ANSWER (what the user is shown, top 5)")
    fa = report["final_answer"]
    a(f"  {'rule-filter scope':34s} {'P@5':>8s} {'R@5cap':>8s} {'hit@1':>8s}")
    for name, m in fa.items():
        a(f"  {name:34s} {m['precision@5']:8.3f} "
          f"{m['recall@5_capped']:8.3f} {m['hit@1']:8.3f}")
    a("")
    a("EXPLANATION")
    e = report["explanation"]
    a(f"  citation accuracy              {e['citation_accuracy']:.3f}")
    a(f"  hallucinated eligibility rate  {e['hallucinated_eligibility_rate']:.3f}")
    a(f"  results with open conditions   {e['results_with_open_conditions']:.3f}")
    a("")
    a("LATENCY (end to end, ms)")
    l = report["latency_ms"]
    a(f"  median {l['median']:.1f}   p90 {l['p90']:.1f}   max {l['max']:.1f}")
    a("")
    a("CAVEAT")
    for line in report["methodology"].split(". "):
        if line.strip():
            a(f"  {line.strip().rstrip('.')}.")
    a("=" * 74)
    return "\n".join(L)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", help="write the raw report to this path")
    ap.add_argument("--limit", type=int, help="evaluate only the first N items")
    args = ap.parse_args()
    report = evaluate(limit=args.limit)
    print(render(report))
    if args.json:
        pathlib.Path(args.json).write_text(json.dumps(report, indent=2, default=str))
        print(f"\nraw report -> {args.json}")


if __name__ == "__main__":
    main()
