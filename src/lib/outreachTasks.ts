import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { getSupabase } from "./supabase";
import type { ManagerProfile } from "./profile";

export type OutreachTaskStatus =
  | "pending_review"
  | "needs_edit"
  | "approved"
  | "sent"
  | "rejected"
  | "failed";

export type OutreachResponseStatus =
  | "not_tracked"
  | "no_response"
  | "replied"
  | "positive"
  | "neutral"
  | "negative"
  | "bounced"
  | "wrong_contact"
  | "do_not_contact";

export type OutreachTask = {
  id: string;
  batchId: string | null;
  organizationName: string;
  organizationType: string | null;
  organizationWebsite: string | null;
  fitReason: string | null;
  contactName: string | null;
  contactEmail: string;
  draftEmail: string;
  draftSubject: string | null;
  assignedTo: string | null;
  assignedManagerNumber: number | null;
  status: OutreachTaskStatus;
  managerNotes: string | null;
  sentAt: Date | null;
  sentBy: string | null;
  responseStatus: OutreachResponseStatus;
  responseScore: number;
  responseReceivedAt: Date | null;
  responseExcerpt: string | null;
  responseNotes: string | null;
  responseUpdatedAt: Date | null;
  responseUpdatedBy: string | null;
  createdAt: Date | null;
};

type OutreachTaskRow = {
  id: string;
  batch_id: string | null;
  organization_name: string;
  organization_type: string | null;
  organization_website: string | null;
  fit_reason: string | null;
  contact_name: string | null;
  contact_email: string;
  draft_email: string;
  draft_subject: string | null;
  assigned_to: string | null;
  assigned_manager_number: number | null;
  status: OutreachTaskStatus;
  manager_notes: string | null;
  sent_at: string | null;
  sent_by: string | null;
  response_status: OutreachResponseStatus;
  response_score: number;
  response_received_at: string | null;
  response_excerpt: string | null;
  response_notes: string | null;
  response_updated_at: string | null;
  response_updated_by: string | null;
  created_at: string | null;
};

type ManagerProfileRow = {
  user_id: string;
  email: string;
  name: string;
  initials: string;
  manager_number: number | null;
  active: boolean;
};

const TASK_SELECT = [
  "id",
  "batch_id",
  "organization_name",
  "organization_type",
  "organization_website",
  "fit_reason",
  "contact_name",
  "contact_email",
  "draft_email",
  "draft_subject",
  "assigned_to",
  "assigned_manager_number",
  "status",
  "manager_notes",
  "sent_at",
  "sent_by",
  "response_status",
  "response_score",
  "response_received_at",
  "response_excerpt",
  "response_notes",
  "response_updated_at",
  "response_updated_by",
  "created_at",
].join(",");

export const ACTIVE_TASK_STATUSES: OutreachTaskStatus[] = [
  "pending_review",
  "needs_edit",
  "approved",
  "failed",
];

export const statusLabels: Record<OutreachTaskStatus, string> = {
  pending_review: "Pending",
  needs_edit: "Needs edit",
  approved: "Approved",
  sent: "Sent",
  rejected: "Rejected",
  failed: "Failed",
};

export const responseStatusLabels: Record<OutreachResponseStatus, string> = {
  not_tracked: "Not tracked",
  no_response: "No response",
  replied: "Replied",
  positive: "Positive",
  neutral: "Neutral",
  negative: "Negative",
  bounced: "Bounced",
  wrong_contact: "Wrong contact",
  do_not_contact: "Do not contact",
};

export const responseScoreLabels: Record<number, string> = {
  [-2]: "Bad fit / harmful",
  [-1]: "Weak signal",
  0: "No signal yet",
  1: "Reply",
  2: "Positive reply",
  3: "Booked / high intent",
};

function mapTask(row: OutreachTaskRow): OutreachTask {
  return {
    id: row.id,
    batchId: row.batch_id,
    organizationName: row.organization_name,
    organizationType: row.organization_type,
    organizationWebsite: row.organization_website,
    fitReason: row.fit_reason,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    draftEmail: row.draft_email,
    draftSubject: row.draft_subject,
    assignedTo: row.assigned_to,
    assignedManagerNumber: row.assigned_manager_number,
    status: row.status,
    managerNotes: row.manager_notes,
    sentAt: row.sent_at ? new Date(row.sent_at) : null,
    sentBy: row.sent_by,
    responseStatus: row.response_status,
    responseScore: row.response_score,
    responseReceivedAt: row.response_received_at
      ? new Date(row.response_received_at)
      : null,
    responseExcerpt: row.response_excerpt,
    responseNotes: row.response_notes,
    responseUpdatedAt: row.response_updated_at
      ? new Date(row.response_updated_at)
      : null,
    responseUpdatedBy: row.response_updated_by,
    createdAt: row.created_at ? new Date(row.created_at) : null,
  };
}

function mapManager(row: ManagerProfileRow): ManagerProfile {
  return {
    userId: row.user_id,
    email: row.email,
    name: row.name,
    initials: row.initials,
    managerNumber: row.manager_number,
    active: row.active,
  };
}

function sortByCreatedDesc(tasks: OutreachTask[]) {
  return [...tasks].sort(
    (a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0),
  );
}

export function managerLabel(manager?: ManagerProfile | null) {
  if (!manager) return "Unassigned";
  const prefix = manager.managerNumber ? `#${manager.managerNumber} ` : "";
  return `${prefix}${manager.name || manager.email}`;
}

export async function fetchManagers(): Promise<ManagerProfile[]> {
  const { data, error } = await getSupabase()
    .from("manager_profiles")
    .select("user_id,email,name,initials,manager_number,active")
    .order("manager_number", { ascending: true });

  if (error) throw error;
  return ((data ?? []) as ManagerProfileRow[]).map(mapManager);
}

export async function updateOutreachTask(
  id: string,
  patch: Partial<{
    status: OutreachTaskStatus;
    manager_notes: string;
    sent_at: string | null;
    sent_by: string | null;
    response_status: OutreachResponseStatus;
    response_score: number;
    response_received_at: string | null;
    response_excerpt: string | null;
    response_notes: string | null;
    response_updated_at: string | null;
    response_updated_by: string | null;
  }>,
): Promise<void> {
  const { error } = await getSupabase().from("outreach_tasks").update(patch).eq("id", id);
  if (error) throw error;
}

export function subscribeOutreachTasks(
  scope: "own" | "all",
  uid: string,
  onData: (tasks: OutreachTask[]) => void,
  onError?: (error: Error) => void,
): () => void {
  const supabase = getSupabase();
  let active = true;
  let current: OutreachTask[] = [];

  const emit = (rows: OutreachTask[]) => {
    current = sortByCreatedDesc(rows);
    onData(current);
  };

  const query = supabase
    .from("outreach_tasks")
    .select(TASK_SELECT)
    .order("created_at", { ascending: false });

  const initialRequest = scope === "own" ? query.eq("assigned_to", uid) : query;

  void initialRequest.then(({ data, error }) => {
    if (!active) return;
    if (error) {
      onError?.(error);
      return;
    }
    emit(((data ?? []) as unknown as OutreachTaskRow[]).map(mapTask));
  });

  const channelConfig = {
    event: "*" as const,
    schema: "public",
    table: "outreach_tasks",
    ...(scope === "own" ? { filter: `assigned_to=eq.${uid}` } : {}),
  };

  const channel = supabase
    .channel(`outreach-tasks-${scope}-${uid}`)
    .on(
      "postgres_changes",
      channelConfig,
      (payload: RealtimePostgresChangesPayload<OutreachTaskRow>) => {
        if (!active) return;
        if (payload.eventType === "INSERT") {
          emit([mapTask(payload.new), ...current.filter((task) => task.id !== payload.new.id)]);
        } else if (payload.eventType === "UPDATE") {
          emit(
            current.map((task) =>
              task.id === payload.new.id ? mapTask(payload.new) : task,
            ),
          );
        } else if (payload.eventType === "DELETE") {
          emit(current.filter((task) => task.id !== payload.old.id));
        }
      },
    )
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR") {
        onError?.(new Error("Could not connect to live task updates."));
      }
    });

  return () => {
    active = false;
    void supabase.removeChannel(channel);
  };
}
