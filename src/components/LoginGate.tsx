"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Mail, RefreshCw, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="ops-bg flex min-h-screen items-center justify-center px-4 py-12 text-cream">
      <div className="pointer-events-none fixed inset-0 grid-overlay opacity-60" />
      <div className="relative w-full max-w-md rounded-3xl border border-line bg-panel/90 p-8">
        {children}
      </div>
    </main>
  );
}

function NotConfigured() {
  return (
    <Shell>
      <p className="text-xs uppercase tracking-[0.28em] text-gold">
        Sherwood internal
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">
        Sherwood Connect
      </h1>
      <h2 className="mt-6 text-lg font-semibold text-gold">Supabase not connected</h2>
      <p className="mt-2 text-sm leading-6 text-cream-muted">
        Add your Supabase project values (the{" "}
        <code className="rounded bg-cream/10 px-1.5 py-0.5 text-cream">
          NEXT_PUBLIC_SUPABASE_*
        </code>{" "}
        keys) to{" "}
        <code className="rounded bg-cream/10 px-1.5 py-0.5 text-cream">.env.local</code>{" "}
        and restart the dev server to enable manager logins.
      </p>
    </Shell>
  );
}

function ProfileSetup() {
  const { saveProfile, user, error: authError, profileLoading } = useAuth();
  const [name, setName] = useState("");
  const [initials, setInitials] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || !initials.trim()) {
      setError("Name and initials are required.");
      return;
    }
    setSaving(true);
    try {
      await saveProfile(name, initials);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save profile.");
      setSaving(false);
    }
  }

  return (
    <Shell>
      <p className="text-xs uppercase tracking-[0.28em] text-gold">
        Welcome
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">
        Set up your profile
      </h1>
      <p className="mt-2 text-sm leading-6 text-cream-muted">
        Signed in as {user?.email}. This labels the entries you log.
      </p>
      <form onSubmit={handleSave} className="mt-6 space-y-4">
        <input
          className="field"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Full name"
        />
        <input
          className="field"
          value={initials}
          onChange={(event) => setInitials(event.target.value)}
          placeholder="Initials (e.g. BG)"
          maxLength={4}
        />
        {profileLoading ? (
          <p className="text-sm text-cream-muted">
            Checking for an existing profile...
          </p>
        ) : null}
        {error || authError ? (
          <p className="text-sm text-red-300">{error || authError}</p>
        ) : null}
        <button
          type="submit"
          disabled={saving}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-gold px-5 py-3 text-sm font-semibold text-ink disabled:opacity-50"
        >
          {saving ? "Saving…" : "Continue"}
          <ArrowRight size={17} />
        </button>
      </form>
    </Shell>
  );
}

function EmailSentView() {
  const {
    pendingEmail,
    error,
    sendLink,
    resetLogin,
    refreshSession,
    user,
  } = useAuth();
  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);

  // Auto-detect when the user completes sign-in in another tab.
  useEffect(() => {
    if (user) return;
    const id = window.setInterval(() => {
      refreshSession({ silent: true }).catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(id);
  }, [user, refreshSession]);

  async function handleContinue() {
    setChecking(true);
    await refreshSession();
    setChecking(false);
  }

  async function handleResend() {
    if (!pendingEmail) return;
    setResending(true);
    await sendLink(pendingEmail);
    setResending(false);
  }

  return (
    <Shell>
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-green-bright/30 bg-green-bright/10 text-green-bright">
        <Mail size={22} />
      </div>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight">
        Check your email
      </h1>
      <p className="mt-2 text-sm leading-6 text-cream-muted">
        We sent a secure sign-in link to{" "}
        <span className="text-cream">{pendingEmail || "your email"}</span>.
        Open it on this device, then continue below.
      </p>

      <div className="mt-6 space-y-3">
        <button
          type="button"
          onClick={handleContinue}
          disabled={checking}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-gold px-5 py-3 text-sm font-semibold text-ink disabled:opacity-50"
        >
          {checking ? (
            <>
              <RefreshCw size={17} className="animate-spin" />
              Checking…
            </>
          ) : (
            <>
              Continue to login
              <ArrowRight size={17} />
            </>
          )}
        </button>

        <button
          type="button"
          onClick={handleResend}
          disabled={resending || !pendingEmail}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-line px-5 py-3 text-sm font-medium text-cream transition-colors hover:border-gold/40 disabled:opacity-50"
        >
          {resending ? "Sending…" : "Resend link"}
        </button>

        <button
          type="button"
          onClick={resetLogin}
          className="inline-flex w-full items-center justify-center rounded-full px-5 py-2 text-sm text-cream-muted transition-colors hover:text-cream"
        >
          Use a different email
        </button>
      </div>

      {error ? <p className="mt-4 text-sm text-red-300">{error}</p> : null}

      <p className="mt-6 text-xs leading-5 text-cream-muted">
        After you click the link in your email, come back here and press{" "}
        <span className="text-cream">Continue to login</span>. We also check
        automatically every few seconds.
      </p>
    </Shell>
  );
}

function CompleteEmailLinkView() {
  const { completeLink, error, resetLogin } = useAuth();
  const [checking, setChecking] = useState(false);

  async function handleContinue() {
    setChecking(true);
    await completeLink();
    setChecking(false);
  }

  return (
    <Shell>
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-green-bright/30 bg-green-bright/10 text-green-bright">
        <ShieldCheck size={22} />
      </div>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight">
        Complete login
      </h1>
      <p className="mt-2 text-sm leading-6 text-cream-muted">
        We are verifying your secure sign-in link. For security, open the link
        in the same browser where you requested it.
      </p>

      <div className="mt-6 space-y-4">
        {error ? <p className="text-sm text-red-300">{error}</p> : null}

        <button
          type="button"
          onClick={handleContinue}
          disabled={checking}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-gold px-5 py-3 text-sm font-semibold text-ink disabled:opacity-50"
        >
          {checking ? (
            <>
              <RefreshCw size={17} className="animate-spin" />
              Checking…
            </>
          ) : (
            <>
              Continue to login
              <ArrowRight size={17} />
            </>
          )}
        </button>

        <button
          type="button"
          onClick={resetLogin}
          className="inline-flex w-full items-center justify-center rounded-full px-5 py-2 text-sm text-cream-muted transition-colors hover:text-cream"
        >
          Back to login page
        </button>
      </div>
    </Shell>
  );
}

export function LoginGate() {
  const {
    configured,
    needsProfile,
    user,
    sendLink,
    linkSent,
    emailLinkInUrl,
    error,
  } = useAuth();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!configured) return <NotConfigured />;
  if (user && needsProfile) return <ProfileSetup />;
  if (!user && emailLinkInUrl) return <CompleteEmailLinkView />;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    await sendLink(email);
    setSubmitting(false);
  }

  if (!user && linkSent) return <EmailSentView />;

  return (
    <Shell>
      <p className="text-xs uppercase tracking-[0.28em] text-gold">
        Sherwood internal
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">
        Sherwood Connect
      </h1>
      <p className="mt-2 text-sm leading-6 text-cream-muted">
        Sign in to log your outreach. We will email you a secure one-time link.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
        <label className="relative block">
          <Mail
            className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-cream-muted"
            size={17}
          />
          <input
            className="field w-full"
            style={{ paddingLeft: "2.6rem" }}
            type="text"
            inputMode="email"
            value={email}
            onChange={(event) => setEmail(event.target.value.trimStart())}
            placeholder="you@example.com"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={Boolean(error)}
          />
        </label>
        {error ? <p className="text-sm text-red-300">{error}</p> : null}
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-gold px-5 py-3 text-sm font-semibold text-ink disabled:opacity-50"
        >
          {submitting ? "Sending…" : "Email me a sign-in link"}
          <ArrowRight size={17} />
        </button>
      </form>

      <p className="mt-6 flex items-center gap-2 text-xs text-cream-muted">
        <ShieldCheck size={14} className="text-gold" />
        Passwordless and encrypted. Your logs are private to you.
      </p>
    </Shell>
  );
}
