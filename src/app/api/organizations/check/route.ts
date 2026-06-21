import { NextResponse } from "next/server";
import { SEED_ROWS } from "@/data/churchSeed";
import {
  AuthError,
  requireSupabaseUser,
} from "@/lib/server/supabase-auth";

const WEBHOOK_URL =
  process.env.GOOGLE_APPS_SCRIPT_WEBHOOK_URL ||
  "PASTE_GOOGLE_APPS_SCRIPT_WEBHOOK_URL_HERE";
const sheetConfigured =
  WEBHOOK_URL !== "PASTE_GOOGLE_APPS_SCRIPT_WEBHOOK_URL_HERE";

const ORGANIZATION_KEYS = [
  "Organization",
  "Church Name",
  "Church / Organization",
] as const;

type SheetRow = Record<string, string>;

function normalizeOrganization(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function getOrganizationName(row: SheetRow) {
  for (const key of ORGANIZATION_KEYS) {
    const value = row[key]?.trim();
    if (value) return value;
  }
  return "";
}

async function getMasterSheetRows(): Promise<SheetRow[]> {
  if (!sheetConfigured) return SEED_ROWS;

  const response = await fetch(WEBHOOK_URL, {
    method: "GET",
    redirect: "follow",
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Master spreadsheet is unavailable.");

  const data = (await response.json()) as {
    ok?: boolean;
    rows?: SheetRow[];
  };
  if (!data.ok) throw new Error("Master spreadsheet is unavailable.");
  return data.rows ?? [];
}

export async function POST(request: Request) {
  try {
    await requireSupabaseUser(request);
    const body = (await request.json()) as { organization?: unknown };
    const organization =
      typeof body.organization === "string" ? body.organization.trim() : "";
    const normalized = normalizeOrganization(organization);
    if (!normalized) {
      return NextResponse.json(
        { ok: false, error: "Enter an organization name." },
        { status: 400 },
      );
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key =
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const authorization = request.headers.get("authorization") ?? "";
    if (!url || !key) throw new Error("Supabase is not configured.");

    const databaseResponse = await fetch(
      `${url}/rest/v1/rpc/organization_is_available`,
      {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: authorization,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ organization }),
        cache: "no-store",
      },
    );
    if (!databaseResponse.ok) {
      throw new Error("The organization checker is not configured yet.");
    }

    const databaseAvailable = (await databaseResponse.json()) === true;
    if (!databaseAvailable) {
      return NextResponse.json({ ok: true, available: false });
    }

    const rows = await getMasterSheetRows();
    const spreadsheetMatch = rows.some(
      (row) => normalizeOrganization(getOrganizationName(row)) === normalized,
    );

    return NextResponse.json({
      ok: true,
      available: !spreadsheetMatch,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: error.status },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not check the organization.",
      },
      { status: 503 },
    );
  }
}
