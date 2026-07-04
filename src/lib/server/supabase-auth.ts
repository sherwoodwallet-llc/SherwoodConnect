import "server-only";

import { createClient, type User } from "@supabase/supabase-js";
import { isMasterEmail } from "../master-access";

export class AuthError extends Error {
  constructor(
    message: string,
    public status = 401,
  ) {
    super(message);
  }
}

function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const [scheme, token] = authorization.split(" ");
  if (scheme !== "Bearer" || !token) {
    throw new AuthError("Sign in is required.");
  }
  return token;
}

export async function requireSupabaseUser(request: Request): Promise<User> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new AuthError("Supabase is not configured.", 503);
  }

  const token = getBearerToken(request);
  const client = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) {
    throw new AuthError("Your session is no longer valid.");
  }
  return data.user;
}

export function requireMasterUser(user: User) {
  if (!isMasterEmail(user.email)) {
    throw new AuthError("Master access is required.", 403);
  }
}
