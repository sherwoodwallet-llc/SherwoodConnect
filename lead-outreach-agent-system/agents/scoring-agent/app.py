import re
from enum import Enum
from typing import Any
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


app = FastAPI(title="Company Scoring Agent", version="0.2.0")


class TaskType(str, Enum):
    score_companies = "score_companies"


class RunRequest(BaseModel):
    task: TaskType
    input: dict[str, Any] = Field(default_factory=dict)


COMMERCIAL_TERMS = {
    "startup",
    "saas",
    "ai",
    "software",
    "venture",
    "agency",
    "ecommerce",
    "e-commerce",
    "consulting",
    "funding",
    "series a",
    "series b",
}

MISSION_TERMS = {
    "church",
    "mosque",
    "temple",
    "religious center",
    "homeless shelter",
    "food pantry",
    "nonprofit",
    "non-profit",
    "community",
    "outreach",
    "ministry",
    "ministries",
    "services",
}


@app.get("/")
def root() -> dict[str, str]:
    return {"agent": "scoring-agent", "status": "running"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def has_term(text: str, term: str) -> bool:
    escaped = re.escape(term.lower())
    if " " in term or "-" in term:
        return re.search(rf"(?<!\w){escaped}(?!\w)", text) is not None
    return re.search(rf"\b{escaped}\b", text) is not None


def domain_for(company: dict[str, Any]) -> str:
    if company.get("domain"):
        return str(company["domain"]).lower()
    website = str(company.get("website", ""))
    parsed = urlparse(website)
    return (parsed.hostname or "").removeprefix("www.").lower()


def text_for(company: dict[str, Any]) -> str:
    scoring_signals = [
        str(signal)
        for signal in company.get("signals", [])
        if not str(signal).lower().startswith("matched query:")
    ]
    return " ".join(
        [
            str(company.get("name", "")),
            str(company.get("website", "")),
            str(company.get("domain", "")),
            str(company.get("lead_category", "")),
            str(company.get("description", "")),
            " ".join(scoring_signals),
        ]
    ).lower()


def score_company(company: dict[str, Any]) -> dict[str, Any]:
    category = company.get("lead_category")
    confidence = float(company.get("lead_confidence") or company.get("classification_confidence") or 0)
    if not category:
        raise HTTPException(status_code=400, detail="Scoring requires classified companies with lead_category.")

    text = text_for(company)
    domain = domain_for(company)

    mission_fit = 36 if category in {
        "church",
        "mosque",
        "temple",
        "religious_center",
        "homeless_shelter",
        "food_pantry",
        "nonprofit",
    } else 0
    mission_fit += min(10, sum(2 for term in MISSION_TERMS if has_term(text, term)))

    website_improvement = 15
    if domain.endswith(".org"):
        website_improvement += 5
    if any(marker in text for marker in ["http://", "wordpress", "weebly", "wix", "squarespace"]):
        website_improvement += 8
    if any(term in text for term in ["old", "outdated", "basic", "simple", "under construction"]):
        website_improvement += 8
    if any(term in text for term in ["award-winning", "enterprise", "fortune", "global platform"]):
        website_improvement -= 8
    website_improvement = max(0, min(25, website_improvement))

    contact_signal = 0
    if company.get("website"):
        contact_signal += 8
    if any(term in text for term in ["contact", "about", "staff", "leadership"]):
        contact_signal += 8
    if any(term in text for term in ["donate", "give", "volunteer", "events", "calendar", "programs"]):
        contact_signal += 14
    contact_signal = min(25, contact_signal)

    local_relevance = 10 if str(company.get("location", "")).lower() in {"united states", "us", "usa"} else 6
    if any(term in text for term in ["local", "community", "neighborhood", "county", "city"]):
        local_relevance += 9
    local_relevance = min(17, local_relevance)

    confidence_points = round(confidence * 5)
    risk_penalty = 0
    commercial_hits = [term for term in COMMERCIAL_TERMS if has_term(text, term)]
    if commercial_hits:
        risk_penalty += 35
    if confidence < 0.75:
        risk_penalty += 25
    if not company.get("website"):
        risk_penalty += 15

    score = max(
        0,
        min(
            100,
            mission_fit + website_improvement + contact_signal + local_relevance + confidence_points - risk_penalty,
        ),
    )

    if score >= 75:
        decision = "approve"
    elif score >= 55:
        decision = "review"
    else:
        decision = "reject"

    return {
        "company": company,
        "name": company.get("name", "Unknown organization"),
        "score": score,
        "decision": decision,
        "reasoning": (
            "Mission-driven rubric: category fit, website improvement opportunity, "
            "contact/donation/volunteer/event signals, local relevance, and commercial-risk penalty."
        ),
        "rubric": {
            "mission_fit": mission_fit,
            "website_improvement_opportunity": website_improvement,
            "contact_donation_volunteer_event_signal": contact_signal,
            "local_relevance": local_relevance,
            "classification_confidence_points": confidence_points,
            "commercial_risk_penalty": risk_penalty,
            "commercial_hits": commercial_hits,
        },
    }


@app.post("/run")
def run(request: RunRequest) -> dict[str, Any]:
    companies = request.input.get("companies", [])
    if not isinstance(companies, list):
        raise HTTPException(status_code=400, detail="input.companies must be a list.")

    scored_companies = [score_company(company) for company in companies]
    approved_companies = [company for company in scored_companies if company["decision"] == "approve"]

    return {
        "agent": "scoring-agent",
        "task": request.task.value,
        "scored_companies": scored_companies,
        "approved_companies": approved_companies,
    }
