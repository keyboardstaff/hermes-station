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
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <PageTopBar
        title={t.nav.analytics}
        context={
          <div style={{ display: "flex", alignItems: "center" }}>
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
      <div style={{ flex: 1, overflow: "auto", padding: 'var(--hms-space-6)' }}>

      {/* Dashboard unreachable notice */}
      {statusFetched && statusError && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            background: "var(--hms-warning-bg)",
            border: "1px solid var(--hms-warning-border)",
            color: "var(--hms-warning-text)",
            fontSize: 'var(--hms-text-sm)',
            marginBottom: 20,
          }}
        >
          {ac?.dashboardUnreachable ?? "Dashboard is not reachable -- data shown below may be incomplete. Open Settings → Connection to diagnose."}
        </div>
      )}

      {/* Overview cards */}
      <Section>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 'var(--hms-space-3)',
          }}
        >
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
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 'var(--hms-space-4)',
          }}
        >
          {usage?.by_model?.length ? (
            <div style={{ minWidth: 0 }}>
              <ModelDistributionDonut
                data={usage.by_model}
                title={ac?.byModel ?? "By Model"}
              />
            </div>
          ) : null}
          {sources?.sources?.length ? (
            <div style={{ minWidth: 0 }}>
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

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 'var(--hms-text-sm)'}}>
          <thead>
            <tr style={{ color: "var(--hms-text-muted)", textAlign: "left" }}>
              <th style={{ padding: "4px 0", fontWeight: 400 }}>Title</th>
              <th style={{ padding: "4px 0", fontWeight: 400 }}>{a.source}</th>
              <th style={{ padding: "4px 0", fontWeight: 400 }}>{a.model}</th>
              <th style={{ padding: "4px 0", fontWeight: 400, textAlign: "right" }}>
                {a.tokens}
              </th>
              <th style={{ padding: "4px 0", fontWeight: 400, textAlign: "right" }}>
                {a.time}
              </th>
            </tr>
          </thead>
          <tbody>
            {(sessionsData?.sessions ?? []).map((s, index) => (
              <tr
                key={s.session_id ?? `fallback-${index}`}
                style={{ borderTop: "1px solid var(--hms-border)" }}
              >
                <td
                  style={{
                    padding: "8px 0",
                    maxWidth: 200,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {s.title || "Untitled"}
                </td>
                <td style={{ padding: "8px 0", color: "var(--hms-text-muted)" }}>
                  {s.source || "--"}
                </td>
                <td style={{ padding: "8px 0", color: "var(--hms-text-muted)" }}>
                  {s.model || "--"}
                </td>
                <td
                  style={{
                    padding: "8px 0",
                    textAlign: "right",
                    color: "var(--hms-text-muted)",
                  }}
                >
                  {s.input_tokens != null
                    ? formatNumber((s.input_tokens ?? 0) + (s.output_tokens ?? 0))
                    : "--"}
                </td>
                <td
                  style={{
                    padding: "8px 0",
                    textAlign: "right",
                    color: "var(--hms-text-muted)",
                  }}
                >
                  {relativeTime(s.started_at)}
                </td>
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
    <Card style={{ marginBottom: 24 }}>
      {(title || actions) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 'var(--hms-space-3)',
            marginBottom: 12,
          }}
        >
          {title && (
            <h2 style={{ margin: 0, fontSize: 'var(--hms-text-body)', fontWeight: 600 }}>
              {title}
            </h2>
          )}
          {actions}
        </div>
      )}
      {children}
    </Card>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: 'var(--hms-space-6)',
        border: "1px dashed var(--hms-border)",
        borderRadius: 8,
        textAlign: "center",
        color: "var(--hms-text-muted)",
        fontSize: 'var(--hms-text-sm)',
      }}
    >
      {text}
    </div>
  );
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
      className={clickable ? "hms-card-hoverable" : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") onClick?.();
            }
          : undefined
      }
      style={{
        padding: 'var(--hms-space-4)',
        background: "var(--hms-surface)",
        border: "1px solid var(--hms-border)",
        borderRadius: 10,
        cursor: clickable ? "pointer" : "default",
      }}
    >
      <div style={{ fontSize: 'var(--hms-text-xs)', color: "var(--hms-text-muted)", marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 'var(--hms-text-xl)', fontWeight: 700, color: accent ?? "var(--hms-text)" }}>
        {value}
      </div>
      {actionLabel && (
        <div style={{ marginTop: 6, fontSize: 'var(--hms-text-xs)', color: "var(--hms-text-muted)" }}>
          {actionLabel}
        </div>
      )}
    </div>
  );
}
