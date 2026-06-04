import { Check } from "lucide-react";
import { useI18n } from "@/i18n";
import { useThemeStore, useToolViewStore, type ToolViewMode } from "@/store/app";
import SkinSelector from "@/components/settings/SkinSelector";
import FontSizeSelector from "@/components/settings/FontSizeSelector";

const THEME_FALLBACK: Record<"light" | "dark" | "system", string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

export function AppearanceTab() {
  const { t } = useI18n();
  const { theme, setTheme } = useThemeStore();
  const { toolView, setToolView } = useToolViewStore();

  const toolOptions: { id: ToolViewMode; label: string; hint: string }[] = [
    { id: "product", label: t.theme.product, hint: t.theme.productHint },
    { id: "technical", label: t.theme.technical, hint: t.theme.technicalHint },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 'var(--hms-space-5)' }}>
      {/* Color Mode — light/dark/system axis. data-theme on <html> stays
          "light" or "dark"; system follows prefers-color-scheme. */}
      <div>
        <div style={{ fontSize: 'var(--hms-text-caption)', color: "var(--hms-text-muted)", marginBottom: 8 }}>
          {t.theme.sectionLabel}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 'var(--hms-space-2)' }}>
          {(["light", "dark", "system"] as const).map((th) => (
            <button
              key={th}
              onClick={() => setTheme(th)}
              aria-pressed={theme === th}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 'var(--hms-space-2)',
                padding: "12px 8px",
                borderRadius: 8,
                border: `1px solid ${theme === th ? "var(--hms-accent)" : "var(--hms-border)"}`,
                boxShadow: theme === th ? "0 0 0 1px var(--hms-accent)" : "none",
                background: "var(--hms-surface)",
                color: "var(--hms-text)",
                cursor: "pointer",
                fontSize: 'var(--hms-text-caption)',
                transition: "border-color 150ms, box-shadow 150ms",
              }}
            >
              {/* Tiny visual preview matching the screenshot mockup */}
              <span
                aria-hidden
                style={{
                  width: 56, height: 22, borderRadius: 4,
                  background: th === "light"
                    ? "#ffffff"
                    : th === "dark"
                    ? "#0d0d0d"
                    : "linear-gradient(90deg, #ffffff 0%, #0d0d0d 100%)",
                  border: "1px solid var(--hms-border)",
                }}
              />
              <span>{(t.theme as unknown as Record<string, string>)?.[th] ?? THEME_FALLBACK[th]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Tool Call Display — Product (concise summary) vs Technical (raw
          args/results). Mirrors upstream desktop's Appearance setting. */}
      <div>
        <div style={{ fontSize: 'var(--hms-text-caption)', color: "var(--hms-text-muted)", marginBottom: 2 }}>
          {t.theme.toolCalls}
        </div>
        <div style={{ fontSize: 'var(--hms-text-xs)', color: "var(--hms-text-muted)", marginBottom: 8 }}>
          {t.theme.toolCallsHint}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 'var(--hms-space-2)' }}>
          {toolOptions.map((opt) => {
            const active = toolView === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => setToolView(opt.id)}
                aria-pressed={active}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 'var(--hms-space-1)',
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: `1px solid ${active ? "var(--hms-accent)" : "var(--hms-border)"}`,
                  boxShadow: active ? "0 0 0 1px var(--hms-accent)" : "none",
                  background: "var(--hms-surface)",
                  color: "var(--hms-text)",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "border-color 150ms, box-shadow 150ms",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", gap: 'var(--hms-space-2)' }}>
                  <span style={{ fontSize: 'var(--hms-text-caption)', fontWeight: 600 }}>{opt.label}</span>
                  {active && <Check size={14} style={{ color: "var(--hms-accent)", flexShrink: 0 }} />}
                </span>
                <span style={{ fontSize: 'var(--hms-text-xs)', color: "var(--hms-text-muted)" }}>{opt.hint}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Theme — accent palette ("skin") on top of the Color Mode baseline. */}
      <SkinSelector />

      {/* Font size — root font-size scale. */}
      <FontSizeSelector />
    </div>
  );
}
