import os
import re
from enum import Enum
from typing import Any
from urllib.parse import urlparse

import requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


app = FastAPI(title="Company Research Agent", version="0.2.0")


EXCLUDE_TERMS = [
    "startup",
    "startups",
    "SaaS",
    "AI",
    "software",
    "venture",
    "agency",
    "ecommerce",
    "consulting",
    "funding",
    "YC",
    "Series A",
    "Series B",
]


class TaskType(str, Enum):
    research_companies = "research_companies"


class RunRequest(BaseModel):
    task: TaskType
    input: dict[str, Any] = Field(default_factory=dict)


@app.get("/")
def root() -> dict[str, str]:
    return {"agent": "company-research-agent", "status": "running"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def allow_placeholder_data() -> bool:
    return os.getenv("ALLOW_PLACEHOLDER_DATA", "false").lower() == "true"


def tavily_key() -> str:
    return os.getenv("TAVILY_API_KEY", "")


def google_config() -> tuple[str, str]:
    api_key = os.getenv("GOOGLE_SEARCH_API_KEY", "")
    search_engine_id = os.getenv("GOOGLE_SEARCH_ENGINE_ID", "")
    if not api_key or not search_engine_id:
        if allow_placeholder_data():
            return "", ""
        raise HTTPException(
            status_code=500,
            detail=(
                "Company search is not configured. Set TAVILY_API_KEY, or set "
                "GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_ENGINE_ID in .env."
            ),
        )
    return api_key, search_engine_id


def clean_title(title: str) -> str:
    title = re.sub(r"\s*[-|–:].*$", "", title).strip()
    title = re.sub(r"\b(official site|home|homepage)\b", "", title, flags=re.I).strip()
    return title or "Unknown organization"


def name_from_domain(domain: str) -> str:
    label = domain.split(".", 1)[0]
    label = re.sub(r"[-_]+", " ", label)
    return " ".join(part.capitalize() for part in label.split()) or domain


def organization_name(title: str, domain: str) -> str:
    cleaned = clean_title(title)
    generic_titles = {
        "Volunteer",
        "Ways to Volunteer",
        "Get Involved",
        "Donate",
        "Events",
        "Contact",
        "Services",
        "Ministries",
        "Community events at local",
        "Opportunities",
        "Homeless",
        "Volunteer Opportunities Near Me",
        "Nonprofit Offering Aid To People Experiencing Homelessness",
    }
    if cleaned in generic_titles or cleaned.lower().startswith("[pdf]"):
        return name_from_domain(domain)
    return cleaned


def domain_from_url(url: str) -> str:
    parsed = urlparse(url)
    return (parsed.hostname or "").removeprefix("www.").lower()


def root_website(url: str) -> str:
    parsed = urlparse(url)
    domain = (parsed.hostname or "").removeprefix("www.")
    if not domain:
        return url
    return f"{parsed.scheme or 'https'}://{domain}"


def is_low_value_domain(domain: str) -> bool:
    blocked = {
        "linkedin.com",
        "facebook.com",
        "twitter.com",
        "x.com",
        "instagram.com",
        "youtube.com",
        "crunchbase.com",
        "pitchbook.com",
        "owler.com",
        "glassdoor.com",
        "indeed.com",
        "builtin.com",
        "g2.com",
        "wikipedia.org",
        "reddit.com",
        "usembassy.gov",
        "common.usembassy.gov",
        "open.bu.edu",
        "seedtable.com",
        "aifundingtracker.com",
        "topstartups.io",
        "bvp.com",
        "fiercehealthcare.com",
        "cbinsights.com",
        "techcrunch.com",
        "forbes.com",
        "businesswire.com",
        "prnewswire.com",
        "globenewswire.com",
        "ycombinator.com",
        "wellfound.com",
        "dealroom.co",
        "tracxn.com",
        "f6s.com",
        "mobihealthnews.com",
        "startup-weekly.com",
        "entrepreneurloop.com",
        "technews180.com",
        "ititans.com",
    }
    return domain in blocked or any(domain.endswith(f".{blocked_domain}") for blocked_domain in blocked)


def build_queries(criteria: dict[str, Any], limit: int) -> list[str]:
    location = criteria.get("location", "United States")
    keywords = " ".join(str(keyword) for keyword in criteria.get("keywords", [])[:8])
    exclude = " ".join(f"-{term}" for term in EXCLUDE_TERMS)
    geography = str(location or "United States")

    return [
        f'site:.org ({geography}) church mosque temple "religious center" donate volunteer events {keywords} {exclude}',
        f'({geography}) "homeless shelter" "food pantry" nonprofit donate volunteer services site:.org {keywords} {exclude}',
        f'({geography}) "community outreach" "local nonprofit" "religious center" ministries services contact site:.org {keywords} {exclude}',
    ][: max(1, min(3, (limit + 9) // 10 + 1))]


def google_search(query: str, api_key: str, search_engine_id: str) -> list[dict[str, Any]]:
    response = requests.get(
        "https://www.googleapis.com/customsearch/v1",
        params={
            "key": api_key,
            "cx": search_engine_id,
            "q": query,
            "num": 10,
            "safe": "active",
        },
        timeout=20,
    )

    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Google Search failed: {response.text}")

    return response.json().get("items", [])


def tavily_search(query: str, api_key: str, limit: int) -> list[dict[str, Any]]:
    response = requests.post(
        "https://api.tavily.com/search",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "query": query,
            "topic": "general",
            "search_depth": "basic",
            "max_results": max(1, min(limit, 20)),
            "include_answer": False,
            "include_raw_content": False,
        },
        timeout=25,
    )

    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Tavily Search failed: {response.text}")

    return response.json().get("results", [])


def company_name_from_result(item: dict[str, Any]) -> str | None:
    title = item.get("title") or ""
    patterns = [
        r"^([A-Z][A-Za-z0-9 .&'/-]{2,100}?)\s+(?:church|mosque|temple|ministries|shelter|food pantry|nonprofit)",
        r"^([A-Z][A-Za-z0-9 .&'/-]{2,100}?)\s+[-|:]",
    ]
    for pattern in patterns:
        match = re.search(pattern, title)
        if match:
            return clean_title(match.group(1))
    return None


def resolve_company_website(name: str, api_key: str) -> dict[str, Any] | None:
    results = tavily_search(f'"{name}" official website nonprofit church shelter food pantry', api_key, 5)
    for item in results:
        link = item.get("url") or item.get("link", "")
        domain = domain_from_url(link)
        if domain and not is_low_value_domain(domain):
            return item
    return None


def placeholder_companies(criteria: dict[str, Any], limit: int) -> list[dict[str, Any]]:
    industry = criteria.get("industry", "target industry")
    location = criteria.get("location", "target location")
    companies = [
        {
            "name": "Example Community Church",
            "website": "https://examplechurch.org",
            "domain": "examplechurch.org",
            "industry": industry,
            "location": "Boston, MA" if location == "United States" else location,
            "description": "Local church with volunteer programs, donation pages, and community events.",
            "signals": ["placeholder", "church", "donate", "volunteer", "events"],
            "source_urls": [],
        }
    ]
    return companies[:limit]


@app.post("/run")
def run(request: RunRequest) -> dict[str, Any]:
    criteria = request.input
    limit = max(1, min(int(criteria.get("limit", 10)), 30))
    tavily_api_key = tavily_key()
    api_key = ""
    search_engine_id = ""

    if not tavily_api_key:
        api_key, search_engine_id = google_config()

    if not tavily_api_key and not api_key and allow_placeholder_data():
        companies = placeholder_companies(criteria, limit)
        return {
            "agent": "company-research-agent",
            "task": request.task.value,
            "mode": "placeholder",
            "criteria": criteria,
            "companies": companies,
        }

    companies: list[dict[str, Any]] = []
    seen_domains: set[str] = set()
    queries = build_queries(criteria, limit)

    mode = "tavily_search" if tavily_api_key else "google_custom_search"

    for query in queries:
        items = (
            tavily_search(query, tavily_api_key, limit)
            if tavily_api_key
            else google_search(query, api_key, search_engine_id)
        )

        for item in items:
            link = item.get("url") or item.get("link", "")
            domain = domain_from_url(link)
            source_url = link
            source_title = item.get("title", "")
            if link.lower().endswith(".pdf"):
                continue

            if tavily_api_key and domain and is_low_value_domain(domain):
                derived_name = company_name_from_result(item)
                if not derived_name:
                    continue
                resolved = resolve_company_website(derived_name, tavily_api_key)
                if not resolved:
                    continue
                item = resolved
                link = item.get("url") or item.get("link", "")
                domain = domain_from_url(link)
                item["title"] = derived_name

            if not domain or domain in seen_domains or is_low_value_domain(domain):
                continue

            seen_domains.add(domain)
            companies.append(
                {
                    "name": organization_name(item.get("title", domain), domain),
                    "website": root_website(link),
                    "domain": domain,
                    "industry": criteria.get("industry"),
                    "location": criteria.get("location"),
                    "company_stage": criteria.get("company_stage"),
                    "description": item.get("content") or item.get("snippet", ""),
                    "signals": [mode, f"matched query: {query}"],
                    "source_urls": [source_url] if source_url and source_url != link else [link],
                    "discovered_from": source_title,
                }
            )

            if len(companies) >= limit:
                break
        if len(companies) >= limit:
            break

    return {
        "agent": "company-research-agent",
        "task": request.task.value,
        "mode": mode,
        "criteria": criteria,
        "queries": queries,
        "companies": companies,
    }
