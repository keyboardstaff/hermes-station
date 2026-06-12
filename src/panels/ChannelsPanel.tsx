import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
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

      {/* Search — adaptive full width */}
      <input
        type="text"
        className="hms-input"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={ch?.searchPlaceholder ?? "Search channels…"}
      />

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

      {/* Cards — single column */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--hms-space-3)",
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
