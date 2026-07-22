import os
from enum import Enum
from typing import Any
from uuid import uuid4

import requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


app = FastAPI(title="Outreach Task Agent", version="0.1.0")
EXCLUDED_MANAGER_NUMBERS = {1}
EXCLUDED_MANAGER_USER_IDS = {
    "1cd6e148-8714-4b42-bdc6-b73030c7e249",  # Hadi A
    "6309b2b9-16f3-490e-939e-9e5282ff5e88",  # Aayan Pattanayak
}
EXCLUDED_MANAGER_EMAILS = {
    "hadiabdul8128@gmail.com",
    "lachyhachy@gmail.com",
    "aayanp@gmail.com",
}
EXCLUDED_MANAGER_NAMES = {"hadi", "hadi a", "aayan pattanayak"}


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
    managers = [
        manager
        for manager in managers
        if manager.get("manager_number") not in EXCLUDED_MANAGER_NUMBERS
        and str(manager.get("user_id") or "").strip().lower()
        not in EXCLUDED_MANAGER_USER_IDS
        and str(manager.get("email") or "").strip().lower()
        not in EXCLUDED_MANAGER_EMAILS
        and str(manager.get("name") or "").strip().lower()
        not in EXCLUDED_MANAGER_NAMES
    ]
    if not managers:
        raise HTTPException(status_code=409, detail="No eligible active manager profiles found.")
    return managers


def fetch_pending_counts() -> dict[str, int]:
    response = requests.get(
        rest_url("outreach_tasks"),
        headers=supabase_headers(),
        params={
            "select": "assigned_to",
            "status": "in.(pending_review,needs_edit,approved)",
        },
        timeout=15,
    )

    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Unable to fetch task load: {response.text}")

    counts: dict[str, int] = {}
    for row in response.json():
        assigned_to = row.get("assigned_to")
        if assigned_to:
            counts[assigned_to] = counts.get(assigned_to, 0) + 1
    return counts


def task_exists(draft: DraftInput) -> bool:
    params = {
        "select": "id,contact_email,organization_name,organization_website",
        "contact_email": f"ilike.{draft.contact_email}",
    }

    response = requests.get(
        rest_url("outreach_tasks"),
        headers=supabase_headers(),
        params=params,
        timeout=15,
    )

    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Duplicate check failed: {response.text}")

    draft_email = draft.contact_email.strip().lower()
    draft_website = (draft.organization_website or "").strip().lower()
    draft_name = draft.organization_name.strip().lower()

    for row in response.json():
        row_email = str(row.get("contact_email") or "").strip().lower()
        row_website = str(row.get("organization_website") or "").strip().lower()
        row_name = str(row.get("organization_name") or "").strip().lower()
        if row_email != draft_email:
            continue
        if draft_website and row_website == draft_website:
            return True
        if row_name == draft_name:
            return True
    return False


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


def manager_number_sort_key(manager_number: int | str) -> tuple[int, int | str]:
    try:
        return (0, int(manager_number))
    except (TypeError, ValueError):
        return (1, str(manager_number))


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


def build_task_row(draft: DraftInput, manager: dict[str, Any], batch_id: str) -> dict[str, Any]:
    return {
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
        "created_by_agent": "tracy",
        "source_payload": draft.source_payload or {},
    }


def insert_tasks(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    response = requests.post(
        rest_url("outreach_tasks"),
        headers={**supabase_headers(), "Prefer": "return=representation"},
        json=rows,
        timeout=15,
    )

    if response.status_code == 409:
        raise HTTPException(
            status_code=409,
            detail="Bulk task insert found a duplicate; no outreach task rows were inserted.",
        )

    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Task insert failed: {response.text}")

    return response.json()


@app.post("/run")
def run(request: RunRequest) -> dict[str, Any]:
    drafts = normalize_drafts(request.input.get("drafts"))
    managers = fetch_active_managers()
    pending_counts = fetch_pending_counts()

    batch_id = request.input.get("batch_id") or str(uuid4())
    created: list[dict[str, Any]] = []
    skipped_duplicates: list[dict[str, Any]] = []
    assignment_counts: dict[int | str, int] = {}
    qualified: list[DraftInput] = []

    for draft in drafts:
        if task_exists(draft):
            skipped_duplicates.append(draft.model_dump())
            continue
        qualified.append(draft)

    target_drafts = len(managers) * 3
    full_manager_sets = min(len(managers), len(qualified) // 3)
    if full_manager_sets < 1:
        return {
            "agent": "outreach-task-agent",
            "task": request.task.value,
            "batch_id": batch_id,
            "created": 0,
            "eligible_manager_count": len(managers),
            "target_drafts": target_drafts,
            "skipped_duplicates": len(skipped_duplicates),
            "qualified_not_inserted": len(qualified),
            "unfilled_manager_sets": len(managers),
            "assignments": [],
            "tasks": [],
            "status": "blocked_incomplete_manager_set",
            "detail": "Fewer than 3 non-duplicate drafts were available, so no outreach_tasks rows were inserted.",
        }

    selected_managers = sorted(
        managers,
        key=lambda manager: (
            pending_counts.get(manager["user_id"], 0),
            manager.get("manager_number") or 999999,
            manager.get("email") or "",
        ),
    )[:full_manager_sets]

    selected_drafts = qualified[: full_manager_sets * 3]
    rows: list[dict[str, Any]] = []
    row_managers: list[dict[str, Any]] = []

    for index, draft in enumerate(selected_drafts):
        manager = selected_managers[index // 3]
        draft = assign_sender_to_draft(draft, manager)
        rows.append(build_task_row(draft, manager, batch_id))
        row_managers.append(manager)

    inserted_tasks = insert_tasks(rows)

    for task, manager in zip(inserted_tasks, row_managers):
        created.append(task)
        manager_number = manager.get("manager_number") or manager["user_id"]
        assignment_counts[manager_number] = assignment_counts.get(manager_number, 0) + 1

    assignments = [
        {"manager_number": manager_number, "task_count": count}
        for manager_number, count in sorted(
            assignment_counts.items(), key=lambda item: manager_number_sort_key(item[0])
        )
    ]

    return {
        "agent": "outreach-task-agent",
        "task": request.task.value,
        "batch_id": batch_id,
        "created": len(created),
        "eligible_manager_count": len(managers),
        "target_drafts": target_drafts,
        "skipped_duplicates": len(skipped_duplicates),
        "qualified_not_inserted": max(len(qualified) - len(selected_drafts), 0),
        "unfilled_manager_sets": max(len(managers) - full_manager_sets, 0),
        "status": (
            "complete"
            if created == len(selected_drafts)
            and full_manager_sets == len(managers)
            else "partial_complete"
            if created == len(selected_drafts)
            else "partial_error"
        ),
        "assignments": assignments,
        "tasks": created,
    }
