import "server-only";

import type { DecodedIdToken } from "firebase-admin/auth";
import { getFirebaseAdminAuth } from "./firebase-admin";

export class AuthError extends Error {
  status = 401;
}

export async function requireFirebaseUser(
  request: Request,
): Promise<DecodedIdToken> {
  const authorization = request.headers.get("authorization") ?? "";
  const [scheme, token] = authorization.split(" ");

  if (scheme !== "Bearer" || !token) {
    throw new AuthError("Missing Firebase ID token.");
  }

  try {
    return await getFirebaseAdminAuth().verifyIdToken(token);
  } catch {
    throw new AuthError("Invalid Firebase ID token.");
  }
}
