import { useEffect, useMemo, useState } from "react";
import { Code, FormInput } from "lucide-react";
import { useProfiles } from "@/hooks/useProfiles";
import { useI18n } from "@/i18n";
import ConfigYamlEditor from "@/components/settings/ConfigYamlEditor";
import { ConfigForm } from "@/components/settings/ConfigForm";

type Mode = "form" | "yaml";

// Advanced = the config.yaml editor. Each Profile is its own HERMES_HOME with
// its own config.yaml, so the editor is profile-scoped (defaults to the default
// profile = ~/.hermes/config.yaml). FORM ⇄ YAML toggle aligned with upstream's
// dashboard ConfigPage: FORM is schema-driven (scalars); YAML is the raw file.
export function AdvancedTab() {
  const { t } = useI18n();
  const { data } = useProfiles();
  const profiles = useMemo(() => data?.profiles ?? [], [data]);
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("form");

  useEffect(() => {
    if (selected || profiles.length === 0) return;
    const def = profiles.find((p) => p.is_default) ?? profiles[0];
    setSelected(def.name);
  }, [profiles, selected]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 'var(--hms-space-3)', height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-3)', flexWrap: "wrap" }}>
        {profiles.length > 1 && (
          <div style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-2)' }}>
            <label htmlFor="adv-profile" style={{ fontSize: 'var(--hms-text-caption)', color: "var(--hms-text-muted)" }}>
              {t.nav.profile}
            </label>
            <select
              id="adv-profile"
              value={selected ?? ""}
              onChange={(e) => setSelected(e.target.value)}
              style={{
                padding: "4px 10px",
                borderRadius: 6,
                border: "1px solid var(--hms-border)",
                background: "var(--hms-bg)",
                color: "var(--hms-text)",
                fontSize: 'var(--hms-text-sm)',
              }}
            >
              {profiles.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}{p.is_default ? " · default" : ""}
                </option>
              ))}
            </select>
          </div>
        )}
        <div style={{ flex: 1 }} />
        {/* FORM ⇄ YAML toggle */}
        <div style={{ display: "inline-flex", border: "1px solid var(--hms-border)", borderRadius: 6, overflow: "hidden" }}>
          {(["form", "yaml"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 'var(--hms-space-1)',
                padding: "4px 12px", border: "none",
                background: mode === m ? "var(--hms-surface-hover, var(--hms-surface))" : "transparent",
                color: mode === m ? "var(--hms-text)" : "var(--hms-text-muted)",
                cursor: "pointer", fontSize: 'var(--hms-text-caption)',
                fontWeight: mode === m ? 600 : 400,
              }}
            >
              {m === "form" ? <FormInput size={12} /> : <Code size={12} />}
              {m === "form" ? t.config.formView : t.config.yamlView}
            </button>
          ))}
        </div>
      </div>

      {/* key={selected} remounts on profile switch — clean reload, no stale draft/edits. */}
      {selected && (mode === "form"
        ? <ConfigForm key={selected} profile={selected} />
        : <ConfigYamlEditor key={selected} profile={selected} />
      )}
    </div>
  );
}
