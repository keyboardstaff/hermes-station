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

  const accent = skill.enabled ? "var(--hms-success)" : "var(--hms-muted)";

  return (
    <Card accent={accent} style={{ display: "flex", flexDirection: "column", gap: "var(--hms-space-2)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--hms-space-2)" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "var(--hms-text-sm)", fontWeight: 600, color: "var(--hms-text)" }}>{skill.name}</div>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--hms-space-1)", marginTop: 3 }}>
            <StatusBadge tone={SOURCE_TONE[skill.source] ?? "muted"}>{skill.source}</StatusBadge>
            {skill.category && (
              <span style={{ fontSize: "0.625rem", color: "var(--hms-text-muted)" }}>{skill.category}</span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => toggle.mutate({ name: skill.name, enabled: !skill.enabled })}
          disabled={toggle.isPending}
          title={skill.enabled ? "Disable" : "Enable"}
          style={{
            display: "inline-flex", alignItems: "center", gap: "var(--hms-space-1)",
            border: "1px solid var(--hms-border)", borderRadius: "var(--hms-radius-md)",
            background: "transparent", cursor: "pointer", padding: "3px 8px",
            fontSize: "var(--hms-text-xs)",
            color: skill.enabled ? "var(--hms-success-text)" : "var(--hms-text-muted)",
          }}
        >
          {skill.enabled ? <Power size={11} /> : <PowerOff size={11} />}
          {skill.enabled ? "On" : "Off"}
        </button>
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
      </div>
      {skill.description && (
        <div style={{ fontSize: "var(--hms-text-xs)", color: "var(--hms-text-muted)", lineHeight: 1.5 }}>
          {skill.description}
        </div>
      )}
    </Card>
  );
}
