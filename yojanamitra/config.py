"""Runtime configuration and capability detection.

The system is designed to run with nothing but the standard scientific Python
stack. Heavier components (a sentence encoder, a cross-encoder, a translator, an
LLM) are strictly optional upgrades: if the model or key is absent the pipeline
substitutes a weaker but working component and records a note, rather than
failing. ``capabilities()`` is what the UI reports so a user always knows which
mode they are in.
"""

from __future__ import annotations

import os
from dataclasses import dataclass


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


@dataclass
class Settings:
    # Retrieval
    embedding_model: str = _env("YM_EMBEDDING_MODEL", "")
    cross_encoder_model: str = _env("YM_CROSS_ENCODER_MODEL", "")
    dense_weight: float = float(_env("YM_DENSE_WEIGHT", "0.6"))
    bm25_weight: float = float(_env("YM_BM25_WEIGHT", "0.4"))
    retrieve_k: int = int(_env("YM_RETRIEVE_K", "25"))
    rerank_k: int = int(_env("YM_RERANK_K", "10"))

    # Extraction
    ner_model: str = _env("YM_NER_MODEL", "")

    # Generation
    llm_provider: str = _env("YM_LLM_PROVIDER", "")  # "", "openai", "ollama"
    llm_model: str = _env("YM_LLM_MODEL", "")
    llm_api_key: str = _env("YM_LLM_API_KEY", "")
    llm_base_url: str = _env("YM_LLM_BASE_URL", "")

    # Translation
    translate_provider: str = _env("YM_TRANSLATE_PROVIDER", "")

    corpus_path: str = _env("YM_CORPUS", "")


settings = Settings()


def _importable(module: str) -> bool:
    import importlib.util

    try:
        return importlib.util.find_spec(module) is not None
    except (ImportError, ValueError):
        return False


def capabilities() -> dict[str, bool | str]:
    """What this installation can actually do right now."""
    dense = "tfidf"
    if settings.embedding_model and _importable("sentence_transformers"):
        dense = f"embeddings:{settings.embedding_model}"
    return {
        "dense_retrieval": dense,
        # BM25 is implemented in retrieval.py, so it is always the lexical
        # signal — there is no weaker fallback and no optional dependency.
        "lexical_retrieval": "bm25 (built-in)",
        "cross_encoder": bool(
            settings.cross_encoder_model and _importable("sentence_transformers")
        ),
        "ner": bool(settings.ner_model and _importable("transformers")),
        "llm_explanations": bool(settings.llm_provider),
        "translation": bool(settings.translate_provider),
    }


def degraded_notes() -> list[str]:
    """Human-readable notes about which components are running in fallback mode."""
    caps = capabilities()
    notes = []
    if caps["dense_retrieval"] == "tfidf":
        notes.append(
            "Dense retrieval is using TF-IDF character/word vectors — set "
            "YM_EMBEDDING_MODEL to use a multilingual sentence encoder."
        )
    if not caps["cross_encoder"]:
        notes.append("Reranking is score-fusion only — no cross-encoder configured.")
    if not caps["llm_explanations"]:
        notes.append(
            "Explanations are extractive templates quoting the matched clause — "
            "no LLM configured. Eligibility verdicts are unaffected either way."
        )
    if not caps["translation"]:
        notes.append("Non-English input is handled by transliteration cues only.")
    return notes
