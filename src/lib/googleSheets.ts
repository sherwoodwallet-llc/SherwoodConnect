import { getSupabase } from "./supabase";

export type SheetRow = Record<string, string>;

export type SheetData = {
  ok: boolean;
  configured: boolean;
  headers: string[];
  rows: SheetRow[];
  error?: string;
};

// READ the current sheet contents (headers + rows) through our API proxy.
export async function fetchSheetData(): Promise<SheetData> {
  const {
    data: { session },
  } = await getSupabase().auth.getSession();
  const response = await fetch("/api/google-sheets", {
    cache: "no-store",
    headers: session
      ? { Authorization: `Bearer ${session.access_token}` }
      : undefined,
  });
  const data = (await response.json()) as Partial<SheetData>;

  return {
    ok: Boolean(data.ok),
    configured: Boolean(data.configured),
    headers: data.headers ?? [],
    rows: data.rows ?? [],
    error: data.error,
  };
}

// WRITE a new entry (keyed by header) to the sheet.
export async function submitToGoogleSheets(
  entry: SheetRow,
): Promise<{ ok: boolean; configured: boolean }> {
  const {
    data: { session },
  } = await getSupabase().auth.getSession();
  const response = await fetch("/api/google-sheets", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(session
        ? { Authorization: `Bearer ${session.access_token}` }
        : {}),
    },
    body: JSON.stringify({ entry }),
  });

  const data = (await response.json()) as { ok?: boolean; configured?: boolean };

  if (!response.ok) {
    throw new Error("Google Sheets sync failed");
  }

  return { ok: Boolean(data.ok), configured: Boolean(data.configured) };
}
