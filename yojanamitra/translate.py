"""Optional Indic <-> English translation.

Strategy is translate-then-retrieve: the corpus stays a single English index and
the user's language is handled at the edges. When no translator is configured
the pipeline still runs — Latin-script code-mixed input is largely handled by
the normaliser's synonym tables, and a note tells the user which mode is active.
"""

from __future__ import annotations

import re

from .config import settings

# Unicode blocks for the major Indic scripts.
_SCRIPT_RANGES = {
    "hi": (0x0900, 0x097F),  # Devanagari (Hindi, Marathi)
    "bn": (0x0980, 0x09FF),
    "pa": (0x0A00, 0x0A7F),
    "gu": (0x0A80, 0x0AFF),
    "or": (0x0B00, 0x0B7F),
    "ta": (0x0B80, 0x0BFF),
    "te": (0x0C00, 0x0C7F),
    "kn": (0x0C80, 0x0CFF),
    "ml": (0x0D00, 0x0D7F),
}

#: A small code-mixed lexicon so romanised Hindi/Telugu input degrades usefully
#: even with no translator installed.
ROMANISED_HINTS = {
    r"\bkisan\b": "farmer",
    r"\braitu\b": "farmer",
    r"\bkheti\b": "farming",
    r"\bzameen\s+nahi\b": "landless no land",
    r"\bzameen\b": "land",
    r"\bbeti\b": "daughter",
    r"\bbeta\b": "son",
    r"\bpatni\b": "wife",
    r"\bsaal\b": "years",
    r"\bgaon\b": "village",
    r"\bshehar\b": "city",
    r"\bnaukri\b": "job",
    r"\bberozgar\b": "unemployed",
    r"\bvidhwa\b": "widow",
    r"\bviklang\b": "differently abled",
    r"\bgareeb\b": "poor below poverty line",
    r"\bpadhai\b": "studies",
    r"\bskool\b": "school",
    r"\bpadht[aei]\b": "studying student",
    r"\bpadh\s+raha\b": "studying student",
    r"\bthela\b": "street vending stall",
    r"\bdukan\b": "shop",
    r"\bladki\b": "girl female",
    r"\bmahila\b": "woman female",
    r"\baurat\b": "woman female",
    r"\bki\s+hoon\b": "i am a woman female",
    r"\bka\s+hoon\b": "i am a man male",
    r"\bmajdoor\b": "labourer",
    r"\bmazdoor\b": "labourer",
}


def detect_language(text: str) -> str:
    counts: dict[str, int] = {}
    for ch in text:
        cp = ord(ch)
        for lang, (lo, hi) in _SCRIPT_RANGES.items():
            if lo <= cp <= hi:
                counts[lang] = counts.get(lang, 0) + 1
    if not counts:
        return "en"
    return max(counts, key=counts.get)


def expand_romanised(text: str) -> str:
    """Append English glosses for recognised romanised terms.

    Appending rather than replacing keeps the user's own words in the text that
    gets cited back to them.
    """
    found = []
    low = text.lower()
    for pattern, gloss in ROMANISED_HINTS.items():
        if re.search(pattern, low):
            found.append(gloss)
    # A separator keeps appended glosses from sitting adjacent to the user's
    # own numbers, where they would be misread as units ("90000 years").
    return f"{text} . {' '.join(found)}" if found else text


def _translator():  # pragma: no cover - optional path
    if not settings.translate_provider:
        return None
    if settings.translate_provider == "indictrans2":
        try:
            from IndicTransToolkit import IndicProcessor  # type: ignore
            from transformers import AutoModelForSeq2SeqLM, AutoTokenizer  # type: ignore
        except Exception:
            return None
        return ("indictrans2", AutoTokenizer, AutoModelForSeq2SeqLM, IndicProcessor)
    return None


def to_english(text: str) -> tuple[str, str]:
    """Return (english_text, detected_language)."""
    lang = detect_language(text)
    if lang == "en":
        return expand_romanised(text), "en"
    tr = _translator()
    if tr is None:
        # No translator: keep the original so nothing is lost, and let the
        # caller report the degraded mode.
        return text, lang
    return _translate(text, lang, "en"), lang  # pragma: no cover


def from_english(text: str, lang: str) -> str:
    if lang == "en":
        return text
    tr = _translator()
    if tr is None:
        return text
    return _translate(text, "en", lang)  # pragma: no cover


def _translate(text: str, src: str, tgt: str) -> str:  # pragma: no cover
    raise NotImplementedError(
        "Configure YM_TRANSLATE_PROVIDER=indictrans2 and install the IndicTrans2 "
        "toolkit to enable machine translation."
    )
