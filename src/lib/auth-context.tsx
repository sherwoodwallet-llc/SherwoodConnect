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
import {
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signOut,
  type User,
} from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import {
  getDb,
  getFirebaseAuth,
  isFirebaseConfigured,
  MASTER_EMAIL,
} from "./firebase";

export type ManagerProfile = {
  email: string;
  name: string;
  initials: string;
};

type AuthContextValue = {
  configured: boolean;
  loading: boolean;
  user: User | null;
  isMaster: boolean;
  profile: ManagerProfile | null;
  needsProfile: boolean;
  linkSent: boolean;
  emailLinkInUrl: boolean;
  pendingEmail: string;
  error: string | null;
  sendLink: (email: string) => Promise<void>;
  completeLink: (email: string) => Promise<boolean>;
  saveProfile: (name: string, initials: string) => Promise<void>;
  resetLogin: () => void;
  refreshSession: (options?: { silent?: boolean }) => Promise<boolean>;
  signOutUser: () => Promise<void>;
};

const STORAGE_EMAIL_KEY = "sherwood:pendingEmail";
const PRODUCTION_AUTH_REDIRECT_ORIGIN = "https://sherwood-connect.vercel.app";

const AuthContext = createContext<AuthContextValue | null>(null);

function getStoredPendingEmail() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(STORAGE_EMAIL_KEY) ?? "";
}

function hasEmailLinkParams() {
  if (typeof window === "undefined") return false;
  const params = new URL(window.location.href).searchParams;
  return params.get("mode") === "signIn" && params.has("oobCode");
}

function getAuthRedirectOrigin() {
  if (typeof window === "undefined") return PRODUCTION_AUTH_REDIRECT_ORIGIN;

  const configuredOrigin =
    process.env.NEXT_PUBLIC_AUTH_REDIRECT_ORIGIN?.trim().replace(/\/+$/, "");
  if (configuredOrigin) return configuredOrigin;

  const productionHostname = new URL(PRODUCTION_AUTH_REDIRECT_ORIGIN).hostname;
  if (
    window.location.hostname.endsWith(".vercel.app") &&
    window.location.hostname !== productionHostname
  ) {
    return PRODUCTION_AUTH_REDIRECT_ORIGIN;
  }

  return window.location.origin;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const configured = isFirebaseConfigured;

  const [loading, setLoading] = useState(configured);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<ManagerProfile | null>(null);
  const [linkSent, setLinkSent] = useState(() =>
    Boolean(getStoredPendingEmail()),
  );
  const [emailLinkInUrl, setEmailLinkInUrl] = useState(hasEmailLinkParams);
  const [pendingEmail, setPendingEmail] = useState(getStoredPendingEmail);
  const [error, setError] = useState<string | null>(null);

  const readPendingEmail = useCallback(() => {
    return getStoredPendingEmail();
  }, []);

  const clearSignInUrl = useCallback(() => {
    if (typeof window === "undefined") return;
    window.history.replaceState({}, document.title, window.location.pathname);
  }, []);

  const loadProfile = useCallback(async (current: User) => {
    try {
      const ref = doc(getDb(), "managers", current.uid);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data() as Partial<ManagerProfile>;
        setProfile({
          email: data.email ?? current.email ?? "",
          name: data.name ?? "",
          initials: data.initials ?? "",
        });
      } else {
        setProfile(null);
      }
    } catch {
      // Firestore may not be ready yet; treat as a new user needing profile setup.
      setProfile(null);
    }
  }, []);

  // Complete a magic-link sign-in if the user arrived from their email.
  const completeSignInFromUrl = useCallback(
    async (emailOverride?: string) => {
      if (!configured) return false;
      const auth = getFirebaseAuth();
      if (typeof window === "undefined") return false;
      const isEmailLink = isSignInWithEmailLink(auth, window.location.href);
      setEmailLinkInUrl(isEmailLink || hasEmailLinkParams());
      if (!isEmailLink) return false;

      const email = (emailOverride || readPendingEmail()).trim().toLowerCase();
      if (!email) return false;

      try {
        await signInWithEmailLink(auth, email, window.location.href);
        window.localStorage.removeItem(STORAGE_EMAIL_KEY);
        setPendingEmail("");
        setLinkSent(false);
        setEmailLinkInUrl(false);
        clearSignInUrl();
        return true;
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Could not complete sign-in.",
        );
        return false;
      }
    },
    [clearSignInUrl, configured, readPendingEmail],
  );

  useEffect(() => {
    if (!configured) {
      return;
    }

    const storedEmail = readPendingEmail();

    const auth = getFirebaseAuth();
    let cancelled = false;
    let unsub: (() => void) | undefined;

    queueMicrotask(() => {
      completeSignInFromUrl(storedEmail || undefined).finally(() => {
        if (cancelled) return;
        unsub = onAuthStateChanged(auth, async (next) => {
          setUser(next);
          try {
            if (next) {
              await loadProfile(next);
              setLinkSent(false);
              setEmailLinkInUrl(false);
              setPendingEmail("");
              window.localStorage.removeItem(STORAGE_EMAIL_KEY);
            } else {
              setProfile(null);
            }
          } finally {
            setLoading(false);
          }
        });
      });
    });

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [configured, completeSignInFromUrl, loadProfile, readPendingEmail]);

  const sendLink = useCallback(
    async (email: string) => {
      setError(null);
      const trimmed = email.trim().toLowerCase();
      if (!trimmed) {
        setError("Enter your email.");
        return;
      }
      try {
        const auth = getFirebaseAuth();
        await sendSignInLinkToEmail(auth, trimmed, {
          url: getAuthRedirectOrigin(),
          handleCodeInApp: true,
        });
        window.localStorage.setItem(STORAGE_EMAIL_KEY, trimmed);
        setPendingEmail(trimmed);
        setLinkSent(true);
      } catch (err) {
        const code =
          err && typeof err === "object" && "code" in err
            ? String((err as { code: string }).code)
            : "";
        if (code === "auth/configuration-not-found") {
          setError(
            "Email link sign-in is not enabled yet. In Firebase console: Authentication → Sign-in method → Email/Password → enable it, then turn on Email link (passwordless sign-in).",
          );
        } else {
          setError(
            err instanceof Error ? err.message : "Could not send the sign-in link.",
          );
        }
      }
    },
    [],
  );

  const completeLink = useCallback(
    async (email: string) => {
      setError(null);
      const trimmed = email.trim().toLowerCase();
      if (!trimmed) {
        setError("Enter the email address that received this sign-in link.");
        return false;
      }

      const completed = await completeSignInFromUrl(trimmed);
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
      if (!user) return;
      const ref = doc(getDb(), "managers", user.uid);
      const payload: ManagerProfile = {
        email: user.email ?? "",
        name: name.trim(),
        initials: initials.trim().toUpperCase(),
      };
      await setDoc(
        ref,
        { ...payload, createdAt: serverTimestamp() },
        { merge: true },
      );
      setProfile(payload);
    },
    [user],
  );

  const resetLogin = useCallback(() => {
    setLinkSent(false);
    setEmailLinkInUrl(false);
    setPendingEmail("");
    setError(null);
    window.localStorage.removeItem(STORAGE_EMAIL_KEY);
    clearSignInUrl();
  }, [clearSignInUrl]);

  const refreshSession = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) setError(null);
      const auth = getFirebaseAuth();

      const completed = await completeSignInFromUrl(
        pendingEmail || readPendingEmail(),
      );
      if (completed && auth.currentUser) return true;

      const current = auth.currentUser;
      if (current) {
        setUser(current);
        await loadProfile(current);
        setLinkSent(false);
        setEmailLinkInUrl(false);
        setPendingEmail("");
        window.localStorage.removeItem(STORAGE_EMAIL_KEY);
        return true;
      }

      if (!options?.silent) {
        setError(
          "Not signed in yet. Open the link in your email on this device, then try again.",
        );
      }
      return false;
    },
    [completeSignInFromUrl, loadProfile, pendingEmail, readPendingEmail],
  );

  const signOutUser = useCallback(async () => {
    await signOut(getFirebaseAuth());
    setProfile(null);
    setLinkSent(false);
    setPendingEmail("");
    window.localStorage.removeItem(STORAGE_EMAIL_KEY);
  }, []);

  const isMaster = Boolean(
    user?.email && user.email.toLowerCase() === MASTER_EMAIL.toLowerCase(),
  );

  const needsProfile = Boolean(
    user && !isMaster && (!profile || !profile.name || !profile.initials),
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      configured,
      loading,
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
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
