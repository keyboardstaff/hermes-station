/**
 * CronPanel — full-width single-column layout.
 */

import { useMemo, useState } from "react";
import {
  Plus,
  Search,
  RefreshCw,
  PauseCircle,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useI18n } from "@/i18n";
import PageTopBar from "@/components/layout/PageTopBar";
import { useCronJobs, type CronJob } from "@/hooks/useCron";
import CronJobDetail from "@/components/cron/CronJobDetail";
import CronCreateDialog from "@/components/cron/CronCreateDialog";
import CronInfoBar from "@/components/cron/CronInfoBar";
import CronEmptyTemplates, { type CronTemplate } from "@/components/cron/CronEmptyTemplates";

function relativeTime(iso?: string | null): string {
  if (!iso) return "--";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "--";
  const diff = (Date.now() - t) / 1000;
  if (diff < 60) return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

function statusColor(job: CronJob): string {
  if (job.last_status === "error") return "var(--hms-error, #ef4444)";
  if (job.state === "paused" || job.enabled === false) return "var(--hms-warning, #f59e0b)";
  return "var(--hms-success, #22c55e)";
}

function scheduleDisplay(job: CronJob): string {
  return job.schedule_display || job.schedule?.display || job.schedule?.expr || "--";
}

interface CardProps {
  job: CronJob;
  expanded: boolean;
  onToggle: () => void;
  onDeleted: () => void;
  detailLabels: React.ComponentProps<typeof CronJobDetail>["labels"];
}

function CronJobCard({ job, expanded, onToggle, onDeleted, detailLabels }: CardProps) {
  const errored = job.last_status === "error";

  return (
    <div
      style={{
        border: "1px solid var(--hms-border)",
        borderLeft: `3px solid ${statusColor(job)}`,
        borderRadius: 8,
        overflow: "hidden",
        background: "var(--hms-surface)",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: "var(--hms-space-3)",
          padding: "12px 16px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "var(--hms-text)",
          textAlign: "left",
        }}
      >
        <span style={{ flexShrink: 0 }}>
          {job.state === "paused" || job.enabled === false ? (
            <PauseCircle size={14} style={{ color: "var(--hms-warning)" }} />
          ) : errored ? (
            <AlertCircle size={14} style={{ color: "var(--hms-error)" }} />
          ) : (
            <CheckCircle2 size={14} style={{ color: "var(--hms-success)" }} />
          )}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: "var(--hms-text-sm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {job.name || job.id}
          </div>
          <div style={{ fontSize: "0.625rem", color: "var(--hms-text-muted)", fontFamily: "monospace", marginTop: 2 }}>
            {scheduleDisplay(job)}
          </div>
        </div>
        <div style={{ fontSize: "var(--hms-text-xs)", color: "var(--hms-text-muted)", whiteSpace: "nowrap", flexShrink: 0 }}>
          {relativeTime(job.last_run_at)}
        </div>
        <span style={{ flexShrink: 0, color: "var(--hms-text-muted)" }}>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>
      {expanded && (
        <div style={{ borderTop: "1px solid var(--hms-border)", padding: "0 16px 16px" }}>
          <CronJobDetail job={job} onDeleted={onDeleted} labels={detailLabels} />
        </div>
      )}
    </div>
  );
}

export default function CronPanel() {
  const { t } = useI18n();
  const c = t.cron;
  const { data: jobs, isLoading, isError, refetch } = useCronJobs();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [templateSchedule, setTemplateSchedule] = useState<string | undefined>();
  const [templatePrompt, setTemplatePrompt] = useState<string | undefined>();
  const [templateName, setTemplateName] = useState<string | undefined>();

  function openWithTemplate(tpl: CronTemplate) {
    setTemplateSchedule(tpl.schedule);
    setTemplatePrompt(tpl.prompt);
    setTemplateName(tpl.name);
    setCreateOpen(true);
  }

  function openBlank() {
    setTemplateSchedule(undefined);
    setTemplatePrompt(undefined);
    setTemplateName(undefined);
    setCreateOpen(true);
  }

  const filtered: CronJob[] = useMemo(() => {
    if (!jobs) return [];
    if (!query.trim()) return jobs;
    const q = query.toLowerCase();
    return jobs.filter(
      (j) =>
        (j.name || "").toLowerCase().includes(q) ||
        (j.id || "").toLowerCase().includes(q) ||
        scheduleDisplay(j).toLowerCase().includes(q),
    );
  }, [jobs, query]);

  const detailLabels: React.ComponentProps<typeof CronJobDetail>["labels"] = {
    schedule: c?.schedule ?? "Schedule",
    prompt: c?.prompt ?? "Prompt",
    deliver: c?.deliver ?? "Deliver to",
    state: c?.state ?? "State",
    lastRun: c?.lastRun ?? "Last run",
    nextRun: c?.nextRun ?? "Next run",
    actions: c?.actions ?? "Actions",
    save: c?.save ?? "Save",
    saving: c?.saving ?? "Saving…",
    pause: c?.pause ?? "Pause",
    resume: c?.resume ?? "Resume",
    trigger: c?.trigger ?? "Trigger now",
    delete: c?.delete ?? "Delete",
    confirmDelete: c?.confirmDelete ?? "Delete cron job",
    deliverLocal: c?.deliverLocal ?? "Local (REPORT.md)",
    deliverOrigin: c?.deliverOrigin ?? "Origin",
    paused: c?.paused ?? "paused",
    scheduled: c?.scheduled ?? "scheduled",
    error: c?.errorState ?? "error",
    completed: c?.completed ?? "completed",
    okStatus: c?.okStatus ?? "ok",
    errorStatus: c?.errorStatus ?? "error",
    schedHint: c?.schedHint ?? "Accepts cron expressions, intervals, or one-shots.",
    repeatLabel: c?.repeatLabel ?? "Repeat",
    repeatRemaining: c?.repeatRemaining ?? "no limit",
  };

  const dialogLabels = {
    title: c?.newJob ?? "New cron job",
    schedule: c?.schedule ?? "Schedule",
    schedHint: c?.schedHint ?? "Accepts cron expressions, intervals, or one-shots.",
    prompt: c?.prompt ?? "Prompt",
    name: c?.name ?? "Name (optional)",
    nameHint: c?.nameHint ?? "Auto-derived from the prompt if blank.",
    save: c?.save ?? "Create",
    saving: c?.saving ?? "Creating…",
    cancel: c?.cancel ?? "Cancel",
    close: c?.close ?? "Close",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <PageTopBar
        title={t.nav.cron}
        actions={
          <>
            <button
              type="button"
              onClick={() => refetch()}
              title="Refresh"
              style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--hms-text-muted)", padding: 4, borderRadius: 4, display: "flex", alignItems: "center" }}
            >
              <RefreshCw size={14} />
            </button>
            <button
              type="button"
              onClick={openBlank}
              style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", background: "var(--hms-accent)", color: "#fff", border: "none", borderRadius: 6, fontSize: "var(--hms-text-xs)", fontWeight: 500, cursor: "pointer", flexShrink: 0 }}
            >
              <Plus size={13} />
              {c?.newJob ?? "New job"}
            </button>
          </>
        }
        context={
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--hms-space-2)",
              padding: "5px 8px",
              border: "1px solid var(--hms-border)",
              borderRadius: 6,
              background: "var(--hms-bg)",
            }}
          >
            <Search size={13} style={{ color: "var(--hms-text-muted)", flexShrink: 0 }} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={c?.searchPlaceholder ?? "Search jobs…"}
              style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontSize: "var(--hms-text-xs)", color: "var(--hms-text)" }}
            />
          </div>
        }
      />
      <CronInfoBar />
      <div
        style={{ flex: 1, overflowY: "auto", padding: "12px 10px", display: "flex", flexDirection: "column", gap: "var(--hms-space-2)" }}
      >
        {isLoading && (
          <div style={{ padding: 24, textAlign: "center", color: "var(--hms-text-muted)", fontSize: "var(--hms-text-sm)" }}>
            {c?.loading ?? "Loading…"}
          </div>
        )}
        {isError && (
          <div style={{ padding: 24, textAlign: "center", color: "var(--hms-error-text)", fontSize: "var(--hms-text-sm)" }}>
            {c?.errorLoading ?? "Failed to load."}
          </div>
        )}
        {!isLoading && !isError && filtered.length === 0 && (
          jobs && jobs.length === 0 ? (
            <CronEmptyTemplates
              onTemplate={openWithTemplate}
              onNew={openBlank}
              labels={{
                empty: c?.emptyNoJobs ?? "No scheduled jobs yet",
                createFirst: c?.createFromTemplate ?? "Create your first job from a template:",
                newJob: c?.newJob ?? "New job",
              }}
            />
          ) : (
            <div style={{ padding: 24, textAlign: "center", color: "var(--hms-text-muted)", fontSize: "var(--hms-text-sm)" }}>
              {c?.noJobs ?? "No matching jobs."}
            </div>
          )
        )}
        {!isLoading && !isError && filtered.map((job) => (
          <CronJobCard
            key={job.id}
            job={job}
            expanded={expandedId === job.id}
            onToggle={() => setExpandedId((prev) => (prev === job.id ? null : job.id))}
            onDeleted={() => setExpandedId(null)}
            detailLabels={detailLabels}
          />
        ))}
      </div>
      <CronCreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => { setCreateOpen(false); setExpandedId(id); }}
        labels={dialogLabels}
        initialSchedule={templateSchedule}
        initialPrompt={templatePrompt}
        initialName={templateName}
      />
    </div>
  );
}
