import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { normalizeManagerProfile, type ManagerProfile } from "@/lib/profile";
import { getFirebaseAdminDb } from "@/lib/server/firebase-admin";
import { AuthError, requireFirebaseUser } from "@/lib/server/request-auth";
import {
  getCachedManagerProfile,
  setCachedManagerProfile,
} from "@/lib/server/redis";

type ProfileBody = {
  name?: unknown;
  initials?: unknown;
};

function jsonError(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  }

  console.error("Profile API failed", error);
  return NextResponse.json(
    { ok: false, error: "Profile service unavailable" },
    { status: 500 },
  );
}

function validateProfileBody(body: ProfileBody, email: string): ManagerProfile {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const initials =
    typeof body.initials === "string" ? body.initials.trim().toUpperCase() : "";

  if (!name || !initials) {
    throw new Error("Name and initials are required.");
  }

  return { email, name, initials };
}

export async function GET(request: Request) {
  try {
    const decoded = await requireFirebaseUser(request);
    const cached = await getCachedManagerProfile(decoded.uid);
    if (cached) {
      return NextResponse.json({ ok: true, cached: true, profile: cached });
    }

    const snap = await getFirebaseAdminDb()
      .collection("managers")
      .doc(decoded.uid)
      .get();

    if (!snap.exists) {
      return NextResponse.json({ ok: true, cached: false, profile: null });
    }

    const profile = normalizeManagerProfile(
      snap.data() as Partial<ManagerProfile>,
      decoded.email ?? "",
    );
    await setCachedManagerProfile(decoded.uid, profile);

    return NextResponse.json({ ok: true, cached: false, profile });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const decoded = await requireFirebaseUser(request);
    const body = (await request.json()) as ProfileBody;
    const profile = validateProfileBody(body, decoded.email ?? "");

    await getFirebaseAdminDb()
      .collection("managers")
      .doc(decoded.uid)
      .set(
        {
          ...profile,
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

    await setCachedManagerProfile(decoded.uid, profile);

    return NextResponse.json({ ok: true, profile });
  } catch (error) {
    if (error instanceof Error && error.message === "Name and initials are required.") {
      return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
    }

    return jsonError(error);
  }
}
