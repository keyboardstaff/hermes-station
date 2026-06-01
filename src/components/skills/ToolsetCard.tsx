import type { Toolset } from "@/hooks/useSkills";
import Card from "@/components/ui/Card";
import StatusBadge from "@/components/ui/StatusBadge";

/**
 * Toolset card — label, active/inactive state, description, and the tool
 * names it exposes as chips. Read-only (toggling lives in config).
 */
export default function ToolsetCard({ toolset }: { toolset: Toolset }) {
  return (
    <Card style={{ display: "flex", flexDirection: "column", gap: "var(--hms-space-2)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--hms-space-2)" }}>
        <span style={{ flex: 1, fontSize: "var(--hms-text-sm)", fontWeight: 600 }}>{toolset.label}</span>
        <StatusBadge tone={toolset.enabled ? "success" : "muted"}>
          {toolset.enabled ? "active" : "inactive"}
        </StatusBadge>
      </div>
      {toolset.description && (
        <div style={{ fontSize: "var(--hms-text-xs)", color: "var(--hms-text-muted)", lineHeight: 1.5 }}>
          {toolset.description}
        </div>
      )}
      {toolset.tools.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--hms-space-1)" }}>
          {toolset.tools.map((tool) => (
            <code
              key={tool}
              style={{
                fontSize: "0.625rem",
                fontFamily: "monospace",
                padding: "2px 6px",
                borderRadius: "var(--hms-radius-sm)",
                background: "var(--hms-hover-bg)",
                color: "var(--hms-text-muted)",
              }}
            >
              {tool}
            </code>
          ))}
        </div>
      )}
    </Card>
  );
}
