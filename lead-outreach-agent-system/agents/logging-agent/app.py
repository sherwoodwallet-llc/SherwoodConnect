import json
import os
from datetime import UTC, datetime
from enum import Enum
from pathlib import Path
from typing import Any

import requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


app = FastAPI(title="Logging and Memory Agent", version="0.1.0")


class TaskType(str, Enum):
    log_outreach = "log_outreach"


class RunRequest(BaseModel):
    task: TaskType
    input: dict[str, Any] = Field(default_factory=dict)


@app.get("/")
def root() -> dict[str, str]:
    return {"agent": "logging-agent", "status": "running"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def log_to_supabase(payload: dict[str, Any]) -> bool:
    supabase_url = os.getenv("SUPABASE_URL", "").rstrip("/")
    service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    table = os.getenv("SUPABASE_LOG_TABLE", "outreach_logs")

    if not supabase_url or not service_role_key:
        return False

    response = requests.post(
        f"{supabase_url}/rest/v1/{table}",
        headers={
            "apikey": service_role_key,
            "Authorization": f"Bearer {service_role_key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
        json={
            "status": payload.get("status", "unknown"),
            "payload": payload,
        },
        timeout=15,
    )

    if response.status_code >= 400:
        return False

    return True


def log_to_jsonl(payload: dict[str, Any]) -> Path:
    log_file = Path(os.getenv("LOG_FILE", "/data/outreach_logs.jsonl"))
    log_file.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "created_at": datetime.now(UTC).isoformat(),
        "payload": payload,
    }
    with log_file.open("a", encoding="utf-8") as file:
        file.write(json.dumps(record) + "\n")
    return log_file


@app.post("/run")
def run(request: RunRequest) -> dict[str, Any]:
    payload = request.input

    if log_to_supabase(payload):
        return {
            "agent": "logging-agent",
            "task": request.task.value,
            "logged": True,
            "storage": "supabase",
        }

    log_file = log_to_jsonl(payload)
    return {
        "agent": "logging-agent",
        "task": request.task.value,
        "logged": True,
        "storage": "local_jsonl",
        "path": str(log_file),
    }
