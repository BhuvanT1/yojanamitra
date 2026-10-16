"""Unit, currency and vocabulary normalisation.

Nothing here is learned. These are the deterministic conversions that let a
citizen's phrasing ("2 lakh", "one and a half hectares", "11th class") be
compared against a scheme's thresholds ("annual income up to Rs. 2,50,000",
"holding not exceeding 5 acres", "Class 9 to 12").
"""

from __future__ import annotations

import re
import unicodedata

HECTARE_TO_ACRE = 2.47105
BIGHA_TO_ACRE = 0.625  # varies by region; a documented approximation
GUNTA_TO_ACRE = 0.025
CENT_TO_ACRE = 0.01

WORD_NUMBERS = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
    "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
    "nineteen": 19, "twenty": 20, "thirty": 30, "forty": 40,
    "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
    "half": 0.5,
}

MULTIPLIERS = {
    "hundred": 100,
    "thousand": 1_000,
    "k": 1_000,
    "lakh": 100_000,
    "lakhs": 100_000,
    "lac": 100_000,
    "lacs": 100_000,
    "lakhs.": 100_000,
    "crore": 10_000_000,
    "crores": 10_000_000,
    "cr": 10_000_000,
    "million": 1_000_000,
}

INDIAN_STATES = {
    "andhra pradesh": ["andhra pradesh", "andhra", "ap", "a.p."],
    "arunachal pradesh": ["arunachal pradesh", "arunachal"],
    "assam": ["assam"],
    "bihar": ["bihar"],
    "chhattisgarh": ["chhattisgarh", "chattisgarh"],
    "goa": ["goa"],
    "gujarat": ["gujarat"],
    "haryana": ["haryana"],
    "himachal pradesh": ["himachal pradesh", "himachal", "hp"],
    "jharkhand": ["jharkhand"],
    "karnataka": ["karnataka"],
    "kerala": ["kerala"],
    "madhya pradesh": ["madhya pradesh", "mp", "m.p."],
    "maharashtra": ["maharashtra"],
    "manipur": ["manipur"],
    "meghalaya": ["meghalaya"],
    "mizoram": ["mizoram"],
    "nagaland": ["nagaland"],
    "odisha": ["odisha", "orissa"],
    "punjab": ["punjab"],
    "rajasthan": ["rajasthan"],
    "sikkim": ["sikkim"],
    "tamil nadu": ["tamil nadu", "tamilnadu", "tn"],
    "telangana": ["telangana", "ts"],
    "tripura": ["tripura"],
    "uttar pradesh": ["uttar pradesh", "up", "u.p."],
    "uttarakhand": ["uttarakhand", "uttaranchal"],
    "west bengal": ["west bengal", "bengal", "wb"],
    "delhi": ["delhi", "new delhi", "nct of delhi"],
    "jammu and kashmir": ["jammu and kashmir", "j&k", "jammu & kashmir"],
    "ladakh": ["ladakh"],
    "puducherry": ["puducherry", "pondicherry"],
    "chandigarh": ["chandigarh"],
}

OCCUPATION_SYNONYMS = {
    "farmer": [
        "farmer", "farming", "cultivator", "kisan", "agriculturist", "agriculture",
        "raitu", "krishak", "grower", "tiller", "husbandry",
    ],
    "student": ["student", "studying", "study", "pursuing", "scholar", "vidyarthi",
                "b tech", "btech", "college", "school", "degree", "masters"],
    "labourer": [
        "labourer", "laborer", "daily wage", "daily wager", "construction worker",
        "mazdoor", "coolie", "unskilled worker", "manual worker",
    ],
    "weaver": ["weaver", "handloom", "artisan", "craftsman", "karigar", "potter"],
    "fisherman": ["fisherman", "fisher", "fisherfolk", "fishing"],
    "shopkeeper": ["shopkeeper", "small trader", "vendor", "street vendor", "hawker",
                   "vending", "stall", "shop", "thela", "kirana"],
    "self_employed": ["self employed", "self-employed", "own business", "entrepreneur"],
    "salaried": ["salaried", "employee", "job", "working in", "private job"],
    "unemployed": ["unemployed", "jobless", "no job", "without work", "not working"],
    "homemaker": ["homemaker", "housewife", "grihini"],
}

CATEGORY_SYNONYMS = {
    "sc": ["sc", "scheduled caste", "dalit"],
    "st": ["st", "scheduled tribe", "tribal", "adivasi"],
    "obc": ["obc", "other backward class", "bc", "backward class"],
    "general": ["general category", "general merit", "unreserved", "open category"],
    "ews": ["ews", "economically weaker section"],
    "minority": ["minority"],
}

SPECIAL_CATEGORY_SYNONYMS = {
    "widow": ["widow", "widowed"],
    "senior_citizen": ["senior citizen", "old age", "elderly", "pensioner"],
    "differently_abled": [
        "differently abled", "disabled", "divyang", "handicapped",
        "physically challenged", "pwd", "person with disability",
    ],
    "single_woman": ["single woman", "abandoned woman", "deserted woman"],
    "orphan": ["orphan", "orphaned"],
    "bpl": ["bpl", "below poverty line", "ration card", "antyodaya", "aay"],
    "landless": ["landless", "no land", "without land"],
}

EDUCATION_PATTERNS: list[tuple[str, str]] = [
    (r"\b(?:class|std\.?|standard|grade)\s*(\d{1,2})\b", "CLASS_NUM"),
    (r"\b(\d{1,2})\s*(?:st|nd|rd|th)\s*(?:class|std\.?|standard|grade)\b", "CLASS_NUM"),
    (r"\b(?:b\.?tech|b\.?e\.?|b\.?sc|b\.?com|b\.?a\.?|bba|bca|degree|graduation|"
     r"undergraduate|college|engineering)\b", "undergraduate"),
    (r"\b(?:m\.?tech|m\.?sc|m\.?com|m\.?a\.?|mba|mca|masters?|post ?graduat\w*)\b",
     "postgraduate"),
    (r"\b(?:ph\.?d|doctoral|doctorate|research scholar)\b", "doctoral"),
    (r"\b(?:anganwadi|nursery|kindergarten|pre ?primary|lkg|ukg)\b", "pre_primary"),
    (r"\b(?:not stud\w+|dropped out|drop ?out|left school|never went to school)\b",
     "not_studying"),
]


def strip_accents(text: str) -> str:
    return "".join(
        ch for ch in unicodedata.normalize("NFKD", text) if not unicodedata.combining(ch)
    )


def clean(text: str) -> str:
    """Lowercase, normalise punctuation and digits, collapse whitespace."""
    text = strip_accents(text or "")
    text = text.replace("₹", " rs ").replace("₹", " rs ")
    text = text.replace("–", "-").replace("—", "-").replace("’", "'")
    text = re.sub(r"[^\w\s%.,&/'\-+<>=]", " ", text.lower())
    return re.sub(r"\s+", " ", text).strip()


def _to_float(token: str) -> float | None:
    token = token.replace(",", "").strip()
    if not token:
        return None
    try:
        return float(token)
    except ValueError:
        return WORD_NUMBERS.get(token)


def parse_number(text: str) -> float | None:
    """Parse a leading number, spelled out or numeric."""
    text = text.strip()
    m = re.match(r"^([\d,]+(?:\.\d+)?)", text)
    if m:
        return _to_float(m.group(1))
    for word, val in WORD_NUMBERS.items():
        if text.startswith(word):
            return float(val)
    return None


def parse_money(text: str) -> int | None:
    """Return an annual rupee amount, or None.

    Handles '2 lakh', 'Rs 1,50,000', '50k', '2.5 lakhs per annum', 'three lakh'.
    """
    t = clean(text)
    num_pat = r"(\d[\d,]*(?:\.\d+)?|" + "|".join(WORD_NUMBERS) + r")"
    mult_pat = r"(lakhs?|lacs?|crores?|cr|thousand|hundred|k|million)?"
    for m in re.finditer(num_pat + r"\s*" + mult_pat, t):
        raw, mult = m.group(1), (m.group(2) or "").strip()
        # Skip matches that are clearly not money.
        tail = t[m.end(): m.end() + 24]
        value = _to_float(raw)
        if value is None:
            continue
        hard_skip = r"\s*(acre|hectare|bigha|gunta|cent|%|percent|class|std|standard|grade|kid|child|children|member)"
        if re.match(hard_skip, tail):
            continue
        # "44 years" is an age; "60000 saal ka" is an annual amount. Only a
        # number small enough to be a human age is read as a duration.
        if re.match(r"\s*(years?|yrs?|saal|varsh)", tail) and value < 150 and not mult:
            continue
        if mult:
            value *= MULTIPLIERS.get(mult, 1)
        elif value < 1000:
            # A bare small number next to an income cue is almost always lakhs.
            head = t[max(0, m.start() - 30): m.start()]
            if re.search(r"(income|earn|salary|package|per annum|pa\b|monthly|month)", head):
                value *= 100_000
            else:
                continue
        if re.search(r"(per month|a month|monthly|/month|pm\b)", t[m.start(): m.end() + 20]):
            value *= 12
        return int(round(value))
    return None


def parse_land(text: str) -> float | None:
    """Return a landholding in acres, or None."""
    t = clean(text)
    num_pat = r"(\d[\d,]*(?:\.\d+)?|" + "|".join(WORD_NUMBERS) + r")"
    units = {
        "acre": 1.0, "acres": 1.0, "ekar": 1.0,
        "hectare": HECTARE_TO_ACRE, "hectares": HECTARE_TO_ACRE, "ha": HECTARE_TO_ACRE,
        "bigha": BIGHA_TO_ACRE, "bighas": BIGHA_TO_ACRE,
        "gunta": GUNTA_TO_ACRE, "guntas": GUNTA_TO_ACRE,
        "cent": CENT_TO_ACRE, "cents": CENT_TO_ACRE,
    }
    unit_pat = "|".join(sorted(units, key=len, reverse=True))
    total = None
    for m in re.finditer(num_pat + r"\s*(?:and\s+(?:a\s+)?half\s*)?(" + unit_pat + r")\b", t):
        value = _to_float(m.group(1))
        if value is None:
            continue
        if "half" in m.group(0):
            value += 0.5
        acres = value * units[m.group(2)]
        total = acres if total is None else total + acres
    if total is None and re.search(r"\b(landless|no land|don'?t own (any )?land)\b", t):
        return 0.0
    return total


def parse_age(text: str) -> int | None:
    """Confident age extraction: an explicit age cue must be present."""
    t = clean(text)
    pats = [
        r"\b(?:i am|i'm|im|aged|age(?:d)?(?: is)?|main)\s+(\d{1,3})\b(?!\s*(?:acre|lakh|th|st|nd|rd|class))",
        r"\b(\d{1,3})\s*(?:years?|yrs?|saal|varsh)\s*(?:old|of age)?\b",
        r"\bage\s*[:=]\s*(\d{1,3})\b",
    ]
    for p in pats:
        m = re.search(p, t)
        if m:
            age = int(m.group(1))
            if 0 < age < 120:
                return age
    return None


def parse_age_loose(text: str) -> int | None:
    """Lower-confidence age: a bare number standing alone in a listing.

    Catches telegraphic input such as "widow, 65, no land, BPL". Callers must
    record this at reduced confidence so the clarifier can still challenge it.
    """
    t = clean(text)
    for m in re.finditer(r"(?:^|,)\s*(\d{1,3})\s*(?=,|$)", t):
        age = int(m.group(1))
        if 5 <= age <= 110:
            return age
    return None


def parse_state(text: str) -> str | None:
    t = clean(text)
    best: tuple[str, int] | None = None
    for canonical, aliases in INDIAN_STATES.items():
        for alias in aliases:
            # Short aliases must be standalone tokens to avoid false hits.
            pat = r"\b" + re.escape(alias) + r"\b"
            if re.search(pat, t):
                if best is None or len(alias) > best[1]:
                    best = (canonical, len(alias))
    return best[0] if best else None


def _match_vocab(text: str, vocab: dict[str, list[str]]) -> list[str]:
    t = clean(text)
    found = []
    for canonical, aliases in vocab.items():
        for alias in aliases:
            if re.search(r"\b" + re.escape(alias) + r"\b", t):
                found.append(canonical)
                break
    return found


def parse_occupations(text: str) -> list[str]:
    return _match_vocab(text, OCCUPATION_SYNONYMS)


def parse_category(text: str) -> str | None:
    found = _match_vocab(text, CATEGORY_SYNONYMS)
    return found[0] if found else None


def parse_special_categories(text: str) -> list[str]:
    return _match_vocab(text, SPECIAL_CATEGORY_SYNONYMS)


def class_to_stage(n: int) -> str | None:
    if 1 <= n <= 8:
        return "class_1_8"
    if 9 <= n <= 10:
        return "class_9_10"
    if 11 <= n <= 12:
        return "class_11_12"
    return None


def parse_education_stage(text: str) -> tuple[str | None, int | None]:
    """Return (stage, class_number)."""
    t = clean(text)
    for pattern, label in EDUCATION_PATTERNS:
        m = re.search(pattern, t)
        if not m:
            continue
        if label == "CLASS_NUM":
            n = int(m.group(1))
            if 1 <= n <= 12:
                return class_to_stage(n), n
            continue
        return label, None
    return None, None


def parse_residence(text: str) -> str | None:
    t = clean(text)
    if re.search(r"\b(village|rural|gram|panchayat|taluk|mandal)\b", t):
        return "rural"
    if re.search(r"\b(city|urban|town|municipal|metro)\b", t):
        return "urban"
    return None


def parse_gender(text: str) -> str | None:
    t = clean(text)
    if re.search(r"\b(i am a |i'm a |im a )?(woman|female|girl|lady|housewife|widow|mother|wife)\b", t):
        return "female"
    if re.search(r"\b(man|male|boy|gentleman|husband|father)\b", t):
        return "male"
    if re.search(r"\b(transgender|trans person)\b", t):
        return "transgender"
    return None


DEPENDENT_PATTERNS = [
    (r"\b(?:my |a |one )?daughters?\b", "female"),
    (r"\b(?:my |a |one )?sons?\b", "male"),
    (r"\b(?:my |a |one )?(?:child|children|kid|kids)\b", None),
    (r"\bgirl child\b", "female"),
]


def parse_dependents(text: str) -> list[dict]:
    """Extract dependants and, where stated nearby, their education stage."""
    t = clean(text)
    out: list[dict] = []
    for pattern, gender in DEPENDENT_PATTERNS:
        for m in re.finditer(pattern, t):
            window = t[m.start(): m.start() + 90]
            stage, class_no = parse_education_stage(window)
            dep = {"gender": gender, "education_stage": stage, "class": class_no}
            if dep not in out:
                out.append(dep)
    return out
