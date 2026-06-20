"use client";

import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { fetchSheetData, type SheetRow } from "@/lib/googleSheets";
import {
  MANAGER_COLUMN,
  subscribeLogs,
  type OutreachLog,
} from "@/lib/logs";
import { AppHeader } from "./AppHeader";

const POLL_INTERVAL_MS = 15_000;

function isLongFormColumn(header: string) {
  return /note|summary|comment|detail|description/i.test(header);
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

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-2xl border border-line bg-cream/[0.04] p-4">
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-xs text-cream-muted">{label}</p>
    </div>
  );
}

export function MasterDashboard() {
  const { user } = useAuth();
  const [logs, setLogs] = useState<OutreachLog[]>([]);
  const [logSearch, setLogSearch] = useState("");
  const [logsLoading, setLogsLoading] = useState(true);

  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<SheetRow[]>([]);
  const [sheetLoading, setSheetLoading] = useState(true);
  const [sheetSearch, setSheetSearch] = useState("");

  // All managers' logs (master can read everything per security rules).
  useEffect(() => {
    if (!user) return;
    const unsub = subscribeLogs(
      "all",
      user.id,
      (next) => {
        setLogs(next);
        setLogsLoading(false);
      },
      () => setLogsLoading(false),
    );
    return () => unsub();
  }, [user]);

  // Church pipeline snapshot from the Google Sheet.
  async function loadSheet(showSpinner = false) {
    if (showSpinner) setSheetLoading(true);
    try {
      const data = await fetchSheetData();
      if (data.headers.length) setHeaders(data.headers);
      setRows(data.rows);
    } finally {
      if (showSpinner) setSheetLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void loadSheet(true);
    });
    const id = window.setInterval(() => loadSheet(false), POLL_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  const filteredLogs = useMemo(() => {
    const q = logSearch.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter((log) =>
      [...Object.values(log.data), log.ownerName, log.ownerEmail]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [logs, logSearch]);

  const filteredRows = useMemo(() => {
    const q = sheetSearch.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      Object.values(row).join(" ").toLowerCase().includes(q),
    );
  }, [rows, sheetSearch]);

  const metrics = useMemo(() => {
    const managers = new Set(logs.map((log) => log.ownerEmail));
    const meetings = logs.filter((log) =>
      /^(yes|true|booked|✓)/i.test((log.data["Meeting Booked"] || "").trim()),
    ).length;
    return {
      totalLogs: logs.length,
      managers: managers.size,
      meetings,
      prospects: rows.length,
    };
  }, [logs, rows]);

  const logColumns = useMemo(() => {
    const cols = new Set<string>();
    logs.forEach((log) =>
      Object.keys(log.data).forEach((key) => {
        if (key !== MANAGER_COLUMN) cols.add(key);
      }),
    );
    return Array.from(cols);
  }, [logs]);

  return (
    <main className="ops-bg min-h-screen px-4 py-8 text-cream sm:px-6">
      <div className="pointer-events-none fixed inset-0 grid-overlay opacity-60" />
      <div className="relative mx-auto max-w-6xl space-y-6">
        <AppHeader subtitle="Master view: every manager's logs, the live church pipeline, and team metrics." />

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric value={metrics.totalLogs} label="Total logs" />
          <Metric value={metrics.managers} label="Active managers" />
          <Metric value={metrics.meetings} label="Meetings booked" />
          <Metric value={metrics.prospects} label="Church prospects" />
        </section>

        <section className="rounded-3xl border border-line bg-panel/90 p-5">
          <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold">All manager logs</h2>
              <p className="mt-1 text-sm text-cream-muted">
                {filteredLogs.length} {filteredLogs.length === 1 ? "entry" : "entries"} across the team
              </p>
            </div>
            <label className="relative block">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-cream-muted"
                size={17}
              />
              <input
                className="field w-full sm:w-64"
                style={{ paddingLeft: "2.6rem" }}
                value={logSearch}
                onChange={(event) => setLogSearch(event.target.value)}
                placeholder="Search logs or managers"
              />
            </label>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-xs uppercase tracking-[0.16em] text-cream-muted">
                <tr className="border-b border-line">
                  <th className="py-3 pr-4 font-medium">Manager</th>
                  {logColumns.map((col) => (
                    <th key={col} className="py-3 pr-4 font-medium">
                      {col}
                    </th>
                  ))}
                  <th className="py-3 font-medium">Logged</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log) => (
                  <tr key={log.id} className="border-b border-line/70 align-top">
                    <td className="py-4 pr-4 font-medium text-cream">
                      <span className="block">{log.ownerName || "—"}</span>
                      <span className="block text-xs text-cream-muted">
                        {log.data[MANAGER_COLUMN] || log.ownerEmail}
                      </span>
                    </td>
                    {logColumns.map((col) => (
                      <td key={col} className="max-w-xs py-4 pr-4 text-cream-muted">
                        {isLongFormColumn(col) ? (
                          <span className="line-clamp-2">{log.data[col] || "—"}</span>
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
            {filteredLogs.length === 0 ? (
              <div className="py-14 text-center text-sm text-cream-muted">
                {logsLoading ? "Loading team logs…" : "No manager logs yet."}
              </div>
            ) : null}
          </div>
        </section>

        <section className="rounded-3xl border border-line bg-panel/90 p-5">
          <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold">Church pipeline</h2>
              <p className="mt-1 text-sm text-cream-muted">
                {filteredRows.length} from the team spreadsheet
              </p>
            </div>
            <div className="flex items-center gap-2">
              <label className="relative block">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-cream-muted"
                  size={17}
                />
                <input
                  className="field w-full sm:w-56"
                  style={{ paddingLeft: "2.6rem" }}
                  value={sheetSearch}
                  onChange={(event) => setSheetSearch(event.target.value)}
                  placeholder="Search"
                />
              </label>
              <button
                type="button"
                onClick={() => loadSheet(true)}
                className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-full border border-line text-cream-muted transition-colors hover:text-cream"
                aria-label="Refresh"
              >
                <RefreshCw size={17} className={sheetLoading ? "animate-spin" : ""} />
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            {headers.length === 0 ? (
              <div className="py-14 text-center text-sm text-cream-muted">
                {sheetLoading ? "Loading pipeline…" : "No pipeline columns yet."}
              </div>
            ) : (
              <>
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="text-xs uppercase tracking-[0.16em] text-cream-muted">
                    <tr className="border-b border-line">
                      {headers.map((header) => (
                        <th key={header} className="py-3 pr-4 font-medium">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((row, index) => (
                      <tr key={index} className="border-b border-line/70 align-top">
                        {headers.map((header, columnIndex) => (
                          <td
                            key={header}
                            className={
                              columnIndex === 0
                                ? "py-4 pr-4 font-medium text-cream"
                                : "max-w-xs py-4 pr-4 text-cream-muted"
                            }
                          >
                            {isLongFormColumn(header) ? (
                              <span className="line-clamp-2">{row[header] || "—"}</span>
                            ) : (
                              row[header] || "—"
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredRows.length === 0 ? (
                  <div className="py-14 text-center text-sm text-cream-muted">
                    {sheetLoading ? "Loading pipeline…" : "No rows yet."}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
