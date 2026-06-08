import { useMemo, useState } from "react";
import { Search, RefreshCw } from "lucide-react";
import { useI18n } from "@/i18n";
import { usePlugins, type Plugin } from "@/hooks/usePlugins";
import CapabilityGate from "@/components/ui/CapabilityGate";
import PageTopBar from "@/components/layout/PageTopBar";
import IconButton from "@/components/ui/IconButton";
import PluginCard from "@/components/plugins/PluginCard";
import RuntimeProvidersCard from "@/components/plugins/RuntimeProvidersCard";
import GitInstallCard from "@/components/plugins/GitInstallCard";

/**
 * Plugins panel — single scrolling page: runtime-provider + git-install modules
 * on top, then the installed plugins as a flat column of cards grouped by
 * Memory / Active / Disabled (no master-detail list — every plugin's controls
 * are visible inline).
 */
export default function PluginsPanel() {
  const { t } = useI18n();
  const p = t.plugins;
  const { data, isLoading, isError, refetch } = usePlugins();
  const [query, setQuery] = useState("");

  const memoryProvider = data?.providers?.memory_provider;
  const memoryOptions = useMemo(
    () => new Set(data?.providers?.memory_options?.map((o) => o.name) ?? []),
    [data],
  );

  const groups = useMemo(() => {
    const plugins = data?.plugins ?? [];
    const q = query.trim().toLowerCase();
    const filtered = q
      ? plugins.filter(
          (pl) =>
            pl.name.toLowerCase().includes(q) ||
            pl.description?.toLowerCase().includes(q),
        )
      : plugins;
    const memory = filtered.filter((pl) => pl.name === memoryProvider);
    const active = filtered.filter(
      (pl) => pl.runtime_status === "enabled" && pl.name !== memoryProvider,
    );
    const disabled = filtered.filter((pl) => pl.runtime_status !== "enabled");
    const out: { label: string; items: Plugin[] }[] = [];
    if (memory.length) out.push({ label: p?.groupMemory ?? "Memory", items: memory });
    if (active.length) out.push({ label: p?.groupActive ?? "Active", items: active });
    if (disabled.length) out.push({ label: p?.groupDisabled ?? "Disabled", items: disabled });
    return out;
  }, [data, query, memoryProvider, p]);

  const hasResults = groups.length > 0;

  return (
    <CapabilityGate require="agent">
      <div className="hms-plugins">
        <PageTopBar
          title={t.nav.plugins}
          actions={
            <IconButton title={p?.refresh ?? "Refresh"} onClick={() => refetch()}>
              <RefreshCw size={14} />
            </IconButton>
          }
        />
        <div className="hms-plugins-scroll">
          <RuntimeProvidersCard />
          <GitInstallCard />

          <div className="hms-plugins-installed-head">
            <h3 className="hms-plugins-section">{p?.installedTitle ?? "Installed plugins"}</h3>
            <div className="hms-plugins-search">
              <Search size={13} className="hms-plugins-search-icon" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={p?.searchPlaceholder ?? "Search plugins…"}
                className="hms-plugins-search-input"
              />
            </div>
          </div>

          {isLoading && <div className="hms-plugins-msg">{p?.loading ?? "Loading…"}</div>}
          {isError && <div className="hms-plugins-msg hms-plugins-msg--error">{p?.errorLoading ?? "Failed to load plugins."}</div>}
          {!isLoading && !isError && !hasResults && (
            <div className="hms-plugins-msg">{p?.noPlugins ?? "No plugins found."}</div>
          )}

          {groups.map((group) => (
            <section key={group.label} className="hms-plugins-group">
              <div className="hms-plugins-group-label">{group.label}</div>
              <div className="hms-plugins-cards">
                {group.items.map((pl) => (
                  <PluginCard
                    key={pl.name}
                    plugin={pl}
                    memoryProvider={memoryProvider}
                    memoryOptions={memoryOptions}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </CapabilityGate>
  );
}
