import re
from enum import Enum
from typing import Any
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


app = FastAPI(title="Lead Type Classifier Agent", version="0.1.0")


class TaskType(str, Enum):
    classify_leads = "classify_leads"


class LeadCategory(str, Enum):
    church = "church"
    mosque = "mosque"
    temple = "temple"
    religious_center = "religious_center"
    homeless_shelter = "homeless_shelter"
    food_pantry = "food_pantry"
    nonprofit = "nonprofit"
    reject = "reject"


class RunRequest(BaseModel):
    task: TaskType
    input: dict[str, Any] = Field(default_factory=dict)


class ClassifiedLead(BaseModel):
    organization_name: str
    website: str | None = None
    category: LeadCategory
    reject_reason: str | None = None
    confidence: float = Field(ge=0, le=1)
    company: dict[str, Any]


COMMERCIAL_REJECT_TERMS = {
    "ai",
    "artificial intelligence",
    "startup",
    "startups",
    "saas",
    "software",
    "platform",
    "venture",
    "vc",
    "series a",
    "series b",
    "seed round",
    "funding",
    "agency",
    "marketing agency",
    "consulting",
    "consultant",
    "ecommerce",
    "e-commerce",
    "shopify",
    "marketplace",
}

CATEGORY_RULES: list[tuple[LeadCategory, set[str]]] = [
    (LeadCategory.homeless_shelter, {"homeless shelter", "emergency shelter", "transitional housing", "shelter services", "rescue mission", "rescue"}),
    (LeadCategory.food_pantry, {"food pantry", "food bank", "community pantry", "hunger relief", "meal program"}),
    (LeadCategory.mosque, {"mosque", "masjid", "islamic center", "muslim community"}),
    (LeadCategory.temple, {"temple", "synagogue", "hindu temple", "buddhist temple", "sikh", "gurdwara"}),
    (LeadCategory.church, {"church", "parish", "ministry", "ministries", "cathedral", "chapel", "congregation"}),
    (LeadCategory.religious_center, {"religious center", "faith center", "worship center", "interfaith", "spiritual center"}),
    (LeadCategory.nonprofit, {"nonprofit", "non-profit", "501(c)(3)", "community organization", "charity", "charities", "foundation", "community services"}),
]

MISSION_TERMS = {
    "donate",
    "volunteer",
    "events",
    "services",
    "outreach",
    "community",
    "mission",
    "ministries",
    "give",
    "programs",
}


@app.get("/")
def root() -> dict[str, str]:
    return {"agent": "lead-classifier-agent", "status": "running"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def domain_from_url(url: str | None) -> str:
    if not url:
        return ""
    parsed = urlparse(url)
    return (parsed.hostname or "").removeprefix("www.").lower()


def text_for(company: dict[str, Any]) -> str:
    return " ".join(
        [
            str(company.get("name", "")),
            str(company.get("website", "")),
            str(company.get("domain", "")),
            str(company.get("industry", "")),
            str(company.get("description", "")),
            str(company.get("discovered_from", "")),
            " ".join(str(signal) for signal in company.get("signals", [])),
            " ".join(str(url) for url in company.get("source_urls", [])),
        ]
    ).lower()


def has_term(text: str, term: str) -> bool:
    escaped = re.escape(term.lower())
    if " " in term or "-" in term:
        return re.search(rf"(?<!\w){escaped}(?!\w)", text) is not None
    return re.search(rf"\b{escaped}\b", text) is not None


def classify_company(company: dict[str, Any]) -> ClassifiedLead:
    name = str(company.get("name") or "").strip()
    website = company.get("website")
    if not name or not website:
        return ClassifiedLead(
            organization_name=name or "Unknown organization",
            website=website,
            category=LeadCategory.reject,
            reject_reason="Missing required organization name or website.",
            confidence=1.0,
            company=company,
        )

    text = text_for(company)
    domain = domain_from_url(str(website))
    reject_hits = sorted(term for term in COMMERCIAL_REJECT_TERMS if has_term(text, term))
    category_scores: list[tuple[LeadCategory, int]] = []

    for category, terms in CATEGORY_RULES:
        hits = sum(1 for term in terms if has_term(text, term))
        if hits:
            category_scores.append((category, hits))

    if reject_hits and not category_scores:
        return ClassifiedLead(
            organization_name=name,
            website=website,
            category=LeadCategory.reject,
            reject_reason=f"Commercial or unrelated business terms detected: {', '.join(reject_hits[:3])}.",
            confidence=0.95,
            company=company,
        )

    if not category_scores:
        return ClassifiedLead(
            organization_name=name,
            website=website,
            category=LeadCategory.reject,
            reject_reason="No allowed mission-driven category signals detected.",
            confidence=0.85,
            company=company,
        )

    category, category_hit_count = sorted(category_scores, key=lambda item: item[1], reverse=True)[0]
    mission_hits = sum(1 for term in MISSION_TERMS if has_term(text, term))
    confidence = 0.45 + min(0.3, category_hit_count * 0.15) + min(0.15, mission_hits * 0.03)
    if domain.endswith(".org"):
        confidence += 0.08
    if domain.endswith(".gov") and category not in {LeadCategory.homeless_shelter, LeadCategory.food_pantry}:
        confidence -= 0.2
    if reject_hits:
        confidence -= 0.2

    confidence = round(max(0.0, min(0.99, confidence)), 2)
    if confidence < 0.75:
        return ClassifiedLead(
            organization_name=name,
            website=website,
            category=LeadCategory.reject,
            reject_reason=f"Allowed-category signal was too weak for automatic approval ({category.value}).",
            confidence=confidence,
            company=company,
        )

    enriched_company = {
        **company,
        "lead_category": category.value,
        "classification_confidence": confidence,
        "classification_reject_reason": None,
    }
    return ClassifiedLead(
        organization_name=name,
        website=website,
        category=category,
        reject_reason=None,
        confidence=confidence,
        company=enriched_company,
    )


@app.post("/run")
def run(request: RunRequest) -> dict[str, Any]:
    companies = request.input.get("companies")
    if not isinstance(companies, list):
        raise HTTPException(status_code=400, detail="input.companies must be a list.")

    classified = [classify_company(company).model_dump() for company in companies if isinstance(company, dict)]
    return {
        "agent": "lead-classifier-agent",
        "task": request.task.value,
        "classified_leads": classified,
    }
