import { useI18n } from "@/i18n";
import { useSkills, useToolsets } from "@/hooks/useSkills";
import { useSkillsSelection } from "@/store/panel-selection";
import SkillsSideList from "@/components/skills/SkillsSideList";
import SkillCard from "@/components/skills/SkillCard";
import ToolsetCard from "@/components/skills/ToolsetCard";
import McpServersView from "@/components/skills/McpServersView";
import PanelTwoColumn from "@/components/ui/PanelTwoColumn";
import PageTopBar from "@/components/layout/PageTopBar";

/**
 * Skills page. Left list = skill categories + a Toolsets entry; the content
 * pane shows the selected category's skill cards or all toolset cards.
 */
export default function SkillsPanel() {
  const { t } = useI18n();
  const s = t.skills;
  const { data: skills } = useSkills();
  const { data: toolsets } = useToolsets();
  const view = useSkillsSelection((st) => st.view);
  const setView = useSkillsSelection((st) => st.setView);

  let content: React.ReactNode;
  if (!view) {
    content = <Empty text={s?.selectASkill ?? "Select a category or Toolsets."} />;
  } else if (view.kind === "toolsets") {
    content = (
      <Grid>
        {(toolsets ?? []).map((ts) => <ToolsetCard key={ts.name} toolset={ts} />)}
      </Grid>
    );
  } else if (view.kind === "mcp") {
    content = <McpServersView />;
  } else {
    // "all" → every skill; "category" → that category's skills.
    const list = view.kind === "all"
      ? (skills ?? [])
      : (skills ?? []).filter((sk) => (sk.category?.trim() || "other") === view.key);
    content = (
      <Grid>
        {list.map((sk) => (
          <SkillCard key={sk.name} skill={sk} confirmUninstall={s?.confirmUninstall ?? "Uninstall skill"} />
        ))}
      </Grid>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <PageTopBar title={t.nav.skills} showProfileScope />
      <div style={{ flex: 1, minHeight: 0 }}>
        <PanelTwoColumn
          list={<SkillsSideList />}
          detail={content}
          hasSelection={view !== null}
          onBack={() => setView(null)}
          storageKey="skills"
        />
      </div>
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "var(--hms-space-6)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--hms-space-3)",
        maxWidth: "var(--hms-content-max-w)",
      }}
    >
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div style={{ padding: "var(--hms-space-6)" }}>
      <div style={{ padding: 32, border: "1px dashed var(--hms-border)", borderRadius: "var(--hms-radius-lg)", textAlign: "center", color: "var(--hms-text-muted)", fontSize: "var(--hms-text-sm)" }}>
        {text}
      </div>
    </div>
  );
}
