import os
import smtplib
from email.message import EmailMessage
from enum import Enum
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


app = FastAPI(title="Email Sending Agent", version="0.1.0")


class TaskType(str, Enum):
    send_email = "send_email"


class RunRequest(BaseModel):
    task: TaskType
    input: dict[str, Any] = Field(default_factory=dict)


@app.get("/")
def root() -> dict[str, str]:
    return {"agent": "email-sending-agent", "status": "running"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def env_enabled(name: str) -> bool:
    return os.getenv(name, "").strip().lower() in {"1", "true", "yes", "on"}


@app.post("/run")
def run(request: RunRequest) -> dict[str, Any]:
    email = request.input.get("email", {})
    recipient = email.get("to")
    decision = str(
        request.input.get("decision")
        or request.input.get("company_decision")
        or request.input.get("company", {}).get("decision", "")
    ).lower()

    if not recipient:
        raise HTTPException(status_code=400, detail="Recipient email is required.")

    if decision == "reject":
        raise HTTPException(status_code=400, detail="Refusing to send to a rejected company.")

    if not env_enabled("SEND_EMAILS"):
        return {
            "agent": "email-sending-agent",
            "task": request.task.value,
            "sent": False,
            "dry_run": True,
            "message": "Email sending disabled. Draft generated only.",
            "email": email,
        }

    smtp_host = os.getenv("SMTP_HOST", "")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_username = os.getenv("SMTP_USERNAME", "")
    smtp_password = os.getenv("SMTP_PASSWORD", "")
    smtp_from = os.getenv("SMTP_FROM", smtp_username)

    if not smtp_host or not smtp_from:
        raise HTTPException(status_code=400, detail="SMTP_HOST and SMTP_FROM are required when SEND_EMAILS=true.")

    message = EmailMessage()
    message["From"] = smtp_from
    message["To"] = recipient
    message["Subject"] = email.get("subject", "")
    message.set_content(email.get("body", ""))

    with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as smtp:
        if env_enabled("SMTP_USE_TLS"):
            smtp.starttls()
        if smtp_username and smtp_password:
            smtp.login(smtp_username, smtp_password)
        smtp.send_message(message)

    return {
        "agent": "email-sending-agent",
        "task": request.task.value,
        "sent": True,
        "dry_run": False,
        "message": "Email sent.",
    }
