import os
import random
from enum import Enum
from typing import Any
from uuid import uuid4

import requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


app = FastAPI(title="Outreach Task Agent", version="0.1.0")


class TaskType(str, Enum):
    create_outreach_tasks = "create_outreach_tasks"


class RunRequest(BaseModel):
    task: TaskType
    input: dict[str, Any] = Field(default_factory=dict)


class DraftInput(BaseModel):
    organization_name: str
    organization_type: str | None = None
    organization_website: str | None = None
    fit_reason: str | None = None
    contact_name: str | None = None
    contact_email: str
    draft_email: str
    draft_subject: str | None = None
    source_payload: dict[str, Any] | None = None


@app.get("/")
def root() -> dict[str, str]:
    return {"agent": "outreach-task-agent", "status": "running"}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def supabase_headers() -> dict[str, str]:
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    if not key:
        raise HTTPException(status_code=500, detail="SUPABASE_SERVICE_ROLE_KEY is not configured.")
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


def supabase_url() -> str:
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    if not url:
        raise HTTPException(status_code=500, detail="SUPABASE_URL is not configured.")
    return url


def rest_url(table: str) -> str:
    return f"{supabase_url()}/rest/v1/{table}"


def fetch_active_managers() -> list[dict[str, Any]]:
    response = requests.get(
        rest_url("manager_profiles"),
        headers=supabase_headers(),
        params={
            "select": "user_id,email,name,initials,manager_number",
            "active": "eq.true",
            "order": "manager_number.asc",
        },
        timeout=15,
    )

    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Unable to fetch managers: {response.text}")

    managers = response.json()
    if not managers:
        raise HTTPException(status_code=409, detail="No active manager profiles found.")
    return managers


def task_exists(draft: DraftInput) -> bool:
    params = {
        "select": "id",
        "contact_email": f"eq.{draft.contact_email}",
        "limit": "1",
    }

    if draft.organization_website:
        params["organization_website"] = f"eq.{draft.organization_website}"
    else:
        params["organization_name"] = f"eq.{draft.organization_name}"

    response = requests.get(
        rest_url("outreach_tasks"),
        headers=supabase_headers(),
        params=params,
        timeout=15,
    )

    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Duplicate check failed: {response.text}")

    return bool(response.json())


def normalize_drafts(raw_drafts: Any) -> list[DraftInput]:
    if not isinstance(raw_drafts, list):
        raise HTTPException(status_code=400, detail="input.drafts must be a list.")

    drafts: list[DraftInput] = []
    errors: list[dict[str, Any]] = []

    for index, raw in enumerate(raw_drafts):
        try:
            drafts.append(DraftInput.model_validate(raw))
        except Exception as error:
            errors.append({"index": index, "error": str(error)})

    if errors:
        raise HTTPException(status_code=422, detail={"message": "Invalid drafts.", "errors": errors})

    if not drafts:
        raise HTTPException(status_code=400, detail="No drafts supplied.")

    return drafts


def manager_display_name(manager: dict[str, Any]) -> str:
    for key in ("name", "initials", "email"):
        value = str(manager.get(key) or "").strip()
        if value:
            return value
    return f"Manager {manager.get('manager_number') or manager['user_id']}"


def assign_sender_to_draft(draft: DraftInput, manager: dict[str, Any]) -> DraftInput:
    sender_name = manager_display_name(manager)
    draft_data = draft.model_dump()
    draft_data["draft_email"] = (
        draft.draft_email
        .replace("__SENDER_NAME__", sender_name)
        .replace("{{SENDER_NAME}}", sender_name)
    )

    source_payload = dict(draft.source_payload or {})
    source_payload["assigned_sender"] = {
        "user_id": manager.get("user_id"),
        "email": manager.get("email"),
        "name": manager.get("name"),
        "initials": manager.get("initials"),
        "manager_number": manager.get("manager_number"),
        "display_name": sender_name,
    }
    draft_data["source_payload"] = source_payload

    return DraftInput.model_validate(draft_data)


def insert_task(draft: DraftInput, manager: dict[str, Any], batch_id: str) -> dict[str, Any]:
    row = {
        "batch_id": batch_id,
        "organization_name": draft.organization_name,
        "organization_type": draft.organization_type,
        "organization_website": draft.organization_website,
        "fit_reason": draft.fit_reason,
        "contact_name": draft.contact_name,
        "contact_email": draft.contact_email,
        "draft_email": draft.draft_email,
        "draft_subject": draft.draft_subject,
        "assigned_to": manager["user_id"],
        "assigned_manager_number": manager.get("manager_number"),
        "status": "pending_review",
        "created_by_agent": "outreach-task-agent",
        "source_payload": draft.source_payload or {},
    }

    response = requests.post(
        rest_url("outreach_tasks"),
        headers={**supabase_headers(), "Prefer": "return=representation"},
        json=row,
        timeout=15,
    )

    if response.status_code == 409:
        return {"status": "duplicate", "draft": draft.model_dump()}

    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Task insert failed: {response.text}")

    inserted = response.json()
    return {"status": "created", "task": inserted[0] if inserted else row}


@app.post("/run")
def run(request: RunRequest) -> dict[str, Any]:
    drafts = normalize_drafts(request.input.get("drafts"))
    managers = fetch_active_managers()
    random.shuffle(managers)

    batch_id = request.input.get("batch_id") or str(uuid4())
    created: list[dict[str, Any]] = []
    skipped_duplicates: list[dict[str, Any]] = []
    assignment_counts: dict[int | str, int] = {}

    assignable_index = 0
    for draft in drafts:
        if task_exists(draft):
            skipped_duplicates.append(draft.model_dump())
            continue

        manager = managers[assignable_index % len(managers)]
        assignable_index += 1
        draft = assign_sender_to_draft(draft, manager)

        result = insert_task(draft, manager, batch_id)
        if result["status"] == "duplicate":
            skipped_duplicates.append(draft.model_dump())
            continue

        task = result["task"]
        created.append(task)
        manager_number = manager.get("manager_number") or manager["user_id"]
        assignment_counts[manager_number] = assignment_counts.get(manager_number, 0) + 1

    assignments = [
        {"manager_number": manager_number, "task_count": count}
        for manager_number, count in sorted(assignment_counts.items(), key=lambda item: str(item[0]))
    ]

    return {
        "agent": "outreach-task-agent",
        "task": request.task.value,
        "batch_id": batch_id,
        "created": len(created),
        "skipped_duplicates": len(skipped_duplicates),
        "assignments": assignments,
        "tasks": created,
    }
