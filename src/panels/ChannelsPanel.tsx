import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, RefreshCw } from "lucide-react";
import { useI18n } from "@/i18n";
import PageTopBar from "@/components/layout/PageTopBar";
import IconButton from "@/components/ui/IconButton";
import CapabilityGate from "@/components/ui/CapabilityGate";
import ChannelCard, { type MessagingPlatform } from "@/components/channels/ChannelCard";
import { api } from "@/lib/api";

/**
 * Channels panel — 1:1 with the upstream dashboard's messaging-platform
 * management: each platform card shows its live state and supports
 * enable/disable, credential configuration (env fields with required/secret
 * metadata) and a connectivity test, all through the dashboard proxy
 * (`/api/dashboard/messaging/platforms`).
 */
export default function ChannelsPanel() {
  const { t } = useI18n();
  const ch = t.channels;

  const platformsQuery = useQuery<{ platforms: MessagingPlatform[] }>({
    queryKey: ["messaging-platforms"],
    queryFn: () => api.get<{ platforms: MessagingPlatform[] }>("/api/dashboard/messaging/platforms"),
    refetchInterval: 5_000,
    staleTime: 2_000,
    retry: 1,
  });

  const [query, setQuery] = useState("");
  const platforms = useMemo(() => platformsQuery.data?.platforms ?? [], [platformsQuery.data]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return platforms;
    return platforms.filter(
      (p) => p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q),
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
            onClick={() => { void platformsQuery.refetch(); }}
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
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          gap: "var(--hms-space-3)",
          alignItems: "start",
        }}
      >
        {filtered.map((p) => (
          <ChannelCard
            key={p.id}
            platform={p}
            onChanged={() => void platformsQuery.refetch()}
            labels={{
              configure: ch?.configure ?? "Configure",
              test: ch?.test ?? "Test",
              testing: ch?.testing ?? "Testing…",
              save: t.common.save,
              cancel: t.common.cancel,
              clear: ch?.clear ?? "Clear",
              restartHint: ch?.restartHint ?? "Takes effect after a gateway restart.",
            }}
          />
        ))}
      </div>
      </div>
    </div>
    </CapabilityGate>
  );
}
