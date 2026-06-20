"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Search } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
  addLog,
  LOG_COLUMNS,
  subscribeLogs,
  type LogData,
  type OutreachLog,
} from "@/lib/logs";
import { AppHeader } from "./AppHeader";

function isLongFormColumn(header: string) {
  return /note|summary|comment|detail|description/i.test(header);
}

function emptyEntry(): LogData {
  return LOG_COLUMNS.reduce<LogData>((acc, col) => {
    acc[col] = "";
    return acc;
  }, {});
}

function formatTime(value: Date | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}

export function ManagerDashboard() {
  const { user, profile } = useAuth();
  const [logs, setLogs] = useState<OutreachLog[]>([]);
  const [entry, setEntry] = useState<LogData>(emptyEntry);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    queueMicrotask(() => {
      if (active) setLoading(true);
    });
    const unsub = subscribeLogs(
      "own",
      user.id,
      (next) => {
        if (!active) return;
        setLogs(next);
        setLoading(false);
      },
      (err) => {
        if (!active) return;
        setError(err.message);
        setLoading(false);
      },
    );
    return () => {
      active = false;
      unsub();
    };
  }, [user]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter((log) =>
      Object.values(log.data).join(" ").toLowerCase().includes(q),
    );
  }, [logs, search]);

  function update(col: string, value: string) {
    setEntry((current) => ({ ...current, [col]: value }));
    setError(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;

    if (!entry["Church Name"]?.trim()) {
      setError("Church / organization name is required.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await addLog({
        data: entry,
        uid: user.id,
        email: user.email ?? "",
        profile,
      });
      const label = entry["Church Name"];
      setEntry(emptyEntry());
      setSuccess(`${label} logged.`);
      window.setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the log.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="ops-bg min-h-screen px-4 py-8 text-cream sm:px-6">
      <div className="pointer-events-none fixed inset-0 grid-overlay opacity-60" />
      <div className="relative mx-auto max-w-5xl space-y-6">
        <AppHeader subtitle="Log your partner conversations. You only see the entries you create." />

        <section className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <form
            onSubmit={handleSubmit}
            className="rounded-3xl border border-line bg-panel/90 p-5"
          >
            <div className="mb-5">
              <h2 className="text-xl font-semibold">Log outreach</h2>
              <p className="mt-1 text-sm text-cream-muted">
                Logged as {profile?.initials || user?.email}.
              </p>
            </div>

            <div className="space-y-4">
              {LOG_COLUMNS.map((col) =>
                isLongFormColumn(col) ? (
                  <textarea
                    key={col}
                    className="field min-h-28"
                    value={entry[col] ?? ""}
                    onChange={(event) => update(col, event.target.value)}
                    placeholder={col}
                  />
                ) : (
                  <input
                    key={col}
                    className="field"
                    value={entry[col] ?? ""}
                    onChange={(event) => update(col, event.target.value)}
                    placeholder={col}
                  />
                ),
              )}
            </div>

            {error ? <p className="mt-4 text-sm text-red-300">{error}</p> : null}
            {success ? (
              <p className="mt-4 rounded-2xl border border-green-bright/30 bg-green-bright/10 px-4 py-3 text-sm text-green-bright">
                {success}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-gold px-5 py-3 text-sm font-semibold text-ink disabled:opacity-50"
            >
              <Plus size={17} />
              {submitting ? "Saving…" : "Add log"}
            </button>
          </form>

          <section className="rounded-3xl border border-line bg-panel/90 p-5">
            <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold">My logs</h2>
                <p className="mt-1 text-sm text-cream-muted">
                  {filtered.length} {filtered.length === 1 ? "entry" : "entries"}
                </p>
              </div>
              <label className="relative block">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-cream-muted"
                  size={17}
                />
                <input
                  className="field w-full sm:w-56"
                  style={{ paddingLeft: "2.6rem" }}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search"
                />
              </label>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-xs uppercase tracking-[0.16em] text-cream-muted">
                  <tr className="border-b border-line">
                    {LOG_COLUMNS.map((col) => (
                      <th key={col} className="py-3 pr-4 font-medium">
                        {col}
                      </th>
                    ))}
                    <th className="py-3 font-medium">Logged</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((log) => (
                    <tr key={log.id} className="border-b border-line/70 align-top">
                      {LOG_COLUMNS.map((col, index) => (
                        <td
                          key={col}
                          className={
                            index === 0
                              ? "py-4 pr-4 font-medium text-cream"
                              : "max-w-xs py-4 pr-4 text-cream-muted"
                          }
                        >
                          {isLongFormColumn(col) ? (
                            <span className="line-clamp-2">
                              {log.data[col] || "—"}
                            </span>
                          ) : (
                            log.data[col] || "—"
                          )}
                        </td>
                      ))}
                      <td className="py-4 text-gold">{formatTime(log.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 ? (
                <div className="py-14 text-center text-sm text-cream-muted">
                  {loading ? "Loading your logs…" : "No logs yet. Add your first above."}
                </div>
              ) : null}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
