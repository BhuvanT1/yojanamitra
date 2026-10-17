"""End-to-end orchestration.

    text -> [translate] -> extract -> retrieve -> RULE FILTER -> explain

The ordering is the point. Retrieval is generous and fuzzy; the rule filter is
strict and deterministic; the explainer only ever reports what the filter
already established.
"""

from __future__ import annotations

import time
from typing import Callable, Optional

from . import config, corpus, explain as explain_mod, extraction, rules, translate
from .models import Answer, Profile, Result, Scheme, Status, Verdict
from .retrieval import KeywordBaseline, Retriever, profile_to_query

LLMFn = Callable[[str], str]

#: How much a scheme's ranking gains per independently proven condition, and
#: the point past which extra proof stops helping. Tuned so a strong topical
#: match with one proven condition still leads a weak match with three.
PROOF_BONUS = 0.12
PROOF_CAP = 3

VERDICT_ORDER = {
    Verdict.ELIGIBLE: 0,
    Verdict.LIKELY_ELIGIBLE: 1,
    Verdict.INELIGIBLE: 2,
}


class YojanaMitra:
    def __init__(
        self,
        schemes: Optional[list[Scheme]] = None,
        llm: Optional[LLMFn] = None,
        corpus_path: Optional[str] = None,
        rule_scope: str = "all",
    ):
        self.schemes = schemes if schemes is not None else corpus.load(
            corpus_path or config.settings.corpus_path or None
        )
        self.retriever = Retriever(self.schemes)
        self.baseline = KeywordBaseline(self.schemes)
        self.llm = llm
        if rule_scope not in {"all", "retrieved"}:
            raise ValueError("rule_scope must be 'all' or 'retrieved'")
        #: "all" checks every scheme (default, recommended). "retrieved" is the
        #: classic two-stage arrangement, kept so the two can be compared.
        self.rule_scope = rule_scope

    # -- main entry point --------------------------------------------------
    def answer(
        self,
        text: str,
        top_k: int = 5,
        include_ineligible: bool = False,
    ) -> Answer:
        timings: dict[str, float] = {}
        notes = list(config.degraded_notes())

        t0 = time.perf_counter()
        english, lang = translate.to_english(text)
        timings["translate"] = (time.perf_counter() - t0) * 1000
        if lang != "en" and english == text:
            notes.append(
                f"Input looks like '{lang}' but no translator is configured, so "
                "matching quality will be reduced."
            )

        t0 = time.perf_counter()
        profile = extraction.extract(english, llm=self.llm, language=lang)
        timings["extract"] = (time.perf_counter() - t0) * 1000

        t0 = time.perf_counter()
        query = profile_to_query(profile)
        # Retrieval is asked for scores over the whole corpus, not a shortlist.
        candidates = self.retriever.search(query, k=len(self.schemes))
        score_by_id = {c.scheme.id: c.score for c in candidates}
        timings["retrieve"] = (time.perf_counter() - t0) * 1000

        # The rule filter runs over EVERY scheme, not only what retrieval ranked
        # highly. This matters: a farmer never says the word "pension", so a
        # similarity search will not surface Atal Pension Yojana for them — yet
        # they plainly qualify on age. Constraint checks are dictionary lookups,
        # so evaluating the full corpus is cheap, and it makes recall of
        # provably-eligible schemes a property of the architecture rather than
        # something retrieval has to get lucky at. Retrieval's job is reduced to
        # what it is actually good at: ordering.
        t0 = time.perf_counter()
        scope = (
            self.schemes
            if self.rule_scope == "all"
            else [c.scheme for c in candidates[: config.settings.retrieve_k]]
        )
        results: list[Result] = []
        for scheme in scope:
            verdict, checks = rules.check_scheme(scheme, profile)
            if verdict is Verdict.INELIGIBLE and not include_ineligible:
                continue
            results.append(
                Result(
                    scheme=scheme,
                    verdict=verdict,
                    retrieval_score=score_by_id.get(scheme.id, 0.0),
                    checks=checks,
                    unverified=explain_mod.unverified_conditions(checks),
                )
            )
        timings["rule_filter"] = (time.perf_counter() - t0) * 1000

        # Provable eligibility outranks retrieval similarity: an eligible
        # scheme always sorts above a merely-likely one. WITHIN a tier the two
        # signals are blended rather than applied lexicographically — ordering
        # purely by how many conditions were proven pushes broad schemes
        # (MGNREGS, Atal Pension: two easy age/residence checks) above the one
        # scheme that is actually about the person's livelihood. Topical fit
        # leads; proof depth is a bounded bonus.
        def rank_score(r: Result) -> float:
            proven = sum(1 for c in r.checks if c.status is Status.SATISFIED)
            return r.retrieval_score + PROOF_BONUS * min(proven, PROOF_CAP)

        results.sort(key=lambda r: (VERDICT_ORDER[r.verdict], -rank_score(r)))
        results = results[:top_k]

        t0 = time.perf_counter()
        for r in results:
            r.explanation = explain_mod.explain(r, llm=self.llm)
            if lang != "en":
                r.explanation = translate.from_english(r.explanation, lang)
        timings["explain"] = (time.perf_counter() - t0) * 1000

        question = extraction.needed_clarification(
            profile, relevant=rules.relevant_fields([r.scheme for r in results])
        )

        stale = corpus.stale_ids(self.schemes)
        if stale:
            notes.append(
                f"{len(stale)} of {len(self.schemes)} scheme records have never been "
                "verified against the live portal — treat results as indicative."
            )

        timings["total"] = sum(
            v for k, v in timings.items() if k != "total"
        )
        return Answer(
            profile=profile,
            results=results,
            clarifying_question=question,
            timings_ms=timings,
            notes=notes,
        )

    # -- helpers used by the evaluator ------------------------------------
    def retrieve_ids(self, text: str, k: int = 10) -> list[str]:
        english, _ = translate.to_english(text)
        profile = extraction.extract(english)
        query = profile_to_query(profile)
        return [c.scheme.id for c in self.retriever.search(query, k=k)][:k]

    def baseline_ids(self, text: str, k: int = 10) -> list[str]:
        return [s.id for s in self.baseline.search(text, k=k)]

    def profile_for(self, text: str) -> Profile:
        english, lang = translate.to_english(text)
        return extraction.extract(english, llm=self.llm, language=lang)
