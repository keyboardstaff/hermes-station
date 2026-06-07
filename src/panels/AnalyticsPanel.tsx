import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import PageTopBar from "@/components/layout/PageTopBar";
import { useNavigate } from "react-router-dom";
import { useOverlays } from "@/store/overlays";
import { api } from "@/lib/api";
import Button from "@/components/ui/Button";
import {
  useAnalyticsUsage,
  useAnalyticsSources,
} from "@/hooks/useAnalytics";
import TimeRangeSelector, { type TimeRange } from "@/components/analytics/TimeRangeSelector";
import TokenUsageChart from "@/components/analytics/TokenUsageChart";
import CostCard from "@/components/analytics/CostCard";
import ModelDistributionDonut from "@/components/analytics/ModelDistributionDonut";
import SourceDistributionDonut from "@/components/analytics/SourceDistributionDonut";
import TopSkillsList from "@/components/analytics/TopSkillsList";
import Card from "@/components/ui/Card";

/**
 * AnalyticsPanel — full analytics dashboard for the station.
 *
 * expansion: adds time-range selector, token usage chart,
 * cost estimate card, model / source donuts, and top-skills list on
 * top of the existing status summary cards and recent sessions table.
 */

// ── Types ────────────────────────────────────────────────────────────

interface StatusData {
  gateway_running: boolean;
  gateway_state: string | null;
  active_sessions: number;
  version: string;
}

interface UsageData {
  totals: {
    total_input: number;
    total_output: number;
    total_sessions: number;
  };
}

interface Session {
  session_id: string;
  title?: string;
  source?: string;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  started_at?: number;
}

// ── Helpers ──────────────────────────────────────────────────────────

function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

function relativeTime(ts?: number): string {
  if (!ts) return "--";
  const diff = Date.now() / 1000 - ts;
  if (diff < 3600) return Math.round(diff / 60) + "m";
  if (diff < 86400) return Math.round(diff / 3600) + "h";
  return Math.round(diff / 86400) + "d";
}

// ── Panel ────────────────────────────────────────────────────────────

export default function AnalyticsPanel() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const openSettings = useOverlays((s) => s.openSettings);
  const [days, setDays] = useState<TimeRange>(7);

  // ── Status + today summary ─────────────────────────────────────
  // All three queries go through the central ``api`` wrapper so 401/403/
  // 5xx surface as ``ApiError`` consistently with every other panel.
  const {
    data: status,
    isError: statusError,
    isFetched: statusFetched,
  } = useQuery<StatusData>({
    queryKey: ["dashboard-status"],
    queryFn: () => api.get<StatusData>("/api/dashboard/status"),
    refetchInterval: 30_000,
    retry: 1,
  });

  const { data: todayUsage } = useQuery<UsageData>({
    queryKey: ["analytics-usage", 1],
    queryFn: () => api.get<UsageData>("/api/dashboard/analytics/usage?days=1"),
    refetchInterval: 60_000,
    retry: false,
  });

  const { data: sessionsData } = useQuery<{ sessions: Session[] }>({
    queryKey: ["recent-sessions"],
    queryFn: () => api.get<{ sessions: Session[] }>("/api/dashboard/sessions?limit=5"),
    refetchInterval: 30_000,
    retry: false,
  });

  // ── Charts data────────────────────────────────────
  const { data: usage, isError: usageError } = useAnalyticsUsage(days);
  const { data: sources } = useAnalyticsSources(days);

  const gatewayOk = !!status?.gateway_running && status.gateway_state === "running";
  const dashboardOk = !statusError && !!status;
  const todayTokens =
    (todayUsage?.totals?.total_input ?? 0) + (todayUsage?.totals?.total_output ?? 0);

  const loading = !statusFetched;
  const neutralAccent = "var(--hms-text-muted)";
  const goToConnection = () => openSettings("connection");

  // i18n — inline English fallbacks for new keys
  const a = t.analytics;
  const ac = t.analyticsCharts;

  return (
    <div className="hms-analytics-root">
      <PageTopBar
        title={t.nav.analytics}
        context={
          <div className="hms-analytics-range">
            <TimeRangeSelector
              value={days}
              onChange={setDays}
              labels={{
                7:  ac?.range7d  ?? "7d",
                30: ac?.range30d ?? "30d",
                90: ac?.range90d ?? "90d",
              }}
            />
          </div>
        }
      />
      <div className="hms-analytics-body">

      {/* Dashboard unreachable notice */}
      {statusFetched && statusError && (
        <div className="hms-analytics-warn">
          {ac?.dashboardUnreachable ?? "Dashboard is not reachable -- data shown below may be incomplete. Open Settings → Connection to diagnose."}
        </div>
      )}

      {/* Overview cards */}
      <Section>
        <div className="hms-analytics-grid">
          <StatCard
            label={a.gatewayStatus}
            value={loading ? "…" : gatewayOk ? a.statusRunning : status?.gateway_state ?? "--"}
            accent={loading ? neutralAccent : gatewayOk ? "var(--hms-success)" : "var(--hms-error)"}
            onClick={goToConnection}
            actionLabel={a.manageInSettings}
          />
          <StatCard
            label={a.dashboardStatus}
            value={loading ? "…" : dashboardOk ? a.statusRunning : statusError ? a.statusUnreachable : "--"}
            accent={loading ? neutralAccent : dashboardOk ? "var(--hms-success)" : "var(--hms-error)"}
            onClick={goToConnection}
            actionLabel={a.manageInSettings}
          />
          <StatCard
            label={a.activeSessions}
            value={status?.active_sessions != null ? String(status.active_sessions) : "--"}
          />
          <StatCard
            label={a.todayTokens}
            value={todayTokens ? formatNumber(todayTokens) : "--"}
          />
        </div>
      </Section>

      {/* ──Charts section ───────────────────────────── */}

      {/* Token Usage Over Time */}
      <Section title={ac?.tokenUsage ?? "Token Usage Over Time"}>
        {usageError ? (
          <EmptyState text={ac?.dataNotReady ?? "Analytics data not ready."} />
        ) : usage?.daily?.length ? (
          <TokenUsageChart
            data={usage.daily}
            labels={{
              input:  ac?.input  ?? "Input",
              output: ac?.output ?? "Output",
              cache:  ac?.cache  ?? "Cache",
            }}
          />
        ) : (
          <EmptyState text={ac?.dataNotReady ?? "Analytics data not ready."} />
        )}
      </Section>

      {/* Cost Estimate */}
      {usage?.totals && (
        <Section title={ac?.costEstimate ?? "Cost Estimate"}>
          <CostCard
            estimated={usage.totals.total_estimated_cost}
            actual={usage.totals.total_actual_cost}
            sessions={usage.totals.total_sessions}
            labels={{
              estimated: ac?.estimated ?? "Estimated",
              actual:    ac?.actual    ?? "Actual",
              sessions:  a.activeSessions,
            }}
          />
        </Section>
      )}

      {/* Distribution donuts — side by side on desktop, stacked on mobile */}
      <Section>
        <div className="hms-analytics-grid-wide">
          {usage?.by_model?.length ? (
            <div className="hms-analytics-donut">
              <ModelDistributionDonut
                data={usage.by_model}
                title={ac?.byModel ?? "By Model"}
              />
            </div>
          ) : null}
          {sources?.sources?.length ? (
            <div className="hms-analytics-donut">
              <SourceDistributionDonut
                data={sources.sources}
                title={ac?.bySource ?? "By Source"}
              />
            </div>
          ) : null}
        </div>
      </Section>

      {/* Top Skills */}
      {usage?.skills?.top_skills?.length ? (
        <Section title={ac?.topSkills ?? "Top Skills"}>
          <TopSkillsList
            data={usage.skills.top_skills}
          />
        </Section>
      ) : null}

      {/* Recent sessions table */}
      <Section
        title={a.recentSessions}
        actions={<Button size="sm" onClick={() => navigate("/sessions")}>View all</Button>}
      >

        <table className="hms-analytics-table">
          <thead>
            <tr>
              <th>Title</th>
              <th>{a.source}</th>
              <th>{a.model}</th>
              <th className="num">{a.tokens}</th>
              <th className="num">{a.time}</th>
            </tr>
          </thead>
          <tbody>
            {(sessionsData?.sessions ?? []).map((s, index) => (
              <tr key={s.session_id ?? `fallback-${index}`}>
                <td className="title">{s.title || "Untitled"}</td>
                <td>{s.source || "--"}</td>
                <td>{s.model || "--"}</td>
                <td className="num">
                  {s.input_tokens != null
                    ? formatNumber((s.input_tokens ?? 0) + (s.output_tokens ?? 0))
                    : "--"}
                </td>
                <td className="num">{relativeTime(s.started_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────

function Section({
  title,
  actions,
  children,
}: {
  title?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="hms-analytics-section">
      {(title || actions) && (
        <div className="hms-analytics-section-head">
          {title && <h2 className="hms-analytics-section-title">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </Card>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="hms-analytics-empty">{text}</div>;
}

function StatCard({
  label,
  value,
  accent,
  onClick,
  actionLabel,
}: {
  label: string;
  value: string;
  accent?: string;
  onClick?: () => void;
  actionLabel?: string;
}) {
  const clickable = !!onClick;
  return (
    <div
      onClick={onClick}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      className={`hms-stat${clickable ? " hms-card-hoverable" : ""}`}
      data-clickable={clickable || undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") onClick?.();
            }
          : undefined
      }
    >
      <div className="hms-stat-label">{label}</div>
      <div className="hms-stat-value" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      {actionLabel && <div className="hms-stat-action">{actionLabel}</div>}
    </div>
  );
}
