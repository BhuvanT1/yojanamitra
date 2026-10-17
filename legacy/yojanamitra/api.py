"""FastAPI service.

Run: uvicorn yojanamitra.api:app --reload
"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from . import config, corpus
from .pipeline import YojanaMitra

app = FastAPI(
    title="YojanaMitra",
    description=(
        "Describe your situation in plain language and get the government "
        "schemes you qualify for, with the exact eligibility clause cited."
    ),
    version="0.1.0",
)

_engine: YojanaMitra | None = None


def engine() -> YojanaMitra:
    global _engine
    if _engine is None:
        _engine = YojanaMitra()
    return _engine


class AskRequest(BaseModel):
    text: str = Field(..., min_length=3, max_length=2000,
                      description="The citizen's description, in any supported language.")
    top_k: int = Field(5, ge=1, le=20)
    include_ineligible: bool = Field(
        False, description="Also return schemes that were positively ruled out, with reasons."
    )


@app.on_event("startup")
def _warm() -> None:
    engine()


@app.get("/health")
def health() -> dict:
    e = engine()
    return {
        "status": "ok",
        "schemes": len(e.schemes),
        "capabilities": config.capabilities(),
        "corpus_provenance": corpus.provenance(),
        "unverified_records": len(corpus.stale_ids(e.schemes)),
    }


@app.post("/ask")
def ask(req: AskRequest) -> dict:
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="text must not be empty")
    answer = engine().answer(
        req.text, top_k=req.top_k, include_ineligible=req.include_ineligible
    )
    return answer.to_dict()


@app.get("/schemes/{scheme_id}")
def scheme(scheme_id: str) -> dict:
    for s in engine().schemes:
        if s.id == scheme_id:
            return s.to_dict()
    raise HTTPException(status_code=404, detail="unknown scheme id")
