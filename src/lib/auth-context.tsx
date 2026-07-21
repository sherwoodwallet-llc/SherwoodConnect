"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { EmailOtpType, User } from "@supabase/supabase-js";
import {
  getSupabase,
  isSupabaseConfigured,
  isMasterEmail,
} from "./supabase";
import type { ManagerProfile } from "./profile";

export type { ManagerProfile } from "./profile";

type AuthContextValue = {
  configured: boolean;
  loading: boolean;
  profileLoading: boolean;
  user: User | null;
  isMaster: boolean;
  profile: ManagerProfile | null;
  needsProfile: boolean;
  linkSent: boolean;
  emailLinkInUrl: boolean;
  pendingEmail: string;
  error: string | null;
  sendLink: (email: string) => Promise<void>;
  completeLink: () => Promise<boolean>;
  saveProfile: (name: string, initials: string) => Promise<void>;
  resetLogin: () => void;
  refreshSession: (options?: { silent?: boolean }) => Promise<boolean>;
  signOutUser: () => Promise<void>;
};

const STORAGE_EMAIL_KEY = "sherwood:pendingEmail";
const PROFILE_CACHE_PREFIX = "sherwood:managerProfile:";
const PRODUCTION_AUTH_REDIRECT_ORIGIN = "https://sherwood-connect.vercel.app";
const PROFILE_LOAD_TIMEOUT_MS = 5000;

const AuthContext = createContext<AuthContextValue | null>(null);

function getStoredPendingEmail() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(STORAGE_EMAIL_KEY) ?? "";
}

function profileCacheKey(uid: string) {
  return `${PROFILE_CACHE_PREFIX}${uid}`;
}

function getCachedProfile(uid: string): ManagerProfile | null {
  if (typeof window === "undefined") return null;

  try {
    const cached = window.localStorage.getItem(profileCacheKey(uid));
    if (!cached) return null;
    const profile = JSON.parse(cached) as Partial<ManagerProfile>;
    if (!profile.email || !profile.name || !profile.initials) return null;
    return {
      email: profile.email,
      name: profile.name,
      initials: profile.initials,
    };
  } catch {
    return null;
  }
}

function setCachedProfile(uid: string, profile: ManagerProfile) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(profileCacheKey(uid), JSON.stringify(profile));
  } catch {
    // This cache is optional.
  }
}

function hasAuthCallbackParams() {
  if (typeof window === "undefined") return false;
  const url = new URL(window.location.href);
  return (
    url.searchParams.has("code") ||
    url.searchParams.has("token_hash") ||
    url.hash.includes("access_token=")
  );
}

function clearAuthUrl() {
  if (typeof window === "undefined") return;
  window.history.replaceState({}, document.title, window.location.pathname);
}

function getAuthRedirectUrl() {
  if (typeof window === "undefined") return PRODUCTION_AUTH_REDIRECT_ORIGIN;
  const configured =
    process.env.NEXT_PUBLIC_AUTH_REDIRECT_ORIGIN?.trim().replace(/\/+$/, "");
  return configured || window.location.origin;
}

async function readManagerProfile(user: User): Promise<ManagerProfile | null> {
  const { data, error } = await getSupabase()
    .from("manager_profiles")
    .select("email, name, initials")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return {
    email: data.email || user.email || "",
    name: data.name || "",
    initials: data.initials || "",
  };
}

async function writeManagerProfile(
  user: User,
  payload: Pick<ManagerProfile, "name" | "initials">,
): Promise<ManagerProfile> {
  const profile: ManagerProfile = {
    email: user.email ?? "",
    ...payload,
  };
  const { error } = await getSupabase().from("manager_profiles").upsert(
    {
      user_id: user.id,
      email: profile.email,
      name: profile.name,
      initials: profile.initials,
    },
    { onConflict: "user_id" },
  );
  if (error) throw error;
  return profile;
}

function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = window.setTimeout(
      () => reject(new Error(message)),
      PROFILE_LOAD_TIMEOUT_MS,
    );
    promise.then(resolve, reject).finally(() => window.clearTimeout(id));
  });
}

const OTP_TYPES = new Set<EmailOtpType>([
  "email",
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
]);

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getFriendlyAuthError(message: string) {
  if (/signups? (is |are )?not allowed|signup.*disabled/i.test(message)) {
    return "New account signup is disabled in Supabase. Turn on email signups, then try this email again.";
  }
  return message;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const configured = isSupabaseConfigured;
  const [loading, setLoading] = useState(configured);
  const [profileLoading, setProfileLoading] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<ManagerProfile | null>(null);
  const [linkSent, setLinkSent] = useState(() =>
    Boolean(getStoredPendingEmail()),
  );
  const [emailLinkInUrl, setEmailLinkInUrl] = useState(hasAuthCallbackParams);
  const [pendingEmail, setPendingEmail] = useState(getStoredPendingEmail);
  const [error, setError] = useState<string | null>(null);

  const loadProfile = useCallback(async (current: User) => {
    setProfileLoading(true);
    const request = readManagerProfile(current);
    try {
      const next = await withTimeout(request, "Profile is taking too long to load.");
      setProfile(next);
      if (next) setCachedProfile(current.id, next);
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Could not load profile.",
      );
      request
        .then((next) => {
          setProfile(next);
          if (next) setCachedProfile(current.id, next);
          setError(null);
        })
        .catch(() => undefined);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  const acceptUser = useCallback(
    (next: User | null) => {
      setUser(next);
      setLoading(false);
      if (!next) {
        setProfile(null);
        setProfileLoading(false);
        return;
      }

      const cached = getCachedProfile(next.id);
      if (cached) setProfile(cached);
      setLinkSent(false);
      setEmailLinkInUrl(false);
      setPendingEmail("");
      window.localStorage.removeItem(STORAGE_EMAIL_KEY);
      void loadProfile(next);
    },
    [loadProfile],
  );

  const completeSignInFromUrl = useCallback(async () => {
    if (!configured || typeof window === "undefined") return false;
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const tokenHash = url.searchParams.get("token_hash");
    const rawType = url.searchParams.get("type");
    const supabase = getSupabase();

    try {
      if (code) {
        const { error: exchangeError } =
          await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) throw exchangeError;
      } else if (tokenHash && rawType && OTP_TYPES.has(rawType as EmailOtpType)) {
        const { error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: rawType as EmailOtpType,
        });
        if (verifyError) throw verifyError;
      }

      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!data.session?.user) return false;

      clearAuthUrl();
      acceptUser(data.session.user);
      return true;
    } catch (signInError) {
      setError(
        signInError instanceof Error
          ? signInError.message
          : "Could not complete sign-in.",
      );
      setLoading(false);
      return false;
    }
  }, [acceptUser, configured]);

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    const supabase = getSupabase();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return;
      queueMicrotask(() => acceptUser(session?.user ?? null));
    });

    queueMicrotask(async () => {
      if (hasAuthCallbackParams()) {
        setEmailLinkInUrl(true);
        const completed = await completeSignInFromUrl();
        if (completed || cancelled) return;
      }

      const { data, error: sessionError } = await supabase.auth.getSession();
      if (cancelled) return;
      if (sessionError) setError(sessionError.message);
      acceptUser(data.session?.user ?? null);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [acceptUser, completeSignInFromUrl, configured]);

  const sendLink = useCallback(async (email: string) => {
    setError(null);
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      setError("Enter your email.");
      return;
    }
    if (!isValidEmail(trimmed)) {
      setError("Enter a valid email address.");
      return;
    }

    const { error: signInError } = await getSupabase().auth.signInWithOtp({
      email: trimmed,
      options: {
        emailRedirectTo: getAuthRedirectUrl(),
        shouldCreateUser: true,
      },
    });

    if (signInError) {
      setError(getFriendlyAuthError(signInError.message));
      return;
    }

    window.localStorage.setItem(STORAGE_EMAIL_KEY, trimmed);
    setPendingEmail(trimmed);
    setLinkSent(true);
  }, []);

  const completeLink = useCallback(
    async () => {
      setError(null);
      const completed = await completeSignInFromUrl();
      if (!completed) {
        setError((current) =>
          current ||
          "This sign-in link is no longer valid. Request a new link and try again.",
        );
      }
      return completed;
    },
    [completeSignInFromUrl],
  );

  const saveProfile = useCallback(
    async (name: string, initials: string) => {
      if (!user) throw new Error("You are not signed in.");
      const payload = {
        name: name.trim(),
        initials: initials.trim().toUpperCase(),
      };
      const next = await writeManagerProfile(user, payload);
      setProfile(next);
      setCachedProfile(user.id, next);
      setError(null);
    },
    [user],
  );

  const resetLogin = useCallback(() => {
    setLinkSent(false);
    setEmailLinkInUrl(false);
    setPendingEmail("");
    setError(null);
    window.localStorage.removeItem(STORAGE_EMAIL_KEY);
    clearAuthUrl();
  }, []);

  const refreshSession = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) setError(null);
      const completed = await completeSignInFromUrl();
      if (completed) return true;

      const { data, error: sessionError } = await getSupabase().auth.getSession();
      if (data.session?.user) {
        acceptUser(data.session.user);
        return true;
      }
      if (!options?.silent) {
        setError(
          sessionError?.message ||
            "Not signed in yet. Open the link in your email, then try again.",
        );
      }
      return false;
    },
    [acceptUser, completeSignInFromUrl],
  );

  const signOutUser = useCallback(async () => {
    const { error: signOutError } = await getSupabase().auth.signOut();
    if (signOutError) throw signOutError;
    setUser(null);
    setProfile(null);
    setLinkSent(false);
    setPendingEmail("");
    window.localStorage.removeItem(STORAGE_EMAIL_KEY);
  }, []);

  const isMaster = isMasterEmail(user?.email);
  const needsProfile = Boolean(
    user && !isMaster && (!profile || !profile.name || !profile.initials),
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      configured,
      loading,
      profileLoading,
      user,
      isMaster,
      profile,
      needsProfile,
      linkSent,
      emailLinkInUrl,
      pendingEmail,
      error,
      sendLink,
      completeLink,
      saveProfile,
      resetLogin,
      refreshSession,
      signOutUser,
    }),
    [
      configured,
      loading,
      profileLoading,
      user,
      isMaster,
      profile,
      needsProfile,
      linkSent,
      emailLinkInUrl,
      pendingEmail,
      error,
      sendLink,
      completeLink,
      saveProfile,
      resetLogin,
      refreshSession,
      signOutUser,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
