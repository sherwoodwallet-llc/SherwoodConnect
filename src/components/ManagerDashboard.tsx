"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Copy,
  MessageSquareReply,
  Plus,
  Save,
  Search,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
  addLog,
  checkOrganizationAvailability,
  DETAIL_COLUMNS,
  EMAIL_COLUMN,
  LOG_COLUMNS,
  MEETING_BOOKED_COLUMN,
  MEETING_BOOKED_OPTIONS,
  ORGANIZATION_COLUMN,
  subscribeLogs,
  type LogData,
  type OutreachLog,
} from "@/lib/logs";
import {
  ACTIVE_TASK_STATUSES,
  responseScoreLabels,
  responseStatusLabels,
  statusLabels,
  subscribeOutreachTasks,
  updateOutreachTask,
  type OutreachResponseStatus,
  type OutreachTask,
  type OutreachTaskStatus,
} from "@/lib/outreachTasks";
import { AppHeader } from "./AppHeader";

function isLongFormColumn(header: string) {
  return /note|summary|comment|detail|description/i.test(header);
}

function inputTypeForColumn(header: string) {
  return header === EMAIL_COLUMN ? "email" : "text";
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

function formatDateInput(value: Date | null) {
  if (!value) return "";
  return value.toISOString().slice(0, 10);
}

type ReplyForm = {
  responseStatus: OutreachResponseStatus;
  responseScore: string;
  responseReceivedAt: string;
  responseExcerpt: string;
  responseNotes: string;
};

function TaskStatusBadge({ status }: { status: OutreachTaskStatus }) {
  const classes =
    status === "sent"
      ? "border-green-bright/30 bg-green-bright/10 text-green-bright"
      : status === "needs_edit"
        ? "border-gold/30 bg-gold/10 text-gold"
        : status === "rejected"
          ? "border-red-300/30 bg-red-300/10 text-red-200"
          : "border-line bg-cream/[0.04] text-cream-muted";

  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs ${classes}`}>
      {statusLabels[status]}
    </span>
  );
}

function DraftTaskCard({
  task,
  notes,
  saving,
  onNotesChange,
  onCopy,
  onStatus,
  replyForm,
  onReplyChange,
  onSaveResponse,
}: {
  task: OutreachTask;
  notes: string;
  saving: boolean;
  onNotesChange: (value: string) => void;
  onCopy: () => void;
  onStatus: (status: OutreachTaskStatus) => void;
  replyForm?: ReplyForm;
  onReplyChange?: (patch: Partial<ReplyForm>) => void;
  onSaveResponse?: () => void;
}) {
  const canTrackResponse =
    task.status === "sent" && replyForm && onReplyChange && onSaveResponse;

  return (
    <article className="rounded-2xl border border-line bg-cream/[0.035] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold">{task.organizationName}</h3>
            <TaskStatusBadge status={task.status} />
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-cream-muted">
            <span>{task.organizationType || "Organization"}</span>
            {task.organizationWebsite ? (
              <a
                href={task.organizationWebsite}
                target="_blank"
                rel="noreferrer"
                className="text-gold transition-colors hover:text-cream"
              >
                Website
              </a>
            ) : null}
            <span>{formatTime(task.createdAt)}</span>
          </div>
        </div>
        <a
          href={`mailto:${task.contactEmail}`}
          className="text-sm text-gold transition-colors hover:text-cream"
        >
          {task.contactName ? `${task.contactName} · ` : ""}
          {task.contactEmail}
        </a>
      </div>

      {task.fitReason ? (
        <p className="mt-4 text-sm leading-6 text-cream-muted">{task.fitReason}</p>
      ) : null}

      <div className="mt-4 border-l border-gold/40 pl-4">
        <p className="text-sm font-medium">{task.draftSubject || "Draft email"}</p>
        <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-6 text-cream-muted">
          {task.draftEmail}
        </pre>
      </div>

      <textarea
        className="field mt-4 min-h-20"
        value={notes}
        onChange={(event) => onNotesChange(event.target.value)}
        placeholder="Manager notes"
      />

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onCopy}
          className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-sm text-cream-muted transition-colors hover:text-cream"
        >
          <Copy size={16} />
          Copy draft
        </button>
        {task.status !== "sent" ? (
          <>
            <button
              type="button"
              disabled={saving}
              onClick={() => onStatus("sent")}
              className="inline-flex items-center gap-2 rounded-full bg-gold px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50"
            >
              <CheckCircle2 size={16} />
              Mark sent
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => onStatus("needs_edit")}
              className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 text-sm text-cream-muted transition-colors hover:text-cream disabled:opacity-50"
            >
              <AlertTriangle size={16} />
              Needs edit
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => onStatus("rejected")}
              className="inline-flex items-center gap-2 rounded-full border border-red-300/30 px-4 py-2 text-sm text-red-200 transition-colors hover:border-red-200 disabled:opacity-50"
            >
              <XCircle size={16} />
              Reject
            </button>
          </>
        ) : null}
      </div>

      {canTrackResponse ? (
        <div className="mt-5 rounded-2xl border border-line bg-panel-soft/70 p-4">
          <div className="mb-4 flex items-center gap-2">
            <MessageSquareReply size={17} className="text-gold" />
            <div>
              <h4 className="text-sm font-semibold">Reply tracking</h4>
              <p className="text-xs text-cream-muted">
                Mark responses so Tracy can learn which drafts are working.
              </p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-xs text-cream-muted">Outcome</span>
              <select
                className="field"
                value={replyForm.responseStatus}
                onChange={(event) =>
                  onReplyChange({
                    responseStatus: event.target.value as OutreachResponseStatus,
                  })
                }
              >
                {Object.entries(responseStatusLabels).map(([value, label]) => (
                  <option key={value} value={value} className="bg-panel text-cream">
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs text-cream-muted">Score</span>
              <select
                className="field"
                value={replyForm.responseScore}
                onChange={(event) =>
                  onReplyChange({ responseScore: event.target.value })
                }
              >
                {Object.entries(responseScoreLabels).map(([value, label]) => (
                  <option key={value} value={value} className="bg-panel text-cream">
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs text-cream-muted">Reply date</span>
              <input
                className="field"
                type="date"
                value={replyForm.responseReceivedAt}
                onChange={(event) =>
                  onReplyChange({ responseReceivedAt: event.target.value })
                }
              />
            </label>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <textarea
              className="field min-h-24"
              value={replyForm.responseExcerpt}
              onChange={(event) =>
                onReplyChange({ responseExcerpt: event.target.value })
              }
              placeholder="Optional reply excerpt"
            />
            <textarea
              className="field min-h-24"
              value={replyForm.responseNotes}
              onChange={(event) =>
                onReplyChange({ responseNotes: event.target.value })
              }
              placeholder="Why do you think this worked or failed?"
            />
          </div>

          <button
            type="button"
            disabled={saving}
            onClick={onSaveResponse}
            className="mt-3 inline-flex items-center gap-2 rounded-full bg-gold px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50"
          >
            <Save size={16} />
            Save reply tracking
          </button>
        </div>
      ) : null}
    </article>
  );
}

export function ManagerDashboard() {
  const { user, profile } = useAuth();
  const [tasks, setTasks] = useState<OutreachTask[]>([]);
  const [taskNotes, setTaskNotes] = useState<Record<string, string>>({});
  const [replyForms, setReplyForms] = useState<Record<string, ReplyForm>>({});
  const [tasksLoading, setTasksLoading] = useState(true);
  const [taskSaving, setTaskSaving] = useState<string | null>(null);
  const [taskSuccess, setTaskSuccess] = useState<string | null>(null);
  const [logs, setLogs] = useState<OutreachLog[]>([]);
  const [entry, setEntry] = useState<LogData>(emptyEntry);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [checkingOrganization, setCheckingOrganization] = useState(false);
  const [approvedOrganization, setApprovedOrganization] = useState("");
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

  useEffect(() => {
    if (!user) return;
    let active = true;
    queueMicrotask(() => {
      if (active) setTasksLoading(true);
    });
    const unsub = subscribeOutreachTasks(
      "own",
      user.id,
      (next) => {
        if (!active) return;
        setTasks(next);
        setTaskNotes(
          Object.fromEntries(next.map((task) => [task.id, task.managerNotes ?? ""])),
        );
        setReplyForms(
          Object.fromEntries(
            next.map((task) => [
              task.id,
              {
                responseStatus: task.responseStatus,
                responseScore: String(task.responseScore),
                responseReceivedAt: formatDateInput(task.responseReceivedAt),
                responseExcerpt: task.responseExcerpt ?? "",
                responseNotes: task.responseNotes ?? "",
              },
            ]),
          ),
        );
        setTasksLoading(false);
      },
      (err) => {
        if (!active) return;
        setError(err.message);
        setTasksLoading(false);
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

  const visibleTasks = useMemo(
    () => tasks.filter((task) => ACTIVE_TASK_STATUSES.includes(task.status)),
    [tasks],
  );

  const sentTasks = useMemo(
    () => tasks.filter((task) => task.status === "sent"),
    [tasks],
  );

  function update(col: string, value: string) {
    setEntry((current) => ({ ...current, [col]: value }));
    if (
      col === ORGANIZATION_COLUMN &&
      value.trim() !== approvedOrganization
    ) {
      setApprovedOrganization("");
    }
    setError(null);
  }

  async function handleOrganizationCheck() {
    const organization = entry[ORGANIZATION_COLUMN]?.trim();
    if (!organization) {
      setError("Enter an organization name first.");
      return;
    }

    setCheckingOrganization(true);
    setError(null);
    setSuccess(null);
    try {
      const available = await checkOrganizationAvailability(organization);
      if (!available) {
        setApprovedOrganization("");
        setError(
          "This organization has already been entered. Please choose a different organization.",
        );
        return;
      }
      setEntry((current) => ({
        ...current,
        [ORGANIZATION_COLUMN]: organization,
      }));
      setApprovedOrganization(organization);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not check the organization.",
      );
    } finally {
      setCheckingOrganization(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;

    const organization = entry[ORGANIZATION_COLUMN]?.trim();
    if (!organization) {
      setError("Organization is required.");
      return;
    }
    if (!approvedOrganization || approvedOrganization !== organization) {
      setError("Check the organization before entering outreach details.");
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
      const label = entry[ORGANIZATION_COLUMN];
      setEntry(emptyEntry());
      setApprovedOrganization("");
      setSuccess(`${label} logged.`);
      window.setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the log.");
    } finally {
      setSubmitting(false);
    }
  }

  async function updateTaskStatus(task: OutreachTask, status: OutreachTaskStatus) {
    if (!user) return;
    setTaskSaving(task.id);
    setError(null);
    setTaskSuccess(null);
    try {
      await updateOutreachTask(task.id, {
        status,
        manager_notes: taskNotes[task.id] ?? "",
        ...(status === "sent"
          ? { sent_at: new Date().toISOString(), sent_by: user.id }
          : {}),
      });
      setTaskSuccess(`${task.organizationName} updated.`);
      window.setTimeout(() => setTaskSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update task.");
    } finally {
      setTaskSaving(null);
    }
  }

  function updateReplyForm(taskId: string, patch: Partial<ReplyForm>) {
    const fallback: ReplyForm = {
      responseStatus: "not_tracked",
      responseScore: "0",
      responseReceivedAt: "",
      responseExcerpt: "",
      responseNotes: "",
    };
    setReplyForms((current) => ({
      ...current,
      [taskId]: {
        ...fallback,
        ...current[taskId],
        ...patch,
      },
    }));
  }

  async function saveTaskResponse(task: OutreachTask) {
    if (!user) return;
    const form = replyForms[task.id];
    if (!form) return;
    setTaskSaving(task.id);
    setError(null);
    setTaskSuccess(null);
    try {
      await updateOutreachTask(task.id, {
        response_status: form.responseStatus,
        response_score: Number(form.responseScore),
        response_received_at: form.responseReceivedAt
          ? new Date(`${form.responseReceivedAt}T12:00:00`).toISOString()
          : null,
        response_excerpt: form.responseExcerpt.trim() || null,
        response_notes: form.responseNotes.trim() || null,
        response_updated_at: new Date().toISOString(),
        response_updated_by: user.id,
      });
      setTaskSuccess(`${task.organizationName} response saved.`);
      window.setTimeout(() => setTaskSuccess(null), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save response.");
    } finally {
      setTaskSaving(null);
    }
  }

  async function copyDraft(task: OutreachTask) {
    await navigator.clipboard.writeText(
      `${task.draftSubject || "Draft email"}\n\n${task.draftEmail}`,
    );
    setTaskSuccess("Draft copied.");
    window.setTimeout(() => setTaskSuccess(null), 2500);
  }

  return (
    <main className="ops-bg min-h-screen px-4 py-8 text-cream sm:px-6">
      <div className="pointer-events-none fixed inset-0 grid-overlay opacity-60" />
      <div className="relative mx-auto max-w-5xl space-y-6">
        <AppHeader subtitle="Review assigned email drafts, send them manually, and check organizations before logging new outreach." />

        <section className="rounded-3xl border border-line bg-panel/90 p-5">
          <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold">Assigned email drafts</h2>
              <p className="mt-1 text-sm text-cream-muted">
                {visibleTasks.length} active {visibleTasks.length === 1 ? "task" : "tasks"}
              </p>
            </div>
            <p className="text-sm text-cream-muted">
              {tasks.filter((task) => task.status === "sent").length} sent total
            </p>
          </div>

          {taskSuccess ? (
            <p className="mb-4 rounded-2xl border border-green-bright/30 bg-green-bright/10 px-4 py-3 text-sm text-green-bright">
              {taskSuccess}
            </p>
          ) : null}

          <div className="space-y-3">
            {visibleTasks.map((task) => (
              <DraftTaskCard
                key={task.id}
                task={task}
                notes={taskNotes[task.id] ?? ""}
                saving={taskSaving === task.id}
                onNotesChange={(value) =>
                  setTaskNotes((current) => ({ ...current, [task.id]: value }))
                }
                onCopy={() => {
                  void copyDraft(task);
                }}
                onStatus={(status) => {
                  void updateTaskStatus(task, status);
                }}
              />
            ))}
            {visibleTasks.length === 0 ? (
              <div className="py-12 text-center text-sm text-cream-muted">
                {tasksLoading ? "Loading assigned drafts…" : "No assigned drafts right now."}
              </div>
            ) : null}
          </div>

          {sentTasks.length ? (
            <div className="mt-8">
              <div className="mb-3">
                <h3 className="text-lg font-semibold">Reply tracking</h3>
                <p className="mt-1 text-sm text-cream-muted">
                  Update sent drafts when a contact replies, bounces, or goes cold.
                </p>
              </div>
              <div className="space-y-3">
                {sentTasks.map((task) => (
                  <DraftTaskCard
                    key={task.id}
                    task={task}
                    notes={taskNotes[task.id] ?? ""}
                    saving={taskSaving === task.id}
                    onNotesChange={(value) =>
                      setTaskNotes((current) => ({ ...current, [task.id]: value }))
                    }
                    onCopy={() => {
                      void copyDraft(task);
                    }}
                    onStatus={(status) => {
                      void updateTaskStatus(task, status);
                    }}
                    replyForm={replyForms[task.id]}
                    onReplyChange={(patch) => updateReplyForm(task.id, patch)}
                    onSaveResponse={() => {
                      void saveTaskResponse(task);
                    }}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </section>

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
              <input
                className="field"
                value={entry[ORGANIZATION_COLUMN] ?? ""}
                onChange={(event) =>
                  update(ORGANIZATION_COLUMN, event.target.value)
                }
                placeholder="Organization"
                disabled={Boolean(approvedOrganization)}
                autoComplete="organization"
              />

              {!approvedOrganization ? (
                <button
                  type="button"
                  onClick={handleOrganizationCheck}
                  disabled={checkingOrganization}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-gold/50 px-5 py-3 text-sm font-semibold text-gold transition-colors hover:bg-gold/10 disabled:opacity-50"
                >
                  {checkingOrganization
                    ? "Checking…"
                    : "Check organization"}
                  <ArrowRight size={17} />
                </button>
              ) : (
                <div className="rounded-2xl border border-green-bright/30 bg-green-bright/10 px-4 py-3">
                  <p className="flex items-center gap-2 text-sm font-medium text-green-bright">
                    <CheckCircle2 size={16} />
                    Organization is available
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setApprovedOrganization("");
                      setEntry((current) => ({
                        ...emptyEntry(),
                        [ORGANIZATION_COLUMN]:
                          current[ORGANIZATION_COLUMN] ?? "",
                      }));
                    }}
                    className="mt-1 text-xs text-cream-muted underline underline-offset-2 hover:text-cream"
                  >
                    Check a different organization
                  </button>
                </div>
              )}

              {approvedOrganization ? DETAIL_COLUMNS.map((col) =>
                col === MEETING_BOOKED_COLUMN ? (
                  <select
                    key={col}
                    className="field"
                    value={entry[col] ?? ""}
                    onChange={(event) => update(col, event.target.value)}
                    aria-label={col}
                  >
                    <option value="">Meeting Booked</option>
                    {MEETING_BOOKED_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : isLongFormColumn(col) ? (
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
                    type={inputTypeForColumn(col)}
                    className="field"
                    value={entry[col] ?? ""}
                    onChange={(event) => update(col, event.target.value)}
                    placeholder={col}
                    autoComplete={col === EMAIL_COLUMN ? "email" : undefined}
                  />
                ),
              ) : null}
            </div>

            {error ? <p className="mt-4 text-sm text-red-300">{error}</p> : null}
            {success ? (
              <p className="mt-4 rounded-2xl border border-green-bright/30 bg-green-bright/10 px-4 py-3 text-sm text-green-bright">
                {success}
              </p>
            ) : null}

            {approvedOrganization ? (
              <button
                type="submit"
                disabled={submitting}
                className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full bg-gold px-5 py-3 text-sm font-semibold text-ink disabled:opacity-50"
              >
                <Plus size={17} />
                {submitting ? "Saving…" : "Add organization"}
              </button>
            ) : null}
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
              <table className="w-full min-w-[780px] text-left text-sm">
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
