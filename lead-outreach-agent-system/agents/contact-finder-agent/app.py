import os
from enum import Enum
from typing import Any
from urllib.parse import urlparse

import requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


app = FastAPI(title="Contact Finder Agent", version="0.2.0")


class TaskType(str, Enum):
    find_contacts = "find_contacts"


class RunRequest(BaseModel):
    task: TaskType
    input: dict[str, Any] = Field(default_factory=dict)


@app.get("/")
def root() -> dict[str, str]:
    return {"agent": "contact-finder-agent", "status": "running"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def allow_placeholder_data() -> bool:
    return os.getenv("ALLOW_PLACEHOLDER_DATA", "false").lower() == "true"


def apollo_key() -> str:
    return os.getenv("APOLLO_API_KEY", "")


def apollo_headers() -> dict[str, str]:
    key = apollo_key()
    return {
        "accept": "application/json",
        "cache-control": "no-cache",
        "content-type": "application/json",
        "X-Api-Key": key,
    }


def hunter_key() -> str:
    return os.getenv("HUNTER_API_KEY", "")


def domain_from_company(company: dict[str, Any]) -> str:
    if company.get("domain"):
        return str(company["domain"]).removeprefix("www.").lower()
    website = company.get("website")
    if not website:
        return ""
    parsed = urlparse(str(website))
    return (parsed.hostname or "").removeprefix("www.").lower()


def split_name(name: str) -> tuple[str | None, str | None]:
    parts = [part for part in name.split() if part]
    if len(parts) < 2:
        return (parts[0], None) if parts else (None, None)
    return parts[0], parts[-1]


def extract_email(person: dict[str, Any]) -> str | None:
    for key in ("email", "email_address", "work_email"):
        value = person.get(key)
        if isinstance(value, str) and "@" in value:
            return value

    for collection_key in ("emails", "personal_emails"):
        values = person.get(collection_key)
        if isinstance(values, list):
            for value in values:
                if isinstance(value, str) and "@" in value:
                    return value
                if isinstance(value, dict):
                    email = value.get("email") or value.get("email_address")
                    if isinstance(email, str) and "@" in email:
                        return email

    return None


def apollo_people_search(company: dict[str, Any], target_roles: list[str], limit: int) -> list[dict[str, Any]]:
    domain = domain_from_company(company)
    if not domain:
        raise HTTPException(status_code=400, detail="Company website/domain is required for Apollo contact search.")

    payload = {
        "q_organization_domains_list": [domain],
        "person_titles": target_roles,
        "person_seniorities": ["owner", "founder", "c_suite", "partner", "vp", "head", "director"],
        "contact_email_status": ["verified", "likely to engage"],
        "include_similar_titles": True,
        "page": 1,
        "per_page": max(1, min(limit, 10)),
    }

    response = requests.post(
        "https://api.apollo.io/api/v1/mixed_people/api_search",
        headers=apollo_headers(),
        json=payload,
        timeout=25,
    )

    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Apollo People Search failed: {response.text}")

    data = response.json()
    return data.get("people") or data.get("contacts") or []


def apollo_enrich_person(person: dict[str, Any], company: dict[str, Any]) -> dict[str, Any]:
    domain = domain_from_company(company)
    reveal_personal = os.getenv("APOLLO_REVEAL_PERSONAL_EMAILS", "false").lower() == "true"
    name = person.get("name") or " ".join(
        part for part in [person.get("first_name"), person.get("last_name")] if part
    )
    first_name, last_name = split_name(name)

    payload: dict[str, Any] = {
        "domain": domain,
        "organization_name": company.get("name"),
        "reveal_personal_emails": reveal_personal,
    }
    if person.get("id"):
        payload["id"] = person["id"]
    if name:
        payload["name"] = name
    if first_name:
        payload["first_name"] = first_name
    if last_name:
        payload["last_name"] = last_name
    if person.get("linkedin_url"):
        payload["linkedin_url"] = person["linkedin_url"]

    response = requests.post(
        "https://api.apollo.io/api/v1/people/match",
        headers=apollo_headers(),
        json=payload,
        timeout=25,
    )

    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Apollo People Enrichment failed: {response.text}")

    data = response.json()
    return data.get("person") or data


def normalize_contact(person: dict[str, Any], enriched: dict[str, Any], company: dict[str, Any]) -> dict[str, Any] | None:
    merged = {**person, **enriched}
    email = extract_email(merged)
    if not email:
        return None

    name = merged.get("name") or " ".join(
        part for part in [merged.get("first_name"), merged.get("last_name")] if part
    )

    return {
        "name": name or "Unknown contact",
        "title": merged.get("title") or merged.get("headline") or "Decision maker",
        "email": email,
        "confidence": merged.get("email_status") or merged.get("contact_email_status") or "apollo",
        "linkedin_url": merged.get("linkedin_url"),
        "source": "apollo",
        "company_domain": domain_from_company(company),
    }


def title_rank(contact: dict[str, Any], target_roles: list[str]) -> int:
    text = " ".join(
        str(part)
        for part in [
            contact.get("position"),
            contact.get("title"),
            contact.get("department"),
            " ".join(target_roles),
        ]
        if part
    ).lower()
    if any(term in text for term in ["founder", "co-founder", "owner"]):
        return 0
    if any(term in text for term in ["chief", "ceo", "president"]):
        return 1
    if any(term in text for term in ["vp", "vice president", "head", "director", "partnership"]):
        return 2
    if any(term in text for term in ["growth", "marketing", "business development"]):
        return 3
    return 9


def hunter_domain_search(company: dict[str, Any], target_roles: list[str], limit: int) -> list[dict[str, Any]]:
    key = hunter_key()
    if not key:
        raise HTTPException(
            status_code=500,
            detail="No contact provider configured. Set HUNTER_API_KEY or APOLLO_API_KEY in .env.",
        )

    domain = domain_from_company(company)
    if not domain:
        raise HTTPException(status_code=400, detail="Company website/domain is required for Hunter Domain Search.")

    response = requests.get(
        "https://api.hunter.io/v2/domain-search",
        params={
            "domain": domain,
            "api_key": key,
            "limit": max(1, min(10, limit * 3)),
        },
        timeout=25,
    )

    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Hunter Domain Search failed: {response.text}")

    data = response.json().get("data", {})
    raw_contacts = data.get("emails", [])
    ranked = sorted(
        raw_contacts,
        key=lambda item: (
            title_rank(item, target_roles),
            -int(item.get("confidence") or 0),
        ),
    )

    contacts: list[dict[str, Any]] = []
    for item in ranked:
        email = item.get("value")
        if not isinstance(email, str) or "@" not in email:
            continue

        first_name = item.get("first_name") or ""
        last_name = item.get("last_name") or ""
        name = " ".join(part for part in [first_name, last_name] if part).strip()
        contacts.append(
            {
                "name": name or email.split("@", 1)[0],
                "title": item.get("position") or item.get("department") or "Decision maker",
                "email": email,
                "confidence": item.get("confidence"),
                "linkedin_url": item.get("linkedin"),
                "source": "hunter_domain_search",
                "company_domain": domain,
            }
        )

        if len(contacts) >= limit:
            break

    return contacts


def placeholder_contacts(company: dict[str, Any], target_roles: list[str]) -> list[dict[str, Any]]:
    domain = domain_from_company(company) or "example.com"
    primary_role = target_roles[0] if target_roles else "Founder"
    return [
        {
            "name": "Jane Doe",
            "title": primary_role,
            "email": f"jane.doe@{domain}",
            "confidence": 0.82,
            "source": "placeholder",
        }
    ]


@app.post("/run")
def run(request: RunRequest) -> dict[str, Any]:
    company = request.input.get("company", {})
    target_roles = request.input.get(
        "target_roles",
        ["Founder", "CEO", "Chief Executive Officer", "Head of Partnerships", "VP Partnerships"],
    )
    limit = max(1, min(int(request.input.get("limit", 3)), 10))

    if not apollo_key() and not hunter_key() and allow_placeholder_data():
        contacts = placeholder_contacts(company, target_roles)
        return {
            "agent": "contact-finder-agent",
            "task": request.task.value,
            "mode": "placeholder",
            "company": company,
            "contacts": contacts,
        }

    contacts: list[dict[str, Any]] = []
    people_examined = 0
    mode = "hunter"

    if hunter_key():
        contacts = hunter_domain_search(company, target_roles, limit)
        mode = "hunter"

    if not contacts and apollo_key():
        try:
            people = apollo_people_search(company, target_roles, limit)
            people_examined = len(people)
            for person in people:
                enriched = apollo_enrich_person(person, company)
                contact = normalize_contact(person, enriched, company)
                if contact:
                    contacts.append(contact)
                if len(contacts) >= limit:
                    break
            mode = "apollo"
        except HTTPException as error:
            if not hunter_key():
                raise error

    return {
        "agent": "contact-finder-agent",
        "task": request.task.value,
        "mode": mode,
        "company": company,
        "contacts": contacts,
        "people_examined": people_examined,
    }
