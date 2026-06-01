/**
 * main detail view for a selected cron job.
 *
 * Read-mostly: shows fields + last run info + action buttons. Editing
 * happens in the inline form below (schedule / prompt / deliver only).
 * Other fields (model overrides, skills) are upstream-managed via
 * config.yaml or the Dashboard.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Play,
  Pause,
  Trash2,
  Save,
  Loader,
  AlertTriangle,
  Calendar,
  Inbox,
  Clock,
} from "lucide-react";
import {
  useUpdateJob,
  usePauseJob,
  useResumeJob,
  useTriggerJob,
  useDeleteJob,
  type CronJob,
} from "@/hooks/useCron";
import { useDiscoverPlatforms } from "@/store/discovery";
import { errorMessage } from "@/lib/errors";
import { PopupSelect } from "@/components/ui/PopupSelect";

interface Props {
  job: CronJob;
  onDeleted: () => void;
  labels: {
    schedule: string;
    prompt: string;
    deliver: string;
    state: string;
    lastRun: string;
    nextRun: string;
    actions: string;
    save: string;
    saving: string;
    pause: string;
    resume: string;
    trigger: string;
    delete: string;
    confirmDelete: string;
    deliverLocal: string;
    deliverOrigin: string;
    paused: string;
    scheduled: string;
    error: string;
    completed: string;
    okStatus: string;
    errorStatus: string;
    schedHint: string;
    repeatLabel: string;
    repeatRemaining: string;
  };
}

function formatIso(iso?: string | null): string {
  if (!iso) return "--";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleString();
}

function scheduleToString(job: CronJob): string {
  const s = job.schedule || {};
  if (s.kind === "cron" && s.expr) return s.expr;
  if (s.kind === "interval" && s.minutes) return `every ${s.minutes}m`;
  if (s.kind === "once" && s.run_at) return `at ${s.run_at}`;
  return job.schedule_display || s.display || "";
}

export default function CronJobDetail({ job, onDeleted, labels }: Props) {
  const update = useUpdateJob();
  const pause = usePauseJob();
  const resume = useResumeJob();
  const trigger = useTriggerJob();
  const del = useDeleteJob();
  const { data: platformsData } = useDiscoverPlatforms();

  const [schedule, setSchedule] = useState(() => scheduleToString(job));
  const [prompt, setPrompt] = useState(job.prompt || "");
  const [deliver, setDeliver] = useState(job.deliver || "local");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  // Reset form when a different job is selected.
  useEffect(() => {
    setSchedule(scheduleToString(job));
    setPrompt(job.prompt || "");
    setDeliver(job.deliver || "local");
    setErrMsg(null);
  // Reset the form only when a *different* job is selected (by id), not on
  // every refetch of the same job — depending on `job` would wipe edits in flight.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id]);

  const isPaused = job.state === "paused" || job.enabled === false;
  const dirty = useMemo(() => {
    return (
      schedule !== scheduleToString(job) ||
      prompt !== (job.prompt || "") ||
      deliver !== (job.deliver || "local")
    );
  }, [schedule, prompt, deliver, job]);

  const handleSave = async () => {
    setErrMsg(null);
    try {
      const body = {
        updates: {
          schedule: schedule || undefined,
          prompt: prompt || undefined,
          deliver: deliver || undefined,
        // Raw form strings; the cron update mutation accepts a loose partial
        // and the server normalizes `schedule` into a CronSchedule.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      };
      await update.mutateAsync({ id: job.id, body });
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2400);
    } catch (e: unknown) {
      setErrMsg(errorMessage(e));
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`${labels.confirmDelete} ${job.name || job.id}?`)) return;
    try {
      await del.mutateAsync(job.id);
      onDeleted();
    } catch (e: unknown) {
      setErrMsg(errorMessage(e));
    }
  };

  const platforms = platformsData?.platforms ?? [];

  // Build deliver options — local, origin, plus every discovered platform.
  const deliverOptions: { value: string; label: string }[] = [
    { value: "local", label: labels.deliverLocal },
    { value: "origin", label: labels.deliverOrigin },
    ...platforms
      .filter((p) => p.name !== "local" && p.name !== "origin")
      .map((p) => ({ value: p.name, label: p.label || p.name })),
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 'var(--hms-space-4)' }}>
      {/* Header */}
      <div>
        <h2
          style={{
            margin: 0,
            fontSize: 'var(--hms-text-md)',
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            gap: 'var(--hms-space-2)',
          }}
        >
          {job.name || job.id}
          <span
            style={{
              fontSize: '0.625rem',
              padding: "2px 6px",
              borderRadius: 4,
              fontWeight: 600,
              background: isPaused
                ? "rgba(245,158,11,0.12)"
                : job.state === "error"
                  ? "rgba(239,68,68,0.10)"
                  : "rgba(34,197,94,0.10)",
              color: isPaused
                ? "var(--hms-warning-text)"
                : job.state === "error"
                  ? "var(--hms-error-text)"
                  : "var(--hms-success-text)",
            }}
          >
            {isPaused
              ? labels.paused
              : job.state === "error"
                ? labels.error
                : job.state === "completed"
                  ? labels.completed
                  : labels.scheduled}
          </span>
        </h2>
        <div style={{ fontSize: '0.625rem', color: "var(--hms-text-muted)", marginTop: 4 }}>
          <code>{job.id}</code>
        </div>
      </div>

      {/* Action bar */}
      <div style={{ display: "flex", gap: 'var(--hms-space-2)', flexWrap: "wrap" }}>
        <button
          onClick={() => trigger.mutate(job.id)}
          disabled={trigger.isPending}
          style={iconActionBtn}
        >
          {trigger.isPending ? <Loader size={12} className="hms-spin" /> : <Play size={12} />}
          {labels.trigger}
        </button>
        {isPaused ? (
          <button
            onClick={() => resume.mutate(job.id)}
            disabled={resume.isPending}
            style={iconActionBtn}
          >
            <Play size={12} />
            {labels.resume}
          </button>
        ) : (
          <button
            onClick={() => pause.mutate(job.id)}
            disabled={pause.isPending}
            style={iconActionBtn}
          >
            <Pause size={12} />
            {labels.pause}
          </button>
        )}
        <button
          onClick={handleDelete}
          disabled={del.isPending}
          style={{ ...iconActionBtn, color: "var(--hms-error-text)", borderColor: "rgba(239,68,68,0.25)" }}
        >
          <Trash2 size={12} />
          {labels.delete}
        </button>
      </div>

      {/* Form */}
      <div
        style={{
          padding: 'var(--hms-space-4)',
          border: "1px solid var(--hms-border)",
          borderRadius: 10,
          background: "var(--hms-surface)",
          display: "flex",
          flexDirection: "column",
          gap: 'var(--hms-space-4)',
        }}
      >
        <Field label={labels.schedule} icon={<Calendar size={12} />}>
          <input
            type="text"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            placeholder="0 9 * * *  /  every 30m  /  at 2026-05-20 14:00"
            style={inputStyle}
            spellCheck={false}
          />
          <div style={{ fontSize: '0.625rem', color: "var(--hms-text-muted)", marginTop: 4 }}>
            {labels.schedHint}
          </div>
        </Field>

        <Field label={labels.prompt} icon={<Inbox size={12} />}>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
            spellCheck={false}
          />
        </Field>

        <Field label={labels.deliver}>
          <PopupSelect
            label={deliverOptions.find((o) => o.value === deliver)?.label ?? deliver}
            options={deliverOptions}
            value={deliver}
            onChange={setDeliver}
            fullWidth
            popupWidth={220}
          />
        </Field>

        {errMsg && (
          <div
            style={{
              padding: "6px 10px",
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.18)",
              borderRadius: 6,
              color: "var(--hms-error-text)",
              fontSize: 'var(--hms-text-caption)',
              display: "flex",
              alignItems: "center",
              gap: 'var(--hms-space-1)',
            }}
          >
            <AlertTriangle size={12} />
            {errMsg}
          </div>
        )}

        {savedFlash && (
          <div
            style={{
              padding: "6px 10px",
              background: "rgba(34,197,94,0.08)",
              border: "1px solid rgba(34,197,94,0.20)",
              borderRadius: 6,
              color: "var(--hms-success-text)",
              fontSize: 'var(--hms-text-caption)',
            }}
          >
            ✓ {labels.save}
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={!dirty || update.isPending}
          style={{
            ...primaryBtn,
            alignSelf: "flex-start",
            opacity: dirty ? 1 : 0.5,
            cursor: dirty ? "pointer" : "default",
          }}
        >
          {update.isPending ? <Loader size={12} className="hms-spin" /> : <Save size={12} />}
          {update.isPending ? labels.saving : labels.save}
        </button>
      </div>

      {/* Runtime info */}
      <div
        style={{
          padding: 14,
          border: "1px solid var(--hms-border)",
          borderRadius: 10,
          background: "var(--hms-surface)",
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          rowGap: 8,
          columnGap: 12,
          fontSize: 'var(--hms-text-caption)',
        }}
      >
        <span style={metaLabel}>{labels.lastRun}</span>
        <span>
          {formatIso(job.last_run_at)}
          {job.last_status && (
            <span
              style={{
                marginLeft: 6,
                fontSize: '0.625rem',
                padding: "1px 5px",
                borderRadius: 4,
                background: job.last_status === "ok"
                  ? "rgba(34,197,94,0.10)"
                  : "rgba(239,68,68,0.10)",
                color: job.last_status === "ok" ? "var(--hms-success-text)" : "var(--hms-error-text)",
              }}
            >
              {job.last_status === "ok" ? labels.okStatus : labels.errorStatus}
            </span>
          )}
        </span>

        <span style={metaLabel}>{labels.nextRun}</span>
        <span>{formatIso(job.next_run_at)}</span>

        {job.repeat && (
          <>
            <span style={metaLabel}>{labels.repeatLabel}</span>
            <span>
              {job.repeat.completed}
              {job.repeat.times != null && (
                <span style={{ color: "var(--hms-text-muted)" }}>
                  {" / "}
                  {job.repeat.times}
                </span>
              )}
              {job.repeat.times == null && (
                <span style={{ color: "var(--hms-text-muted)" }}> ({labels.repeatRemaining})</span>
              )}
            </span>
          </>
        )}

        {job.last_error && (
          <>
            <span style={metaLabel}>
              <AlertTriangle size={11} style={{ color: "var(--hms-error)", marginRight: 4 }} />
            </span>
            <span
              style={{
                color: "var(--hms-error-text)",
                fontSize: 'var(--hms-text-xs)',
                fontFamily: "monospace",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {job.last_error}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 'var(--hms-space-1)',
          fontSize: '0.625rem',
          fontWeight: 600,
          color: "var(--hms-text-muted)",
          marginBottom: 4,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {icon}
        {label}
      </div>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 10px",
  fontSize: 'var(--hms-text-caption)',
  background: "var(--hms-bg)",
  border: "1px solid var(--hms-border)",
  borderRadius: 6,
  color: "var(--hms-text)",
  outline: "none",
};

const metaLabel: React.CSSProperties = {
  fontSize: '0.625rem',
  fontWeight: 600,
  color: "var(--hms-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  whiteSpace: "nowrap",
};

const primaryBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 'var(--hms-space-1)',
  padding: "6px 14px",
  borderRadius: 6,
  border: "1px solid var(--hms-text)",
  background: "var(--hms-text)",
  color: "var(--hms-bg)",
  fontSize: 'var(--hms-text-caption)',
  fontWeight: 600,
};

const iconActionBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 'var(--hms-space-1)',
  padding: "4px 10px",
  borderRadius: 6,
  border: "1px solid var(--hms-border)",
  background: "transparent",
  color: "var(--hms-text)",
  cursor: "pointer",
  fontSize: 'var(--hms-text-xs)',
};

// Suppress unused-import warning for Clock — kept for future "next in <X>" badge.
void Clock;
