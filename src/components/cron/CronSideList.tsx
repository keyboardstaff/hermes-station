import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Search } from "lucide-react";
import { useI18n } from "@/i18n";
import { useCronJobs, type CronJob } from "@/hooks/useCron";
import { useCronSelection } from "@/store/panel-selection";
import { useIsMobile } from "@/hooks/useBreakpoint";
import CronJobRow from "@/components/cron/CronJobRow";
import CronCreateDialog from "@/components/cron/CronCreateDialog";

/**
 * sidebar list for ``/cron``.
 *
 * Selection lives in the ``useCronSelection`` zustand store — same
 * pattern as ``useChatStore`` for ``/chat`` ↔ ``SessionRecents``.
 */

export default function CronSideList({ onNew }: { onNew?: () => void } = {}) {
  const { t } = useI18n();
  const c = t.cron;
  const { data: jobs, isLoading, isError, refetch } = useCronJobs();

  const selectedJobId = useCronSelection((s) => s.selectedJobId);
  const setSelected = useCronSelection((s) => s.setSelected);

  const [query, setQuery] = useState("");
  const [localCreateOpen, setLocalCreateOpen] = useState(false);
  const handleNew = onNew ?? (() => setLocalCreateOpen(true));
  const isMobile = useIsMobile();

  const filtered: CronJob[] = useMemo(() => {
    if (!jobs) return [];
    const q = query.trim().toLowerCase();
    if (!q) return jobs;
    return jobs.filter((j) =>
      j.name?.toLowerCase().includes(q) ||
      j.id.toLowerCase().includes(q) ||
      j.prompt?.toLowerCase().includes(q),
    );
  }, [jobs, query]);

  // Auto-select first job when nothing is selected and data lands —
  // desktop only. On mobile the list would skip itself; see
  // ``ProfileSideList`` for the same comment.
  useEffect(() => {
    if (isMobile) return;
    if (selectedJobId || !jobs || jobs.length === 0) return;
    setSelected(jobs[0].id);
  }, [jobs, selectedJobId, setSelected, isMobile]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 'var(--hms-space-2)', padding: 'var(--hms-space-3)', height: "100%", boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ margin: 0, fontSize: 'var(--hms-text-body)', fontWeight: 700 }}>{t.nav.cron}</h2>
        <div style={{ display: "flex", gap: 'var(--hms-space-1)' }}>
          <button onClick={() => refetch()} title={c?.refresh ?? "Refresh"} style={iconBtn}>
            <RefreshCw size={11} />
          </button>
          <button
            onClick={() => handleNew()}
            title={c?.newJob ?? "New cron job"}
            style={{ ...iconBtn, color: "var(--hms-success-text)" }}
          >
            <Plus size={12} />
          </button>
        </div>
      </div>

      <div style={{ position: "relative" }}>
        <Search
          size={11}
          style={{
            position: "absolute",
            left: 8,
            top: "50%",
            transform: "translateY(-50%)",
            color: "var(--hms-text-muted)",
          }}
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={c?.searchPlaceholder ?? "Search jobs…"}
          style={{
            width: "100%",
            padding: "4px 8px 4px 24px",
            fontSize: 'var(--hms-text-xs)',
            background: "var(--hms-bg)",
            border: "1px solid var(--hms-border)",
            borderRadius: 6,
            color: "var(--hms-text)",
            outline: "none",
            boxSizing: "border-box",
          }}
        />
      </div>

      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 'var(--hms-space-1)' }}>
        {isLoading && (
          <div style={{ padding: 10, fontSize: 'var(--hms-text-xs)', color: "var(--hms-text-muted)" }}>
            {c?.loading ?? "Loading…"}
          </div>
        )}
        {isError && (
          <div style={{ padding: 10, fontSize: 'var(--hms-text-xs)', color: "var(--hms-error-text)" }}>
            {c?.errorLoading ?? "Failed to load."}
          </div>
        )}
        {!isLoading && !isError && filtered.length === 0 && (
          <div
            style={{
              padding: 'var(--hms-space-3)',
              fontSize: 'var(--hms-text-xs)',
              color: "var(--hms-text-muted)",
              textAlign: "center",
              border: "1px dashed var(--hms-border)",
              borderRadius: 6,
            }}
          >
            {query ? (c?.noMatches ?? "No matches.") : (c?.noJobs ?? "No jobs.")}
          </div>
        )}
        {filtered.map((j) => (
          <CronJobRow
            key={j.id}
            job={j}
            selected={selectedJobId === j.id}
            onSelect={() => setSelected(j.id)}
          />
        ))}
      </div>

      {!onNew && <CronCreateDialog
        open={localCreateOpen}
        onClose={() => setLocalCreateOpen(false)}
        onCreated={(id) => setSelected(id)}
        labels={{
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
        }}
      />}
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 24,
  height: 24,
  borderRadius: 5,
  border: "1px solid var(--hms-border)",
  background: "transparent",
  color: "var(--hms-text-muted)",
  cursor: "pointer",
};
