import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Wrench, Folder, Server } from "lucide-react";
import { useI18n } from "@/i18n";
import { useSkills, useToolsets } from "@/hooks/useSkills";
import { useMcpServers } from "@/hooks/useMcp";
import { useSkillsSelection } from "@/store/panel-selection";
import { useIsMobile } from "@/hooks/useBreakpoint";
import SearchInput from "@/components/ui/SearchInput";
import IconButton from "@/components/ui/IconButton";
import SkillInstallDialog from "@/components/skills/SkillInstallDialog";

/**
 * Sidebar list for ``/skills`` — skill categories + a Toolsets entry.
 * Selecting a category shows its skill cards in the content pane; selecting
 * Toolsets shows all toolset cards. Selection lives in useSkillsSelection.
 */
export default function SkillsSideList() {
  const { t } = useI18n();
  const s = t.skills;
  const { data: skills, isLoading, isError, refetch } = useSkills();
  const { data: toolsets } = useToolsets();

  const { data: mcp } = useMcpServers();

  const view = useSkillsSelection((st) => st.view);
  const setView = useSkillsSelection((st) => st.setView);

  const [query, setQuery] = useState("");
  const [installOpen, setInstallOpen] = useState(false);
  const isMobile = useIsMobile();

  /** Categories with skill counts, "other" last. */
  const categories = useMemo(() => {
    const map = new Map<string, number>();
    for (const sk of skills ?? []) {
      const key = sk.category?.trim() || "other";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    const q = query.trim().toLowerCase();
    return Array.from(map.entries())
      .filter(([k]) => !q || k.toLowerCase().includes(q))
      .sort(([a], [b]) => (a === "other" ? 1 : b === "other" ? -1 : a.localeCompare(b)))
      .map(([category, count]) => ({ category, count }));
  }, [skills, query]);

  // Default selection (desktop): first category once data lands.
  useEffect(() => {
    if (isMobile || view || categories.length === 0) return;
    setView({ kind: "category", key: categories[0].category });
  }, [categories, view, setView, isMobile]);

  const rowStyle = (active: boolean): React.CSSProperties => ({
    display: "flex", alignItems: "center", gap: "var(--hms-space-2)", width: "100%",
    padding: "7px 10px", border: "none", borderRadius: "var(--hms-radius-md)",
    background: active ? "var(--hms-selected-bg)" : "transparent",
    color: active ? "var(--hms-text)" : "var(--hms-text-muted)",
    cursor: "pointer", textAlign: "left", fontSize: "var(--hms-text-sm)",
  });

  const toolsetsActive = view?.kind === "toolsets";
  const mcpActive = view?.kind === "mcp";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--hms-space-2)", padding: "var(--hms-space-3)", height: "100%", boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: "0.625rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--hms-text-muted)" }}>
          {s?.listLabel ?? "Skills"}
        </span>
        <div style={{ display: "flex", gap: "var(--hms-space-1)" }}>
          <IconButton size="sm" title={s?.refresh ?? "Refresh"} onClick={() => refetch()}><RefreshCw size={12} /></IconButton>
          <IconButton size="sm" title={s?.install ?? "Install from Hub"} onClick={() => setInstallOpen(true)} style={{ color: "var(--hms-success-text)" }}><Plus size={13} /></IconButton>
        </div>
      </div>

      <SearchInput size="sm" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={s?.searchPlaceholder ?? "Search skills…"} />

      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 'var(--hms-space-1)' }}>
        {isLoading && <div style={{ padding: 10, fontSize: "var(--hms-text-xs)", color: "var(--hms-text-muted)" }}>{s?.loading ?? "Loading…"}</div>}
        {isError && <div style={{ padding: 10, fontSize: "var(--hms-text-xs)", color: "var(--hms-error-text)" }}>{s?.errorLoading ?? "Failed to load skills."}</div>}

        {!isLoading && !isError && (
          <>
            {categories.map(({ category, count }) => {
              const active = view?.kind === "category" && view.key === category;
              return (
                <button key={category} type="button" onClick={() => setView({ kind: "category", key: category })} style={rowStyle(active)}>
                  <Folder size={13} style={{ flexShrink: 0 }} />
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{category}</span>
                  <span style={{ fontSize: "0.625rem", color: "var(--hms-text-muted)" }}>{count}</span>
                </button>
              );
            })}

            <div style={{ height: 1, background: "var(--hms-border)", margin: "var(--hms-space-2) 0" }} aria-hidden="true" />

            <button type="button" onClick={() => setView({ kind: "toolsets" })} style={rowStyle(toolsetsActive)}>
              <Wrench size={13} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1 }}>{s?.toolsets ?? "Toolsets"}</span>
              {toolsets && <span style={{ fontSize: "0.625rem", color: "var(--hms-text-muted)" }}>{toolsets.length}</span>}
            </button>

            <button type="button" onClick={() => setView({ kind: "mcp" })} style={rowStyle(mcpActive)}>
              <Server size={13} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1 }}>{t.mcp?.title ?? "MCP Servers"}</span>
              {mcp && <span style={{ fontSize: "0.625rem", color: "var(--hms-text-muted)" }}>{mcp.servers.length}</span>}
            </button>
          </>
        )}
      </div>

      <SkillInstallDialog
        open={installOpen}
        onClose={() => setInstallOpen(false)}
        labels={{
          title: s?.install ?? "Install skill",
          identifierLabel: s?.identifierLabel ?? "Identifier",
          identifierHint: s?.identifierHint ?? "Hub alias, git URL, or HF identifier.",
          install: s?.installBtn ?? "Install",
          installing: s?.installing ?? "Installing…",
          cancel: s?.cancel ?? "Cancel",
          close: s?.close ?? "Close",
          enable: s?.enableAfterInstall ?? "Enable after install",
          force: s?.forceReinstall ?? "Force reinstall",
          installSuccess: s?.installSuccess ?? "Installed:",
        }}
      />
    </div>
  );
}
