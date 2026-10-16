"""YojanaMitra — Streamlit interface.

Run: streamlit run app.py

Design notes
------------
The person using this may be anxious, in a hurry, or reading in their second
language. So the screen answers three questions in order, largest first:
*do I qualify*, *why*, and *what do I do next*. Everything else — the extracted
profile, timings, capability flags — is demoted behind a toggle, because it is
for us, not for them.

Verdict colour is never the only signal: each card also carries a word and an
icon, so the meaning survives a monochrome projector or colour-blind eyes.
"""

from __future__ import annotations

import html

import streamlit as st

from yojanamitra import config, corpus
from yojanamitra.models import Status, Verdict
from yojanamitra.pipeline import YojanaMitra

st.set_page_config(
    page_title="YojanaMitra — find schemes you qualify for",
    page_icon="🧭",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# ---------------------------------------------------------------------------
# Theme
# ---------------------------------------------------------------------------

DEEP, TEAL, AMBER = "#0B3532", "#12776E", "#E9A63F"

st.markdown(
    """
    <style>
      #MainMenu, footer {visibility: hidden;}
      .block-container {padding-top: 2rem; padding-bottom: 3rem; max-width: 1180px;}

      .ym-hero {
        background: linear-gradient(135deg, #0B3532 0%, #12564F 60%, #12776E 100%);
        border-radius: 18px; padding: 30px 34px 26px; color: #fff; margin-bottom: 22px;
      }
      .ym-hero h1 {font-size: 34px; font-weight: 700; margin: 0 0 6px; letter-spacing: -.5px;}
      .ym-hero p {font-size: 16px; color: #CDE0DD; margin: 0; max-width: 640px; line-height: 1.55;}
      .ym-hero .ym-kicker {
        font-size: 11px; letter-spacing: .18em; text-transform: uppercase;
        color: #E9A63F; font-weight: 700; margin-bottom: 10px;
      }

      .ym-stat {
        background: #fff; border: 1px solid #E3ECEA; border-radius: 12px;
        padding: 14px 16px; text-align: center;
      }
      .ym-stat .n {font-size: 26px; font-weight: 700; line-height: 1.1;}
      .ym-stat .l {font-size: 12px; color: #5E706D; margin-top: 3px;}

      .ym-card {
        background: #fff; border: 1px solid #E3ECEA; border-radius: 14px;
        padding: 18px 20px 16px; margin-bottom: 4px; border-left: 5px solid #CBD8D5;
      }
      .ym-card.yes {border-left-color: #12776E;}
      .ym-card.maybe {border-left-color: #E9A63F;}
      .ym-card.no {border-left-color: #C9CFCE; opacity: .85;}

      .ym-head {display: flex; align-items: flex-start; gap: 12px; margin-bottom: 8px;}
      .ym-title {font-size: 18px; font-weight: 700; color: #0B3532; line-height: 1.3; flex: 1;}
      .ym-pill {
        font-size: 11.5px; font-weight: 700; padding: 5px 12px; border-radius: 20px;
        white-space: nowrap; flex: none;
      }
      .ym-pill.yes {background: #DCEAE7; color: #0E5A54;}
      .ym-pill.maybe {background: #FAEEDA; color: #8A5A0B;}
      .ym-pill.no {background: #F0F2F1; color: #5E706D;}

      .ym-benefit {font-size: 14.5px; color: #12776E; font-weight: 600; margin-bottom: 8px;}
      .ym-why {font-size: 14.5px; color: #2E3B39; line-height: 1.55;}
      .ym-open {
        font-size: 13.5px; color: #8A5A0B; background: #FDF6EA;
        border-radius: 8px; padding: 9px 12px; margin-top: 10px; line-height: 1.5;
      }
      .ym-meta {font-size: 12.5px; color: #7A8B88; margin-top: 10px;}
      .ym-chip {
        display: inline-block; background: #EEF4F3; color: #2E4B47; font-size: 12px;
        padding: 4px 10px; border-radius: 6px; margin: 0 5px 5px 0;
      }
      .ym-apply {
        display: inline-block; background: #E9A63F; color: #3B2606 !important;
        font-size: 13.5px; font-weight: 700; padding: 8px 18px; border-radius: 8px;
        text-decoration: none !important; margin-top: 4px;
      }
      .ym-empty {
        border: 2px dashed #D7E4E1; border-radius: 14px; padding: 34px;
        text-align: center; color: #5E706D;
      }
      div[data-testid="stExpander"] details {border: none; background: transparent;}
    </style>
    """,
    unsafe_allow_html=True,
)


@st.cache_resource(show_spinner="Loading the scheme knowledge base…")
def get_engine() -> YojanaMitra:
    return YojanaMitra()


def esc(s: str) -> str:
    return html.escape(str(s or ""))


engine = get_engine()
STYLE = {
    Verdict.ELIGIBLE: ("yes", "✓  You qualify"),
    Verdict.LIKELY_ELIGIBLE: ("maybe", "?  Likely — needs confirming"),
    Verdict.INELIGIBLE: ("no", "×  Ruled out"),
}

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------

for key, default in [("q", ""), ("nonce", 0), ("run", False)]:
    st.session_state.setdefault(key, default)


def ask(text: str) -> None:
    st.session_state.q = text
    st.session_state.nonce += 1
    st.session_state.run = True


# ---------------------------------------------------------------------------
# Header
# ---------------------------------------------------------------------------

st.markdown(
    """
    <div class="ym-hero">
      <div class="ym-kicker">Government scheme finder</div>
      <h1>Tell us about yourself. We'll find what you're entitled to.</h1>
      <p>No forms and no categories to choose from — just describe your situation
      the way you would to a friend. Every result shows the exact rule it was
      matched against.</p>
    </div>
    """,
    unsafe_allow_html=True,
)

# ---------------------------------------------------------------------------
# Input
# ---------------------------------------------------------------------------

EXAMPLES = [
    ("👨‍🌾  Farmer with land",
     "I'm a farmer in Andhra Pradesh, I own 2 acres, my daughter is in 11th class, "
     "and I earn about 1.8 lakh a year in my village."),
    ("🎓  Student",
     "I am a 20 year old girl doing B.Tech in Tamil Nadu, SC category, "
     "my family income is 2 lakh per year and we live in a town."),
    ("🏠  Widow, no land",
     "52 saal ki vidhwa hoon, Bihar ke gaon mein, koi zameen nahi, "
     "BPL card hai, saal ka 40000"),
    ("👴  Senior citizen",
     "I am 68, living in a village in Uttar Pradesh, I own no land, "
     "we have a BPL card and our income is around 30000 a year."),
]

st.markdown("**Not sure where to start? Try one of these:**")
for col, (label, text) in zip(st.columns(len(EXAMPLES)), EXAMPLES):
    with col:
        if st.button(label, use_container_width=True, key=f"ex_{label}"):
            ask(text)
            st.rerun()

with st.form("search", clear_on_submit=False):
    typed = st.text_area(
        "Describe your situation",
        value=st.session_state.q,
        height=118,
        key=f"box_{st.session_state.nonce}",
        placeholder=(
            "For example: I'm a farmer in Andhra, I own 2 acres, my daughter is in "
            "11th class, and I earn about 1.8 lakh a year…\n\n"
            "Helpful to include: your age, your state, roughly what your family earns "
            "in a year, and what you do."
        ),
        label_visibility="collapsed",
    )
    c1, c2 = st.columns([1, 3])
    with c1:
        submitted = st.form_submit_button(
            "🔍  Find my schemes", use_container_width=True, type="primary"
        )
    with c2:
        st.caption("Your answers stay in this browser session — nothing is saved or sent anywhere.")

if submitted:
    st.session_state.q = typed
    st.session_state.run = True

# ---------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------

if st.session_state.run and st.session_state.q.strip():
    query = st.session_state.q
    with st.spinner("Checking every scheme against what you told us…"):
        answer = engine.answer(query, top_k=40, include_ineligible=True)

    eligible = [r for r in answer.results if r.verdict is Verdict.ELIGIBLE]
    likely = [r for r in answer.results if r.verdict is Verdict.LIKELY_ELIGIBLE]
    ruled_out = [r for r in answer.results if r.verdict is Verdict.INELIGIBLE]

    st.markdown("")
    cols = st.columns(4)
    for col, (n, label, colour) in zip(
        cols,
        [
            (len(engine.schemes), "schemes checked", "#0B3532"),
            (len(eligible), "you qualify for", TEAL),
            (len(likely), "need confirming", "#B8860B"),
            (len(ruled_out), "ruled out", "#8B9694"),
        ],
    ):
        col.markdown(
            f'<div class="ym-stat"><div class="n" style="color:{colour}">{n}</div>'
            f'<div class="l">{label}</div></div>',
            unsafe_allow_html=True,
        )

    if answer.clarifying_question:
        st.markdown("")
        with st.container(border=True):
            st.markdown(f"**One more thing —** {answer.clarifying_question}")
            fc1, fc2 = st.columns([3, 1])
            extra = fc1.text_input(
                "Your answer", key="clarify", label_visibility="collapsed",
                placeholder="Type your answer here to sharpen the results…",
            )
            if fc2.button("Add", use_container_width=True) and extra.strip():
                ask(f"{query}. {extra.strip()}")
                st.rerun()

    st.markdown("")
    left, right = st.columns([7, 3], gap="large")

    with right:
        st.markdown("##### Show me")
        view = st.radio(
            "Filter", ["Everything I might get", "Only confirmed matches", "Also what I can't get"],
            index=0, label_visibility="collapsed",
        )
        categories = sorted({c for r in answer.results for c in r.scheme.category})
        chosen = st.multiselect("Filter by topic", categories, placeholder="All topics")

        detailed = st.toggle("Show technical detail", value=False,
                             help="The extracted profile, timings and system mode.")

        if detailed:
            st.markdown("##### What we understood")
            if answer.profile.values:
                chips = "".join(
                    f'<span class="ym-chip">{esc(k.replace("_", " "))}: '
                    f'<b>{esc(v.value)}</b></span>'
                    for k, v in sorted(answer.profile.values.items())
                )
                st.markdown(chips, unsafe_allow_html=True)
            else:
                st.caption("Nothing could be read from that text.")

            st.markdown("##### System")
            for k, v in config.capabilities().items():
                st.caption(f"{k.replace('_', ' ')} — `{v}`")
            st.caption("· ".join(f"{k} {v:.0f}ms" for k, v in answer.timings_ms.items()))

        prov = corpus.provenance()
        if prov.get("kind") == "development-seed":
            st.warning(
                "These scheme records have not been checked against the official "
                "portal yet. Treat the results as a starting point and confirm on "
                "the scheme's own page before applying.",
                icon="⚠️",
            )

    with left:
        def render(r) -> None:
            cls, label = STYLE[r.verdict]
            benefit = r.scheme.benefits
            if len(benefit) > 165:
                benefit = benefit[:162].rsplit(" ", 1)[0] + "…"

            open_note = ""
            if r.unverified and r.verdict is not Verdict.INELIGIBLE:
                items = "".join(f"<li>{esc(u)}</li>" for u in r.unverified[:2])
                open_note = (
                    f'<div class="ym-open"><b>Still to confirm</b><ul style="margin:6px 0 0 18px;'
                    f'padding:0">{items}</ul></div>'
                )

            st.markdown(
                f'<div class="ym-card {cls}">'
                f'  <div class="ym-head">'
                f'    <div class="ym-title">{esc(r.scheme.name)}</div>'
                f'    <div class="ym-pill {cls}">{esc(label)}</div>'
                f'  </div>'
                f'  <div class="ym-benefit">{esc(benefit)}</div>'
                f'  <div class="ym-why">{esc(r.explanation)}</div>'
                f'  {open_note}'
                f'  <div class="ym-meta">{esc(r.scheme.ministry or r.scheme.level.title())}'
                f'  &nbsp;·&nbsp; {len(r.scheme.documents)} documents needed</div>'
                f'</div>',
                unsafe_allow_html=True,
            )

            with st.expander("Documents, the exact rules, and how to apply"):
                dc1, dc2 = st.columns([3, 2])
                with dc1:
                    st.markdown("**Rules checked against what you told us**")
                    for c in r.checks:
                        icon = {
                            Status.SATISFIED: "✅", Status.VIOLATED: "❌", Status.UNKNOWN: "❔",
                        }[c.status]
                        st.markdown(f"{icon} {c.clause_text}")
                        st.caption(f"↳ {c.reason}  ·  `{c.clause_id}`")
                with dc2:
                    st.markdown("**Documents to keep ready**")
                    if r.scheme.documents:
                        st.markdown(
                            "".join(f'<span class="ym-chip">{esc(d)}</span>'
                                    for d in r.scheme.documents),
                            unsafe_allow_html=True,
                        )
                    else:
                        st.caption("Not listed.")
                    st.markdown(
                        f'<a class="ym-apply" href="{esc(r.scheme.apply_url)}" '
                        f'target="_blank">Apply on the official site →</a>',
                        unsafe_allow_html=True,
                    )
                    st.caption(f"[Where this came from]({r.scheme.source_url})")

        # Grouping beats one long list: a person wants the certain matches
        # first, and the "needs confirming" pile is long because not mentioning
        # a BPL card is not proof of not having one.
        if view == "Only confirmed matches":
            sections = [("You qualify", eligible, 99)]
        elif view == "Also what I can't get":
            sections = [
                ("You qualify", eligible, 99),
                ("Might qualify — needs confirming", likely, 6),
                ("Ruled out, and why", ruled_out, 4),
            ]
        else:
            sections = [
                ("You qualify", eligible, 99),
                ("Might qualify — needs confirming", likely, 6),
            ]

        if chosen:
            sections = [
                (t, [r for r in items if set(r.scheme.category) & set(chosen)], cap)
                for t, items, cap in sections
            ]

        if not any(items for _, items, _ in sections):
            st.markdown(
                '<div class="ym-empty"><b>Nothing to show with these filters.</b><br>'
                'Try widening the topic filter, or add your age, state and yearly '
                'income to the description above.</div>',
                unsafe_allow_html=True,
            )

        for title, items, cap in sections:
            if not items:
                continue
            st.markdown(f"#### {title}  ·  {len(items)}")
            if title.startswith("Might"):
                st.caption(
                    "These have not been ruled out, but one condition could not be "
                    "checked from what you told us — usually a certificate or a "
                    "category you did not mention."
                )
            for r in items[:cap]:
                render(r)
            if len(items) > cap:
                if st.checkbox(f"Show {len(items) - cap} more",
                               key=f"more_{title}"):
                    for r in items[cap:]:
                        render(r)
            st.markdown("")

elif st.session_state.run:
    st.info("Type a few words about yourself first, or pick one of the examples.")

# ---------------------------------------------------------------------------
# Footer
# ---------------------------------------------------------------------------

st.divider()
st.caption(
    "**How this decides.** A language model never rules on your eligibility. "
    "Every age, income and landholding limit is checked in ordinary code against "
    "what you said, and anything we could not verify is shown as an open question "
    "rather than a promise. Always confirm on the official scheme page before applying."
)
