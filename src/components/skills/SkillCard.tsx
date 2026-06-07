import { Power, PowerOff, Trash2, Loader } from "lucide-react";
import { useToggleSkill, useUninstallSkill, type Skill } from "@/hooks/useSkills";
import Card from "@/components/ui/Card";
import StatusBadge from "@/components/ui/StatusBadge";
import IconButton from "@/components/ui/IconButton";

const SOURCE_TONE: Record<string, "muted" | "success" | "accent" | "warning"> = {
  bundled: "muted",
  user: "success",
  community: "accent",
  hub: "accent",
  git: "accent",
  hf: "warning",
  unknown: "muted",
};

/**
 * Skill card — name, description, source, and an enable/disable toggle.
 * Uninstall (non-bundled) shows on hover. Used in the Skills category view.
 */
export default function SkillCard({ skill, confirmUninstall }: { skill: Skill; confirmUninstall: string }) {
  const toggle = useToggleSkill();
  const uninstall = useUninstallSkill();

  // Toolsets-card style: a plain Card (no accent bar) with a label + state badge
  // header, a source/category meta row, and the description. Toggle + uninstall
  // are compact icon buttons in the header.
  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: "var(--hms-space-2)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--hms-space-2)" }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: "var(--hms-text-sm)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {skill.name}
        </span>
        <IconButton
          size="sm"
          title={skill.enabled ? "Disable" : "Enable"}
          onClick={() => toggle.mutate({ name: skill.name, enabled: !skill.enabled })}
          disabled={toggle.isPending}
        >
          {skill.enabled ? <Power size={12} /> : <PowerOff size={12} />}
        </IconButton>
        {skill.can_remove && (
          <IconButton
            size="sm"
            danger
            title="Uninstall"
            onClick={() => { if (window.confirm(`${confirmUninstall} ${skill.name}?`)) uninstall.mutate(skill.name); }}
          >
            {uninstall.isPending ? <Loader size={12} className="hms-spin" /> : <Trash2 size={12} />}
          </IconButton>
        )}
        <StatusBadge tone={skill.enabled ? "success" : "muted"}>
          {skill.enabled ? "active" : "inactive"}
        </StatusBadge>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--hms-space-1)" }}>
        <StatusBadge tone={SOURCE_TONE[skill.source] ?? "muted"}>{skill.source}</StatusBadge>
        {skill.category && (
          <span style={{ fontSize: "0.625rem", color: "var(--hms-text-muted)" }}>{skill.category}</span>
        )}
      </div>
      {skill.description && (
        <div style={{ fontSize: "var(--hms-text-xs)", color: "var(--hms-text-muted)", lineHeight: 1.5 }}>
          {skill.description}
        </div>
      )}
    </Card>
  );
}
