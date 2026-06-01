import { useEffect, useState } from "react";
import { Server, RefreshCw, ExternalLink, Cpu, Activity } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { api, ApiError } from "@/lib/api";
import { useCapabilityStore, type CapabilityFlags } from "@/store/capabilities";
import { Section } from "@/components/settings/shared";

// Spinner keyframes for the Gateway restart button (multi-second spawn).
if (typeof document !== "undefined" && !document.getElementById("hms-spin-style")) {
  const style = document.createElement("style");
  style.id = "hms-spin-style";
  style.textContent = `@keyframes hms-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}.hms-spin{animation:hms-spin 1s linear infinite}`;
  document.head.appendChild(style);
}

// Tiny pub-sub lifting the GatewaySection's in-flight state into the System tab's
// poll cadence (5s→1s) + a 6s quiet window where the adapter is known offline.
const RESTART_QUIET_MS = 6_000;
const _lifecycleAwaitingListeners = new Set<(v: boolean) => void>();
let _lifecycleAwaiting = false;
let _restartedAt = 0;
function setLifecycleAwaiting(v: boolean) {
  if (_lifecycleAwaiting === v) return;
  _lifecycleAwaiting = v;
  _lifecycleAwaitingListeners.forEach((cb) => cb(v));
}
function markRestartedNow() {
  _restartedAt = Date.now();
  _lifecycleAwaitingListeners.forEach((cb) => cb(_lifecycleAwaiting));
}
function useIsLifecycleAwaiting(): boolean {
  const [v, setV] = useState(_lifecycleAwaiting);
  useEffect(() => {
    _lifecycleAwaitingListeners.add(setV);
    return () => { _lifecycleAwaitingListeners.delete(setV); };
  }, []);
  return v;
}
function useRestartQuiet(): boolean {
  const [, force] = useState(0);
  useEffect(() => {
    const tick = () => force((n) => n + 1);
    _lifecycleAwaitingListeners.add(tick);
    return () => { _lifecycleAwaitingListeners.delete(tick); };
  }, []);
  const remaining = RESTART_QUIET_MS - (Date.now() - _restartedAt);
  useEffect(() => {
    if (remaining <= 0) return;
    const t = setTimeout(() => force((n) => n + 1), remaining + 50);
    return () => clearTimeout(t);
  }, [remaining]);
  return remaining > 0;
}

interface DashboardSnapshot {
  /** "running" | "starting" | "stopped" | "crashed" | "unmanaged" */
  state: string;
  pid: number | null;
  managed_by_hms: boolean;
  url: string;
  started_at: number | null;
  last_error: string | null;
  recent_crashes: number[];
}

interface LifecycleStatus {
  plugin: {
    repo: string;
    install_dir: string;
    files_installed: boolean;
    config_enabled: boolean;
    config_present: boolean;
  };
  dashboard?: DashboardSnapshot;
  gateway: {
    manager?: string;
    service_installed?: boolean;
    service_running?: boolean;
    // Always present (defaults to ``[]``) — see ``server.lifecycle.get_gateway_status``.
    live_pids: number[];
    service_scope?: string;
    error?: string;
  };
  platform?: string;
}

function formatUptime(startedAt: number | null | undefined): string {
  if (!startedAt) return "—";
  const diff = Math.max(0, Date.now() / 1000 - startedAt);
  if (diff < 60) return `${Math.round(diff)}s`;
  if (diff < 3600) return `${Math.round(diff / 60)}m`;
  if (diff < 86400) return `${(diff / 3600).toFixed(1)}h`;
  return `${(diff / 86400).toFixed(1)}d`;
}

// ── Diagnostics section (shown inside System tab) ────────────────────

const DIAG_FLAG_GROUPS: {
  label: string;
  keys: { key: keyof CapabilityFlags; label: string }[];
}[] = [
  {
    label: "Core",
    keys: [
      { key: "agent_importable",      label: "AIAgent" },
      { key: "approval_4_choice",     label: "4-choice approval" },
      { key: "session_db",            label: "SessionDB" },
      { key: "gateway_lifecycle",     label: "Gateway lifecycle" },
      { key: "base_platform_adapter", label: "PlatformAdapter" },
    ],
  },
  {
    label: "Features",
    keys: [
      { key: "handoff_supported",        label: "Handoff" },
      { key: "subgoal_supported",        label: "Sub-goals" },
      { key: "vision_analyze_tool",      label: "Vision" },
      { key: "x_search_tool",            label: "X search" },
      { key: "platform_circuit_breaker", label: "Circuit breaker" },
      { key: "cron_deliver_all",         label: "Cron deliver_all" },
      { key: "pareto_code_router",       label: "Pareto code" },
      { key: "plugin_ctx_llm",           label: "Plugin ctx.llm" },
      { key: "skills_hf_tap",            label: "HF skill tap" },
    ],
  },
];

function DiagnosticsSection() {
  const { caps } = useCapabilityStore();
  const flags = caps?.flags;
  if (!caps) {
    return (
      <div style={{ padding: 'var(--hms-space-4)', fontSize: 'var(--hms-text-sm)', color: "var(--hms-text-muted)" }}>
        …
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 'var(--hms-space-4)' }}>
      {flags ? (
        <>
          {DIAG_FLAG_GROUPS.map((g) => (
            <div key={g.label}>
              <div style={{
                fontSize: 'var(--hms-text-xs)',
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "var(--hms-text-muted)",
                marginBottom: 6,
              }}>
                {g.label}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 'var(--hms-space-2)' }}>
                {g.keys.map(({ key, label }) => {
                  const val = flags[key];
                  if (val === undefined) return null;
                  const ok = !!val;
                  return (
                    <span
                      key={key}
                      title={key}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 'var(--hms-space-1)',
                        padding: "3px 8px",
                        borderRadius: 4,
                        fontSize: 'var(--hms-text-xs)',
                        background: ok ? "rgba(34,197,94,0.10)" : "rgba(239,68,68,0.08)",
                        color: ok ? "var(--hms-success-text)" : "var(--hms-error-text)",
                        border: `1px solid ${ok ? "rgba(34,197,94,0.20)" : "rgba(239,68,68,0.15)"}`,
                      }}
                    >
                      {ok ? "✓" : "✗"} {label}
                    </span>
                  );
                })}
              </div>
            </div>
          ))}
          <div style={{
            fontSize: 'var(--hms-text-xs)',
            color: "var(--hms-text-muted)",
            borderTop: "1px solid var(--hms-border)",
            paddingTop: 8,
            lineHeight: 1.7,
          }}>
            {flags.upstream_version && <div>hermes-agent: <code>{flags.upstream_version}</code></div>}
            {flags.python_version && <div>Python: <code>{flags.python_version}</code></div>}
            {flags.os_name && <div>OS: <code>{flags.os_name}</code></div>}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 'var(--hms-text-caption)', color: "var(--hms-text-muted)" }}>
          No upstream flags reported (legacy backend).
        </div>
      )}
    </div>
  );
}

function SectionHeaderBadge({
  running, crashed, notInstalled, unmanaged, loading, restarting,
}: {
  running: boolean;
  crashed?: boolean;
  notInstalled?: boolean;
  unmanaged?: boolean;
  loading?: boolean;
  restarting?: boolean;
}) {
  const { t } = useI18n();
  let label: string;
  let bg: string;
  let color: string;
  if (loading) {
    // Neutral until /api/lifecycle/status returns — avoids misleading red/yellow flash.
    label = "…";
    bg = "rgba(148,163,184,0.18)";
    color = "#475569";
  } else if (restarting) {
    label = "restarting";
    bg = "rgba(245,158,11,0.15)";
    color = "#b45309";
  } else if (crashed) {
    label = t.connection.crashed;
    bg = "rgba(239,68,68,0.15)";
    color = "var(--hms-error-text)";
  } else if (notInstalled) {
    label = "not installed";
    bg = "rgba(245,158,11,0.15)";
    color = "#b45309";
  } else if (running) {
    label = "running";
    bg = "rgba(34,197,94,0.15)";
    color = "var(--hms-success-text)";
  } else if (unmanaged) {
    label = "not managed";
    bg = "rgba(148,163,184,0.18)";
    color = "#475569";
  } else {
    label = "stopped";
    bg = "rgba(239,68,68,0.15)";
    color = "var(--hms-error-text)";
  }
  return (
    <div style={{
      alignSelf: "flex-start", fontSize: 'var(--hms-text-xs)', padding: "2px 8px",
      borderRadius: 4, background: bg, color, fontWeight: 600,
    }}>
      {label}
    </div>
  );
}

function StatusRow({ label, ok }: { label: string; ok: boolean }) {
  const { t } = useI18n();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-2)', fontSize: 'var(--hms-text-sm)'}}>
      <span style={{ color: ok ? "var(--hms-success)" : "var(--hms-error)", width: 14 }}>{ok ? "✓" : "✗"}</span>
      <span>{label}</span>
      <span style={{ marginLeft: "auto", fontSize: 'var(--hms-text-xs)', color: "var(--hms-text-muted)" }}>
        {ok ? t.capability.reachable : t.capability.unreachable}
      </span>
    </div>
  );
}

function DashboardSection({
  dashboard, reachable, loaded,
}: { dashboard?: DashboardSnapshot; reachable: boolean; loaded: boolean }) {
  const { t } = useI18n();
  const state = dashboard?.state ?? "unmanaged";
  const isCrashed = loaded && state === "crashed";
  const isRunning = loaded && (state === "running" || reachable);

  return (
    <Section icon={<Activity size={14} />} title={t.connection.dashboardSection}>
      <SectionHeaderBadge
        running={isRunning}
        crashed={isCrashed}
        unmanaged={loaded && state === "unmanaged"}
        loading={!loaded}
      />

      <div style={{ fontSize: 'var(--hms-text-xs)', color: "var(--hms-text-muted)", lineHeight: 1.6 }}>
        {dashboard?.url && (
          <>
            URL: <code>{dashboard.url}</code>
          </>
        )}
        {dashboard?.pid && (
          <> &middot; {t.connection.pid}: <code>{dashboard.pid}</code></>
        )}
        {dashboard?.started_at && (
          <> &middot; {t.connection.uptime}: <code>{formatUptime(dashboard.started_at)}</code></>
        )}
      </div>

      {isCrashed && (
        <div style={{
          padding: "8px 12px", borderRadius: 6,
          background: "var(--hms-error-bg)", border: "1px solid #ef4444",
          fontSize: 'var(--hms-text-caption)', color: "var(--hms-error-dark)",
        }}>
          {t.connection.crashedHint}
          {dashboard?.last_error && (
            <div style={{ marginTop: 4, fontFamily: "monospace", fontSize: 'var(--hms-text-xs)'}}>
              {dashboard.last_error}
            </div>
          )}
        </div>
      )}

      {dashboard?.url && (
        <div>
          <a
            href={dashboard.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex", alignItems: "center", gap: 'var(--hms-space-1)',
              padding: "5px 12px", borderRadius: 6,
              border: "1px solid var(--hms-border)",
              background: "var(--hms-surface)",
              color: "var(--hms-text)",
              fontSize: 'var(--hms-text-caption)',
              textDecoration: "none",
            }}
          >
            <ExternalLink size={12} /> {t.connection.openInBrowser}
          </a>
        </div>
      )}

      <div style={{ fontSize: 'var(--hms-text-xs)', color: "var(--hms-text-muted)", lineHeight: 1.6 }}>
        ⓘ {t.connection.dashboardManagedByWs}
      </div>
    </Section>
  );
}

function GatewaySection({
  gateway, platform, reachable, loaded,
}: {
  gateway?: LifecycleStatus["gateway"];
  platform?: string;
  reachable: boolean;
  loaded: boolean;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const gw: Partial<NonNullable<LifecycleStatus["gateway"]>> = gateway ?? {};
  const installed = !!gw.service_installed;
  const running = !!gw.service_running || reachable;
  const pids = gw.live_pids ?? [];

  // Restart state flow: click→isPending→202 awaitingFresh→PID swap detected→idle.
  // Without awaitingFresh the button flashes "done" because the old PID lives
  // for ~3s while launchd spawns the replacement.
  const [awaitingFresh, setAwaitingFresh] = useState<{ at: number; oldPids: number[] } | null>(null);

  const restart = useMutation({
    // Catch ApiError so 202 (queued) vs 409 (refused) is uniformly visible to onSuccess.
    mutationFn: async () => {
      try {
        const body = await api.json<unknown>(
          "/api/lifecycle/gateway/restart",
          "POST",
        );
        return { status: 202, body };
      } catch (e) {
        if (e instanceof ApiError) {
          return { status: e.status, body: e.detail ?? {} };
        }
        throw e;
      }
    },
    onSuccess: (result) => {
      if (result.status === 202) {
        markRestartedNow();
        setAwaitingFresh({ at: Date.now(), oldPids: [...pids] });
      }
      qc.invalidateQueries({ queryKey: ["lifecycle-status"] });
      qc.invalidateQueries({ queryKey: ["caps-snapshot"] });
    },
  });

  // Clear the awaiting flag once the gateway PID set has actually
  // changed OR the 15s deadline has passed. The deadline needs its own
  // timer because `livePidSet` may never update during the outage
  // (polls fail with ERR_CONNECTION_REFUSED and react-query keeps the
  // cached pids), so the deps-only effect would otherwise never re-run.
  const livePidSet = JSON.stringify([...pids].sort());
  useEffect(() => {
    if (!awaitingFresh) return;
    const oldSorted = JSON.stringify([...awaitingFresh.oldPids].sort());
    if (livePidSet !== oldSorted) {
      setAwaitingFresh(null);
      return;
    }
    const remaining = 15_000 - (Date.now() - awaitingFresh.at);
    if (remaining <= 0) {
      setAwaitingFresh(null);
      return;
    }
    const t = setTimeout(() => setAwaitingFresh(null), remaining);
    return () => clearTimeout(t);
  }, [awaitingFresh, livePidSet]);

  const isRestarting = restart.isPending || awaitingFresh !== null;

  // Lift parent's lifecycle-status poll cadence so PID transitions land within 1s.
  useEffect(() => {
    setLifecycleAwaiting(isRestarting);
    return () => setLifecycleAwaiting(false);
  }, [isRestarting]);

  const managerHint =
    platform === "systemd"
      ? t.connection.gatewayManagedBySystemd
      : t.connection.gatewayManagedByLaunchd;

  return (
    <Section icon={<Server size={14} />} title={t.connection.gatewaySection}>
      <SectionHeaderBadge
        running={loaded && running && !isRestarting}
        notInstalled={loaded && !installed}
        loading={!loaded}
        restarting={isRestarting}
      />

      <div style={{ fontSize: 'var(--hms-text-xs)', color: "var(--hms-text-muted)", lineHeight: 1.6 }}>
        Manager: <code>{gw.manager ?? platform ?? "unknown"}</code>
        {pids.length > 0 && <> &middot; {t.connection.pid}: <code>{pids.join(", ")}</code></>}
        {gw.error && <> &middot; <span style={{ color: "var(--hms-error)" }}>error: {gw.error}</span></>}
      </div>

      {/* Wait for /api/lifecycle/status — avoids flashing the box on every load. */}
      {loaded && !installed && (
        <div style={{
          padding: "8px 12px", borderRadius: 6,
          background: "var(--hms-warning-bg)", border: "1px solid #f59e0b",
          fontSize: 'var(--hms-text-caption)', color: "var(--hms-warning-text)",
        }}>
          {t.connection.notInstalledHint}
        </div>
      )}

      <div>
        <button
          onClick={() => restart.mutate()}
          disabled={!installed || isRestarting}
          style={{
            display: "inline-flex", alignItems: "center", gap: 'var(--hms-space-2)',
            padding: "5px 12px", borderRadius: 6,
            border: "1px solid var(--hms-border)",
            background: (!installed || isRestarting) ? "var(--hms-bg)" : "var(--hms-surface)",
            color: (!installed || isRestarting) ? "var(--hms-text-muted)" : "var(--hms-text)",
            fontSize: 'var(--hms-text-caption)',
            cursor: (!installed || isRestarting) ? "not-allowed" : "pointer",
            opacity: (!installed || isRestarting) ? 0.6 : 1,
          }}
        >
          <RefreshCw size={12} className={isRestarting ? "hms-spin" : undefined} />
          {isRestarting ? t.connection.restartingGateway : t.connection.restartGateway}
        </button>
      </div>

      {restart.isError && (
        <div style={{ fontSize: 'var(--hms-text-xs)', color: "var(--hms-error-text)" }}>
          Action failed: {(restart.error as Error).message}
        </div>
      )}
      {restart.data && restart.data.status >= 400 && (
        <div style={{ fontSize: 'var(--hms-text-xs)', color: "var(--hms-text-muted)" }}>
          Server: {
            (restart.data.body && typeof restart.data.body === "object"
              && "reason" in restart.data.body
              ? String((restart.data.body as { reason: unknown }).reason)
              : null)
            ?? `HTTP ${restart.data.status}`
          }
        </div>
      )}

      <div style={{ fontSize: 'var(--hms-text-xs)', color: "var(--hms-text-muted)", lineHeight: 1.6 }}>
        ⓘ {managerHint}
        <br />
        ⓘ {t.connection.restartGatewayHint}
      </div>
    </Section>
  );
}

export function SystemTab() {
  const { t } = useI18n();

  // Pause polling for RESTART_QUIET_MS after a restart so the console
  // isn't flooded with ERR_CONNECTION_REFUSED.
  const restartQuiet = useRestartQuiet();
  const { data: caps } = useQuery<{
    fsReadable: boolean;
    agentReady: boolean;
    dashboardReachable: boolean;
    gatewayReachable: boolean;
  }>({
    queryKey: ["caps-snapshot"],
    queryFn: () => api.get<{
      fsReadable: boolean;
      agentReady: boolean;
      dashboardReachable: boolean;
      gatewayReachable: boolean;
    }>("/api/capabilities"),
    enabled: !restartQuiet,
    refetchInterval: 10_000,
    staleTime: 5_000,
    retry: false,
    retryOnMount: false,
  });

  const lifecycleFetching = useIsLifecycleAwaiting();
  const { data: lifecycle, isFetched: lifecycleLoaded } = useQuery<LifecycleStatus>({
    queryKey: ["lifecycle-status"],
    queryFn: () => api.get<LifecycleStatus>("/api/lifecycle/status"),
    enabled: !restartQuiet,
    refetchInterval: lifecycleFetching ? 1_000 : 5_000,
    retry: false,
    retryOnMount: false,
  });

  return (
    <div
      id="system"
      style={{ display: "flex", flexDirection: "column", gap: 'var(--hms-space-4)' }}
    >
      <Section icon={<Cpu size={14} />} title={t.connection.stationSection}>
        <StatusRow label={t.capability.fs} ok={!!caps?.fsReadable} />
        <StatusRow label={t.capability.hermes} ok={!!caps?.agentReady} />
      </Section>

      <DashboardSection
        dashboard={lifecycle?.dashboard}
        reachable={!!caps?.dashboardReachable}
        loaded={lifecycleLoaded}
      />

      <GatewaySection
        gateway={lifecycle?.gateway}
        platform={lifecycle?.platform}
        reachable={!!caps?.gatewayReachable}
        loaded={lifecycleLoaded}
      />
      <Section icon={<Activity size={14} />} title={t.settings.diagnostics}>
        <DiagnosticsSection />
      </Section>
    </div>
  );
}
