/**
 * CronPanel — full-width single-column layout.
 */

import { useMemo, useState } from "react";
import {
  Plus,
  Search,
  PauseCircle,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useI18n } from "@/i18n";
import PageTopBar from "@/components/layout/PageTopBar";
import Button from "@/components/ui/Button";
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

function statusOf(job: CronJob): "error" | "paused" | "ok" {
  if (job.last_status === "error") return "error";
  if (job.state === "paused" || job.enabled === false) return "paused";
  return "ok";
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
    <div className="hms-cron-card" data-status={statusOf(job)}>
      <button type="button" onClick={onToggle} className="hms-cron-card-toggle">
        <span className="hms-cron-card-status">
          {job.state === "paused" || job.enabled === false ? (
            <PauseCircle size={14} className="hms-cron-icon-warning" />
          ) : errored ? (
            <AlertCircle size={14} className="hms-cron-icon-error" />
          ) : (
            <CheckCircle2 size={14} className="hms-cron-icon-success" />
          )}
        </span>
        <div className="hms-cron-card-main">
          <div className="hms-cron-card-name">{job.name || job.id}</div>
          <div className="hms-cron-card-sched">{scheduleDisplay(job)}</div>
        </div>
        <div className="hms-cron-card-lastrun">{relativeTime(job.last_run_at)}</div>
        <span className="hms-cron-card-chevron">
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>
      {expanded && (
        <div className="hms-cron-card-body">
          <CronJobDetail job={job} onDeleted={onDeleted} labels={detailLabels} />
        </div>
      )}
    </div>
  );
}

export default function CronPanel() {
  const { t } = useI18n();
  const c = t.cron;
  const { data: jobs, isLoading, isError } = useCronJobs();
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
    <div className="hms-cron-root">
      <PageTopBar
        title={t.nav.cron}
        showProfileScope
        context={
          <div className="hms-cron-toolbar">
            <div className="hms-cron-search">
              <Search size={13} className="hms-cron-search-icon" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={c?.searchPlaceholder ?? "Search jobs…"}
                className="hms-cron-search-input"
              />
            </div>
            {/* New job sits right of the search (not in the topbar). */}
            <Button size="sm" variant="primary" onClick={openBlank}>
              <Plus size={13} />{c?.newJob ?? "New job"}
            </Button>
          </div>
        }
      />
      <CronInfoBar />
      <div className="hms-cron-list">
        {isLoading && (
          <div className="hms-cron-msg">{c?.loading ?? "Loading…"}</div>
        )}
        {isError && (
          <div className="hms-cron-msg hms-cron-msg--error">{c?.errorLoading ?? "Failed to load."}</div>
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
            <div className="hms-cron-msg">{c?.noJobs ?? "No matching jobs."}</div>
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
