import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { getSupabase } from "./supabase";
import { submitToGoogleSheets } from "./googleSheets";
import type { ManagerProfile } from "./profile";

export const ORGANIZATION_COLUMN = "Organization";

export const DETAIL_COLUMNS = [
  "Phone Number",
  "Notes",
  "Meeting Booked",
] as const;

export const LOG_COLUMNS = [ORGANIZATION_COLUMN, ...DETAIL_COLUMNS] as const;

export const MANAGER_COLUMN = "Manager Initials";

export const SHEET_COLUMNS = [
  ...LOG_COLUMNS,
  MANAGER_COLUMN,
] as const;

export type LogData = Record<string, string>;

export type OutreachLog = {
  id: string;
  data: LogData;
  ownerUid: string;
  ownerEmail: string;
  ownerName: string;
  createdAt: Date | null;
};

type LogRow = {
  id: string;
  organization_name: string;
  data: LogData | null;
  owner_uid: string;
  owner_email: string;
  owner_name: string;
  created_at: string | null;
};

export async function checkOrganizationAvailability(
  organization: string,
): Promise<boolean> {
  const name = organization.trim();
  if (!name) return false;

  const {
    data: { session },
  } = await getSupabase().auth.getSession();
  if (!session) throw new Error("Sign in again to check this organization.");

  const response = await fetch("/api/organizations/check", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ organization: name }),
  });
  const result = (await response.json().catch(() => ({}))) as {
    available?: boolean;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(result.error || "Could not check the organization.");
  }

  return result.available === true;
}

export async function addLog(args: {
  data: LogData;
  uid: string;
  email: string;
  profile: ManagerProfile | null;
}): Promise<void> {
  const { data, uid, email, profile } = args;
  const initials = profile?.initials || email.slice(0, 2).toUpperCase();
  const ownerName = profile?.name || email;
  const fullData: LogData = { ...data, [MANAGER_COLUMN]: initials };
  const organizationName = fullData[ORGANIZATION_COLUMN]?.trim();

  if (!organizationName) {
    throw new Error("Organization is required.");
  }

  const { error } = await getSupabase().from("outreach_logs").insert({
    organization_name: organizationName,
    data: fullData,
    owner_uid: uid,
    owner_email: email,
    owner_name: ownerName,
  });
  if (error) {
    if (error.code === "23505") {
      throw new Error(
        "This organization has already been entered by another team member.",
      );
    }
    throw error;
  }

  try {
    await submitToGoogleSheets(fullData);
  } catch (sheetError) {
    console.error("Google Sheets mirror failed", sheetError);
  }
}

function mapRow(row: LogRow): OutreachLog {
  return {
    id: row.id,
    data: {
      ...(row.data ?? {}),
      [ORGANIZATION_COLUMN]:
        row.data?.[ORGANIZATION_COLUMN] ?? row.organization_name,
    },
    ownerUid: row.owner_uid,
    ownerEmail: row.owner_email,
    ownerName: row.owner_name,
    createdAt: row.created_at ? new Date(row.created_at) : null,
  };
}

function sortByCreatedDesc(logs: OutreachLog[]) {
  return [...logs].sort(
    (a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0),
  );
}

export function subscribeLogs(
  scope: "own" | "all",
  uid: string,
  onData: (logs: OutreachLog[]) => void,
  onError?: (error: Error) => void,
): () => void {
  const supabase = getSupabase();
  let active = true;
  let current: OutreachLog[] = [];

  const emit = (rows: OutreachLog[]) => {
    current = sortByCreatedDesc(rows);
    onData(current);
  };

  const query = supabase
    .from("outreach_logs")
    .select(
      "id, organization_name, data, owner_uid, owner_email, owner_name, created_at",
    )
    .order("created_at", { ascending: false });

  const initialRequest =
    scope === "own" ? query.eq("owner_uid", uid) : query;

  void initialRequest.then(({ data, error }) => {
    if (!active) return;
    if (error) {
      onError?.(error);
      return;
    }
    emit(((data ?? []) as LogRow[]).map(mapRow));
  });

  const channelConfig = {
    event: "*" as const,
    schema: "public",
    table: "outreach_logs",
    ...(scope === "own" ? { filter: `owner_uid=eq.${uid}` } : {}),
  };

  const channel = supabase
    .channel(`outreach-logs-${scope}-${uid}`)
    .on(
      "postgres_changes",
      channelConfig,
      (payload: RealtimePostgresChangesPayload<LogRow>) => {
        if (!active) return;
        if (payload.eventType === "INSERT") {
          emit([mapRow(payload.new), ...current.filter((log) => log.id !== payload.new.id)]);
        } else if (payload.eventType === "UPDATE") {
          emit(
            current.map((log) =>
              log.id === payload.new.id ? mapRow(payload.new) : log,
            ),
          );
        } else if (payload.eventType === "DELETE") {
          emit(current.filter((log) => log.id !== payload.old.id));
        }
      },
    )
    .subscribe((status) => {
      if (status === "CHANNEL_ERROR") {
        onError?.(new Error("Could not connect to live log updates."));
      }
    });

  return () => {
    active = false;
    void supabase.removeChannel(channel);
  };
}
