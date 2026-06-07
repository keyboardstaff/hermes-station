import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search,
  RefreshCw,
  Plug,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "@/i18n";
import PageTopBar from "@/components/layout/PageTopBar";
import IconButton from "@/components/ui/IconButton";
import CapabilityGate from "@/components/ui/CapabilityGate";
import ChannelCard, { type PlatformRuntime } from "@/components/channels/ChannelCard";
import { useDiscoverPlatforms } from "@/store/discovery";
import { useCapabilityStore } from "@/store/capabilities";
import { api } from "@/lib/api";

/**
 * Channels panel.
 *
 * Lists every messaging platform discovered via ``/api/discover/platforms``
 * (station + telegram + discord + any plugin-registered platform).
 * Runtime status comes from the Dashboard's ``/api/status`` →
 * ``gateway_platforms`` map (running / circuit_open / broken / stopped).
 *
 * Platform credentials are not edited here — those live in
 * ``/models#keys`` under category=messaging. We surface a "Manage keys"
 * shortcut so the operator never has to guess where to fix a misconfigured
 * platform.
 */

// Shape of /api/dashboard/status's gateway_platforms entries is imported from ChannelCard.

interface StatusPayload {
  gateway_platforms?: Record<string, PlatformRuntime>;
}

export default function ChannelsPanel() {
  const { t } = useI18n();
  const ch = t.channels;
  const navigate = useNavigate();
  const { caps } = useCapabilityStore();
  const circuitFlag = !!caps?.flags?.platform_circuit_breaker;

  const platformsQuery = useDiscoverPlatforms();
  const statusQuery = useQuery<StatusPayload>({
    queryKey: ["dashboard-status-platforms"],
    queryFn: () => api.get<StatusPayload>("/api/dashboard/status"),
    refetchInterval: 5_000,
    staleTime: 2_000,
    retry: 1,
  });

  const [query, setQuery] = useState("");

  const platforms = useMemo(() => platformsQuery.data?.platforms ?? [], [platformsQuery.data]);
  const runtime = statusQuery.data?.gateway_platforms ?? {};

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return platforms;
    return platforms.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.label.toLowerCase().includes(q),
    );
  }, [platforms, query]);

  return (
    <CapabilityGate require="dashboard">
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <PageTopBar
        title={t.nav.channels}
        subtitle={
          platforms.length > 0
            ? `${platforms.length} ${ch?.platforms ?? "platforms"}`
            : ch?.platforms ?? "platforms"
        }
        actions={
          <IconButton
            title={ch?.refresh ?? "Refresh"}
            onClick={() => {
              void platformsQuery.refetch();
              void statusQuery.refetch();
            }}
          >
            <RefreshCw size={14} />
          </IconButton>
        }
      />
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: 'var(--hms-space-6)',
          display: "flex",
          flexDirection: "column",
          gap: 'var(--hms-space-4)',
        }}
      >

      {/* Manage keys hint */}
      <div className="hms-settings-notice hms-settings-notice--info" style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-2)' }}>
        <Plug size={12} style={{ color: "var(--hms-accent)" }} />
        <span style={{ flex: 1 }}>
          {ch?.keysHint ??
            "Platform credentials (bot tokens, webhook URLs) are managed under "}
          <button
            onClick={() => navigate("/models#keys")}
            style={{
              border: "none",
              background: "transparent",
              padding: 0,
              color: "var(--hms-accent)",
              cursor: "pointer",
              textDecoration: "underline",
              fontSize: 'var(--hms-text-xs)',
            }}
          >
            {ch?.keysLink ?? "Models → API Keys"}
          </button>
          .
        </span>
      </div>

      {/* Search */}
      <div style={{ position: "relative", maxWidth: 360 }}>
        <Search
          size={12}
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
          placeholder={ch?.searchPlaceholder ?? "Search channels…"}
          style={{
            width: "100%",
            padding: "5px 8px 5px 26px",
            fontSize: 'var(--hms-text-caption)',
            background: "var(--hms-bg)",
            border: "1px solid var(--hms-border)",
            borderRadius: 6,
            color: "var(--hms-text)",
            outline: "none",
            boxSizing: "border-box",
          }}
        />
      </div>

      {platformsQuery.isLoading && (
        <div style={{ padding: 'var(--hms-space-4)', color: "var(--hms-text-muted)", fontSize: 'var(--hms-text-sm)'}}>
          {ch?.loading ?? "Loading…"}
        </div>
      )}
      {platformsQuery.isError && (
        <div style={{ padding: 'var(--hms-space-4)', color: "var(--hms-error-text)", fontSize: 'var(--hms-text-sm)'}}>
          {ch?.errorLoading ?? "Failed to load channels."}
        </div>
      )}
      {!platformsQuery.isLoading && !platformsQuery.isError && filtered.length === 0 && (
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
          {query ? ch?.noMatches ?? "No platforms match the search." : ch?.noPlatforms ?? "No platforms discovered."}
        </div>
      )}

      {/* Cards — responsive CSS Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: "var(--hms-space-3)",
        }}
      >
        {filtered.map((p) => (
          <ChannelCard
            key={p.name}
            name={p.name}
            label={p.label}
            kind={p.kind}
            runtime={runtime[p.name]}
            circuitFlag={circuitFlag}
            labels={{
              builtin: ch?.builtin ?? "built-in",
              plugin: ch?.plugin ?? "plugin",
              running: ch?.running ?? "running",
              stopped: ch?.stopped ?? "stopped",
              broken: ch?.broken ?? "broken",
              circuitOpen: ch?.circuitOpen ?? "circuit open",
              statusUnknown: ch?.statusUnknown ?? "status unknown",
              inflight: ch?.inflight ?? "in flight",
              lastSeen: ch?.lastSeen ?? "Last seen",
              lastError: ch?.lastError ?? "Last error",
              circuitHint: ch?.circuitHint ?? "Toggle with /platform pause|resume in chat.",
              upstreamHint: ch?.upstreamHint ?? "Upstream does not expose pause/resume HTTP endpoints — use the chat slash command.",
            }}
          />
        ))}
      </div>
      </div>
    </div>
    </CapabilityGate>
  );
}
