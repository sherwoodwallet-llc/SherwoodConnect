from enum import Enum
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel, Field


app = FastAPI(title="Email Drafting Agent", version="0.2.0")


class TaskType(str, Enum):
    draft_email = "draft_email"


class RunRequest(BaseModel):
    task: TaskType
    input: dict[str, Any] = Field(default_factory=dict)


@app.get("/")
def root() -> dict[str, str]:
    return {"agent": "email-drafting-agent", "status": "running"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/run")
def run(request: RunRequest) -> dict[str, Any]:
    company = request.input.get("company", {})
    contact = request.input.get("contact", {})
    sender = request.input.get("sender_profile", {})

    company_name = company.get("name", "your company")
    contact_name = contact.get("name", "there")
    recipient = contact.get("email", "")
    sender_name = sender.get("name") or "__SENDER_NAME__"
    sender_background = sender.get(
        "background",
        "part of the Sherwood outreach team helping mission-driven organizations improve their digital outreach",
    )
    sender_goal = sender.get(
        "goal",
        "see whether a lightweight website, donor, volunteer, or outreach improvement could be useful",
    )
    company_description = str(company.get("description", "your current growth areas")).rstrip(".")
    fit_context = company.get("lead_category") or company.get("industry") or "mission-driven work"

    subject = f"Quick question about {company_name}"
    body = (
        f"Hi {contact_name},\n\n"
        f"I came across {company_name} and noticed the work around {company_description}.\n\n"
        f"Short version: I am {sender_name}, {sender_background}. Your {fit_context} stood out as the kind "
        f"of work where clearer digital outreach could make a real difference. I am reaching out to {sender_goal}.\n\n"
        "Would you be open to a quick conversation next week?\n\n"
        "Best,\n"
        f"{sender_name}\n\n"
        "If this is not relevant, no worries at all."
    )

    return {
        "agent": "email-drafting-agent",
        "task": request.task.value,
        "company": company,
        "contact": contact,
        "sender_profile": sender,
        "email": {
            "to": recipient,
            "subject": subject,
            "body": body,
        },
    }
