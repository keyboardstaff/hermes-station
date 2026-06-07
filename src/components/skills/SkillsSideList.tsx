import { useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Wrench, Folder, Server, LayoutGrid } from "lucide-react";
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

  // Default selection (desktop): the All-skills view.
  useEffect(() => {
    if (isMobile || view) return;
    setView({ kind: "all" });
  }, [view, setView, isMobile]);

  const toolsetsActive = view?.kind === "toolsets";
  const mcpActive = view?.kind === "mcp";

  return (
    <div className="hms-skills-sidelist">
      <div className="hms-skills-sidelist-head">
        <div className="hms-skills-sidelist-title-row">
          <span className="hms-skills-sidelist-label">{s?.listLabel ?? "Skills"}</span>
          <div className="hms-skills-sidelist-actions">
            <IconButton size="sm" title={s?.refresh ?? "Refresh"} onClick={() => refetch()}><RefreshCw size={12} /></IconButton>
            <IconButton size="sm" title={s?.install ?? "Install from Hub"} onClick={() => setInstallOpen(true)} style={{ color: "var(--hms-success-text)" }}><Plus size={13} /></IconButton>
          </div>
        </div>
        <SearchInput size="sm" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={s?.searchPlaceholder ?? "Search skills…"} />
      </div>

      <div className="hms-skills-sidelist-scroll">
        {isLoading && <div className="hms-skills-sidelist-msg">{s?.loading ?? "Loading…"}</div>}
        {isError && <div className="hms-skills-sidelist-msg" data-error>{s?.errorLoading ?? "Failed to load skills."}</div>}

        {!isLoading && !isError && (
          <>
            <button
              type="button"
              onClick={() => setView({ kind: "all" })}
              className="hms-skills-row"
              data-active={view?.kind === "all" || undefined}
            >
              <LayoutGrid size={13} className="hms-skills-row-icon" />
              <span className="hms-skills-row-name">{s?.allSkills ?? "All skills"}</span>
              <span className="hms-skills-row-count">{skills?.length ?? 0}</span>
            </button>

            {categories.map(({ category, count }) => {
              const active = view?.kind === "category" && view.key === category;
              return (
                <button
                  key={category}
                  type="button"
                  onClick={() => setView({ kind: "category", key: category })}
                  className="hms-skills-row"
                  data-active={active || undefined}
                >
                  <Folder size={13} className="hms-skills-row-icon" />
                  <span className="hms-skills-row-name">{category}</span>
                  <span className="hms-skills-row-count">{count}</span>
                </button>
              );
            })}

            <div className="hms-skills-row-divider" aria-hidden="true" />

            <button
              type="button"
              onClick={() => setView({ kind: "toolsets" })}
              className="hms-skills-row"
              data-active={toolsetsActive || undefined}
            >
              <Wrench size={13} className="hms-skills-row-icon" />
              <span className="hms-skills-row-name">{s?.toolsets ?? "Toolsets"}</span>
              {toolsets && <span className="hms-skills-row-count">{toolsets.length}</span>}
            </button>

            <button
              type="button"
              onClick={() => setView({ kind: "mcp" })}
              className="hms-skills-row"
              data-active={mcpActive || undefined}
            >
              <Server size={13} className="hms-skills-row-icon" />
              <span className="hms-skills-row-name">{t.mcp?.title ?? "MCP Servers"}</span>
              {mcp && <span className="hms-skills-row-count">{mcp.servers.length}</span>}
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
