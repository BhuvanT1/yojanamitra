"""Build the evaluation gold set.

Methodology, stated plainly because it bounds what the numbers mean
--------------------------------------------------------------------
Each item is a persona with a hand-written ground-truth profile, plus several
natural-language phrasings of that same persona (plain, telegraphic, code-mixed,
paraphrased). The label for an item is computed by running the deterministic
rule filter over the *complete ground-truth profile*: the target schemes are
those the rules can fully prove eligible.

So the benchmark measures one thing precisely: **can the pipeline recover from
free text what the rules would conclude from a perfect profile?** That covers
extraction quality, query construction and retrieval — the parts that are
actually learned or heuristic.

It does NOT measure whether the corpus itself states Indian eligibility law
correctly. That is a separate, human verification problem, and until the scraper
has run against the live portal it remains open. Any report generated from this
gold set must carry that caveat.
"""

from __future__ import annotations

import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from yojanamitra import corpus, rules  # noqa: E402
from yojanamitra.models import Profile, Verdict  # noqa: E402

OUT = pathlib.Path(__file__).resolve().parents[1] / "data" / "gold_set.json"


def P(**kw) -> Profile:
    p = Profile()
    for k, v in kw.items():
        p.set(k, v, 1.0, "user", "ground truth")
    return p


PERSONAS: list[dict] = [
    {
        "id": "ap-small-farmer-daughter",
        "profile": P(
            age=44, occupation=["farmer"], annual_income_inr=180000,
            land_acres=2.0, state="andhra pradesh", residence="rural",
            dependents=[{"gender": "female", "education_stage": "class_11_12", "class": 11}],
        ),
        "texts": [
            "I'm a farmer in Andhra, I own 2 acres, and my daughter is in 11th class. I earn about 1.8 lakh a year and live in a village.",
            "44 year old farmer from Andhra Pradesh, 2 acres of land, village, annual income 180000, daughter studying 11th standard",
            "Main Andhra ka kisan hoon, 2 acre zameen hai, meri beti 11th class mein hai, saal ka income 1.8 lakh, gaon mein rehta hoon",
        ],
    },
    {
        "id": "telangana-marginal-farmer",
        "profile": P(
            age=33, occupation=["farmer"], annual_income_inr=150000,
            land_acres=1.5, state="telangana", residence="rural", category="obc",
        ),
        "texts": [
            "I am 33, a farmer in Telangana with 1.5 acres of land in my village, OBC, my yearly income is around 1.5 lakh.",
            "farmer, telangana, 1.5 acres, age 33, OBC, rural, income 150000 per year",
            "33 saal ka kisan, telangana, 1.5 acre kheti, gaon, OBC, income 1.5 lakh",
        ],
    },
    {
        "id": "sc-engineering-student",
        "profile": P(
            age=20, gender="female", occupation=["student"], annual_income_inr=200000,
            state="tamil nadu", category="sc", education_stage="undergraduate",
            residence="urban",
        ),
        "texts": [
            "I am a 20 year old girl doing B.Tech in Tamil Nadu, I belong to SC category and my family income is 2 lakh per year. We live in a town.",
            "female, 20, undergraduate engineering student, Tamil Nadu, scheduled caste, family income 200000, urban",
            "20 years old, studying degree in Tamil Nadu, SC, girl, parents earn 2 lakh a year, city",
        ],
    },
    {
        "id": "st-class9-student",
        "profile": P(
            age=14, occupation=["student"], annual_income_inr=90000,
            state="odisha", category="st", education_stage="class_9_10",
            residence="rural",
        ),
        "texts": [
            "I am 14 years old, studying in class 9 in a government school in Odisha, we are a scheduled tribe family and my parents earn about 90000 a year in our village.",
            "14, class 9 student, Odisha, ST, rural, family income 90000",
            "class 9 mein padhta hoon, 14 saal, Odisha, adivasi, gaon, income 90000",
        ],
    },
    {
        "id": "widow-bpl-pension",
        "profile": P(
            age=52, gender="female", annual_income_inr=40000, land_acres=0.0,
            state="bihar", residence="rural", special_categories=["widow", "bpl", "landless"],
        ),
        "texts": [
            "I am a 52 year old widow in a village in Bihar, I have no land, we have a BPL ration card and I earn about 40000 a year.",
            "widow, 52, Bihar, landless, BPL, rural, income 40000",
            "52 saal ki vidhwa hoon, Bihar ke gaon mein, koi zameen nahi, BPL card hai, saal ka 40000",
        ],
    },
    {
        "id": "senior-citizen-bpl",
        "profile": P(
            age=68, annual_income_inr=30000, land_acres=0.0,
            state="uttar pradesh", residence="rural", special_categories=["bpl", "landless"],
        ),
        "texts": [
            "I am 68 years old, living in a village in Uttar Pradesh, I own no land, we hold a BPL card and our yearly income is around 30000.",
            "68 year old man, UP, rural, landless, below poverty line, income 30000 per year",
            "68 saal ka hoon, UP ke gaon mein, zameen nahi hai, gareeb hain, BPL card",
        ],
    },
    {
        "id": "disabled-adult-bpl",
        "profile": P(
            age=34, annual_income_inr=60000, state="maharashtra",
            residence="rural", special_categories=["differently_abled", "bpl"],
        ),
        "texts": [
            "I am 34, differently abled with a disability certificate, living in a village in Maharashtra with a BPL ration card, income about 60000 a year.",
            "34, disabled, Maharashtra, BPL, rural, income 60000",
            "34 saal, viklang hoon, Maharashtra gaon, BPL card, 60000 saal ka",
        ],
    },
    {
        "id": "urban-street-vendor",
        "profile": P(
            age=39, occupation=["shopkeeper"], annual_income_inr=140000,
            state="delhi", residence="urban",
        ),
        "texts": [
            "I am 39 and I run a small street vending stall in Delhi city, I make around 1.4 lakh a year.",
            "street vendor, 39, Delhi, urban, annual income 140000",
            "39 saal, Delhi shehar mein thela lagata hoon, saal ka 1.4 lakh",
        ],
    },
    {
        "id": "handloom-weaver",
        "profile": P(
            age=45, gender="female", occupation=["weaver"], annual_income_inr=110000,
            state="west bengal", residence="rural",
        ),
        "texts": [
            "I am a 45 year old woman handloom weaver in a village in West Bengal, earning about 1.1 lakh a year.",
            "handloom weaver, female, 45, West Bengal, rural, income 110000",
            "45 saal ki hoon, handloom weaver, West Bengal gaon, 1.1 lakh saal ka",
        ],
    },
    {
        "id": "young-fisherman",
        "profile": P(
            age=29, occupation=["fisherman"], annual_income_inr=160000,
            state="kerala", residence="rural",
        ),
        "texts": [
            "I am 29 and work as a fisherman in a coastal village in Kerala, my income is about 1.6 lakh a year.",
            "fisherman, 29, Kerala, rural, income 160000 per year",
            "29 saal, Kerala mein machhli pakadta hoon, gaon, 1.6 lakh",
        ],
    },
    {
        "id": "rural-labourer-mgnrega",
        "profile": P(
            age=31, occupation=["labourer"], annual_income_inr=70000,
            land_acres=0.0, state="jharkhand", residence="rural",
            special_categories=["landless", "bpl"],
        ),
        "texts": [
            "I am 31, a daily wage labourer in a village in Jharkhand, I have no land, we have a BPL card and I earn roughly 70000 a year.",
            "daily wage labourer, 31, Jharkhand, rural, landless, BPL, income 70000",
            "31 saal ka mazdoor hoon, Jharkhand gaon, zameen nahi, BPL, 70000 saal ka",
        ],
    },
    {
        "id": "young-mother-ujjwala",
        "profile": P(
            age=27, gender="female", annual_income_inr=85000, land_acres=0.0,
            state="madhya pradesh", residence="rural",
            special_categories=["bpl", "landless"],
            dependents=[{"gender": "female", "education_stage": None, "class": None}],
        ),
        "texts": [
            "I am a 27 year old woman in a village in Madhya Pradesh, we are a BPL family with no land, I have a daughter, and our income is about 85000 a year.",
            "woman, 27, MP, rural, BPL, landless, one daughter, income 85000",
            "27 saal ki hoon, MP gaon, BPL, zameen nahi, ek beti hai, 85000 saal ka",
        ],
    },
    {
        "id": "up-girl-child-family",
        "profile": P(
            age=36, occupation=["labourer"], annual_income_inr=150000,
            state="uttar pradesh", residence="rural",
            dependents=[{"gender": "female", "education_stage": "class_1_8", "class": 5}],
        ),
        "texts": [
            "I am 36, working as a labourer in a village in Uttar Pradesh, my daughter is in class 5 and our family income is 1.5 lakh a year.",
            "labourer, 36, UP, rural, daughter in class 5, income 150000",
            "36 saal ka majdoor, UP gaon, meri beti class 5 mein, 1.5 lakh saal ka",
        ],
    },
    {
        "id": "karnataka-pg-student",
        "profile": P(
            age=23, occupation=["student"], annual_income_inr=220000,
            state="karnataka", category="obc", education_stage="postgraduate",
            residence="urban",
        ),
        "texts": [
            "I am 23, doing my Masters in Karnataka, OBC category, my family income is 2.2 lakh a year and we live in a city.",
            "postgraduate student, 23, Karnataka, OBC, urban, family income 220000",
            "23 saal, Karnataka mein M.Tech kar raha hoon, OBC, shehar, 2.2 lakh",
        ],
    },
    {
        "id": "young-entrepreneur-sc",
        "profile": P(
            age=28, gender="female", occupation=["self_employed"], annual_income_inr=300000,
            state="gujarat", category="sc", residence="urban",
        ),
        "texts": [
            "I am a 28 year old woman from an SC family in Gujarat, I run my own small business in the city and earn about 3 lakh a year.",
            "female, 28, SC, Gujarat, self employed own business, urban, income 300000",
            "28 saal ki hoon, SC, Gujarat shehar, apna business hai, 3 lakh saal ka",
        ],
    },
    {
        "id": "unemployed-graduate",
        "profile": P(
            age=22, occupation=["unemployed"], annual_income_inr=250000,
            state="rajasthan", residence="urban", education_stage="undergraduate",
        ),
        "texts": [
            "I am 22, just finished my degree in Rajasthan and I am unemployed right now. My family income is about 2.5 lakh a year and we live in a town.",
            "22, unemployed graduate, Rajasthan, urban, family income 250000",
            "22 saal, degree khatam ki, abhi berozgar hoon, Rajasthan shehar, 2.5 lakh",
        ],
    },
    {
        "id": "urban-lig-family",
        "profile": P(
            age=41, occupation=["salaried"], annual_income_inr=480000,
            state="haryana", residence="urban",
        ),
        "texts": [
            "I am 41, in a private job in a city in Haryana, my annual income is 4.8 lakh and we do not own a house.",
            "salaried, 41, Haryana, urban, annual income 480000",
            "41 saal, private naukri, Haryana shehar, 4.8 lakh saal ka",
        ],
    },
    {
        "id": "small-farmer-young",
        "profile": P(
            age=29, occupation=["farmer"], annual_income_inr=170000,
            land_acres=3.0, state="punjab", residence="rural",
        ),
        "texts": [
            "I am 29, a farmer in Punjab with 3 acres of land in my village, earning about 1.7 lakh a year.",
            "farmer, 29, Punjab, 3 acres, rural, income 170000",
            "29 saal ka kisan, Punjab, 3 acre zameen, gaon, 1.7 lakh",
        ],
    },
    {
        "id": "telangana-unmarried-girl",
        "profile": P(
            age=19, gender="female", annual_income_inr=120000, state="telangana",
            residence="rural", occupation=["student"], education_stage="undergraduate",
        ),
        "texts": [
            "I am a 19 year old girl in Telangana, studying in a degree college, our family income is 1.2 lakh a year and we live in a village.",
            "female, 19, Telangana, undergraduate student, rural, family income 120000",
            "19 saal ki ladki hoon, Telangana, degree college, gaon, 1.2 lakh",
        ],
    },
    {
        "id": "tn-girl-college",
        "profile": P(
            age=18, gender="female", occupation=["student"], annual_income_inr=140000,
            state="tamil nadu", education_stage="undergraduate", residence="rural",
            category="obc",
        ),
        "texts": [
            "I am an 18 year old girl from a village in Tamil Nadu who studied in a government school and is now in the first year of college. Family income is 1.4 lakh, OBC.",
            "girl, 18, Tamil Nadu, undergraduate first year, rural, OBC, family income 140000",
            "18 saal ki hoon, Tamil Nadu gaon, government school se padhi, ab college, 1.4 lakh, OBC",
        ],
    },
]


def main() -> None:
    schemes = corpus.load()
    items = []
    for persona in PERSONAS:
        profile = persona["profile"]
        eligible, likely = [], []
        for s in schemes:
            verdict, _ = rules.check_scheme(s, profile)
            if verdict is Verdict.ELIGIBLE:
                eligible.append(s.id)
            elif verdict is Verdict.LIKELY_ELIGIBLE:
                likely.append(s.id)
        for i, text in enumerate(persona["texts"]):
            items.append(
                {
                    "id": f"{persona['id']}-{i}",
                    "persona": persona["id"],
                    "phrasing": ["plain", "telegraphic", "code_mixed"][i]
                    if i < 3 else f"variant_{i}",
                    "text": text,
                    "profile": {k: v.value for k, v in profile.values.items()},
                    "expected_schemes": sorted(eligible),
                    "acceptable_schemes": sorted(set(eligible) | set(likely)),
                }
            )
    payload = {
        "methodology": (
            "Labels are derived by running the deterministic rule filter over a "
            "hand-written ground-truth profile for each persona. The benchmark "
            "measures recovery of that conclusion from free text (extraction + "
            "retrieval). It does NOT validate that the corpus states Indian "
            "eligibility law correctly; that requires human verification against "
            "the live portal."
        ),
        "personas": len(PERSONAS),
        "items": len(items),
        "data": items,
    }
    OUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False))
    counts = [len(i["expected_schemes"]) for i in items]
    print(
        f"wrote {len(items)} items from {len(PERSONAS)} personas -> {OUT}\n"
        f"provable-eligible targets per item: min {min(counts)}, "
        f"max {max(counts)}, mean {sum(counts)/len(counts):.1f}"
    )


if __name__ == "__main__":
    main()
