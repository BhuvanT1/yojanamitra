"""Hybrid retrieval over the scheme corpus.

Two independent signals, fused:

* a **dense** signal over meaning, so "cultivator" retrieves for "farmer"
  (a multilingual sentence encoder when one is configured, TF-IDF otherwise);
* a **lexical** BM25 signal, so exact scheme names, acronyms and rare terms
  ("PM-KISAN", "Ujjwala") are never lost by an embedding that smooths them away.

Retrieval only proposes candidates. Nothing here decides eligibility.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

import numpy as np

from .config import settings
from .models import Profile, Scheme

_TOKEN = re.compile(r"[a-z0-9]+")


def tokenize(text: str) -> list[str]:
    return _TOKEN.findall(text.lower())


def profile_to_query(profile: Profile) -> str:
    """Render a profile as the sentence a scheme document would use.

    This is the actual translation step: the citizen's words become the
    register the corpus is written in, which is what lets a dense encoder
    match them.
    """
    bits: list[str] = [profile.raw_text]
    occ = profile.get("occupation") or []
    if "farmer" in occ:
        bits.append("landholding farmer cultivator agriculture")
    if "student" in occ:
        bits.append("student pursuing studies education scholarship")
    if "labourer" in occ:
        bits.append("unskilled manual wage labour employment")
    if "weaver" in occ:
        bits.append("artisan craftsperson handloom weaver")
    if "fisherman" in occ:
        bits.append("fisher fish worker fisheries")
    if "shopkeeper" in occ or "self_employed" in occ:
        bits.append("street vendor micro enterprise self employment")

    land = profile.get("land_acres")
    if land is not None:
        bits.append("landless" if land == 0 else f"cultivable landholding {land:g} acres")

    age = profile.get("age")
    if age is not None:
        bits.append(f"aged {age} years")
        if age >= 60:
            bits.append("senior citizen old age pension")
        elif age < 18:
            bits.append("child student pre matric")

    if profile.get("gender") == "female":
        bits.append("woman girl female beneficiary")

    stage = profile.get("education_stage")
    if stage:
        bits.append(stage.replace("_", " ") + " education scholarship")

    for dep in profile.get("dependents") or []:
        if dep.get("gender") == "female":
            bits.append("girl child daughter")
        if dep.get("education_stage"):
            bits.append(dep["education_stage"].replace("_", " ") + " school scholarship")

    cat = profile.get("category")
    if cat:
        bits.append(
            {"sc": "scheduled caste", "st": "scheduled tribe",
             "obc": "other backward class", "ews": "economically weaker section"}.get(cat, cat)
        )

    for sc in profile.get("special_categories") or []:
        bits.append(sc.replace("_", " "))
        if sc == "bpl":
            bits.append("below poverty line ration card deprived household")

    income = profile.get("annual_income_inr")
    if income is not None:
        bits.append(f"annual family income rupees {income}")

    state = profile.get("state")
    if state:
        bits.append(f"resident of {state}")

    residence = profile.get("residence")
    if residence:
        bits.append(f"{residence} household")

    return " ".join(b for b in bits if b)


# --------------------------------------------------------------------------
# Lexical signal
# --------------------------------------------------------------------------


class BM25:
    """Okapi BM25. Small local implementation so the package has a working
    lexical signal even when rank_bm25 is not installed."""

    def __init__(self, corpus: list[list[str]], k1: float = 1.5, b: float = 0.75):
        self.k1, self.b = k1, b
        self.corpus = corpus
        self.n = len(corpus)
        self.doc_len = [len(d) for d in corpus]
        self.avgdl = (sum(self.doc_len) / self.n) if self.n else 0.0
        self.df: dict[str, int] = {}
        self.tf: list[dict[str, int]] = []
        for doc in corpus:
            freqs: dict[str, int] = {}
            for token in doc:
                freqs[token] = freqs.get(token, 0) + 1
            self.tf.append(freqs)
            for token in freqs:
                self.df[token] = self.df.get(token, 0) + 1
        self.idf = {
            t: math.log(1 + (self.n - c + 0.5) / (c + 0.5)) for t, c in self.df.items()
        }

    def scores(self, query: list[str]) -> np.ndarray:
        out = np.zeros(self.n, dtype=float)
        for token in query:
            idf = self.idf.get(token)
            if idf is None:
                continue
            for i in range(self.n):
                f = self.tf[i].get(token, 0)
                if not f:
                    continue
                denom = f + self.k1 * (
                    1 - self.b + self.b * self.doc_len[i] / (self.avgdl or 1)
                )
                out[i] += idf * f * (self.k1 + 1) / denom
        return out


# --------------------------------------------------------------------------
# Dense signal
# --------------------------------------------------------------------------


class DenseIndex:
    """Sentence-encoder index when configured, TF-IDF otherwise.

    Both expose the same ``scores(query) -> np.ndarray`` interface, so the rest
    of the pipeline does not know or care which one is active.
    """

    def __init__(self, texts: list[str]):
        self.texts = texts
        self.model = None
        self.embeddings = None
        if settings.embedding_model:
            try:  # pragma: no cover - optional path
                from sentence_transformers import SentenceTransformer

                self.model = SentenceTransformer(settings.embedding_model)
                self.embeddings = self.model.encode(
                    texts, normalize_embeddings=True, show_progress_bar=False
                )
            except Exception:
                self.model = None
        if self.model is None:
            from sklearn.feature_extraction.text import TfidfVectorizer

            self.vectorizer = TfidfVectorizer(
                sublinear_tf=True,
                ngram_range=(1, 2),
                min_df=1,
                stop_words="english",
            )
            self.matrix = self.vectorizer.fit_transform(texts)

    @property
    def backend(self) -> str:
        return "embeddings" if self.model is not None else "tfidf"

    def scores(self, query: str) -> np.ndarray:
        if self.model is not None:  # pragma: no cover - optional path
            q = self.model.encode([query], normalize_embeddings=True)
            return (self.embeddings @ q[0]).astype(float)
        from sklearn.metrics.pairwise import cosine_similarity

        qv = self.vectorizer.transform([query])
        return cosine_similarity(qv, self.matrix)[0].astype(float)


def _minmax(x: np.ndarray) -> np.ndarray:
    if x.size == 0:
        return x
    lo, hi = float(x.min()), float(x.max())
    if hi - lo < 1e-12:
        return np.zeros_like(x)
    return (x - lo) / (hi - lo)


@dataclass
class Candidate:
    scheme: Scheme
    score: float
    dense: float
    lexical: float


class Retriever:
    def __init__(self, schemes: list[Scheme]):
        self.schemes = schemes
        texts = [s.search_text() for s in schemes]
        self.dense = DenseIndex(texts)
        self.bm25 = BM25([tokenize(t) for t in texts])
        self._cross = None
        self._cross_tried = False

    # -- optional cross-encoder -------------------------------------------
    def _cross_encoder(self):
        if self._cross_tried:
            return self._cross
        self._cross_tried = True
        if settings.cross_encoder_model:
            try:  # pragma: no cover - optional path
                from sentence_transformers import CrossEncoder

                self._cross = CrossEncoder(settings.cross_encoder_model)
            except Exception:
                self._cross = None
        return self._cross

    def search(self, query: str, k: int | None = None) -> list[Candidate]:
        k = k or settings.retrieve_k
        d = _minmax(self.dense.scores(query))
        l = _minmax(self.bm25.scores(tokenize(query)))
        fused = settings.dense_weight * d + settings.bm25_weight * l
        order = np.argsort(-fused)[: max(k, 1)]
        cands = [
            Candidate(self.schemes[i], float(fused[i]), float(d[i]), float(l[i]))
            for i in order
        ]
        return self.rerank(query, cands)

    def rerank(self, query: str, cands: list[Candidate]) -> list[Candidate]:
        ce = self._cross_encoder()
        if ce is None or not cands:
            return cands
        try:  # pragma: no cover - optional path
            pairs = [(query, c.scheme.search_text()[:2000]) for c in cands]
            scores = ce.predict(pairs)
            for c, s in zip(cands, scores):
                c.score = float(s)
            cands.sort(key=lambda c: -c.score)
        except Exception:
            pass
        return cands


class KeywordBaseline:
    """The baseline the deck promises to report against.

    Plain token overlap between the raw utterance and the scheme text — what a
    portal search box does. Kept deliberately simple; its whole job is to show
    what the NLP pipeline buys over it.
    """

    def __init__(self, schemes: list[Scheme]):
        self.schemes = schemes
        self.docs = [set(tokenize(s.search_text())) for s in schemes]

    def search(self, text: str, k: int = 10) -> list[Scheme]:
        q = set(tokenize(text))
        scored = [
            (len(q & doc) / (len(q) or 1), i) for i, doc in enumerate(self.docs)
        ]
        scored.sort(reverse=True)
        return [self.schemes[i] for s, i in scored[:k] if s > 0]
