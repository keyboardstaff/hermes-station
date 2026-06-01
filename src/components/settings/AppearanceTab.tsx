import { useI18n } from "@/i18n";
import { useThemeStore } from "@/store/app";
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
  const { locale, setLocale } = useI18n();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 'var(--hms-space-5)' }}>
      {/* Theme — station light/dark/system axis. data-theme on <html>
          stays "light" or "dark"; system follows prefers-color-scheme. */}
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

      {/* Skin — accent personality on top of the Theme baseline. */}
      <SkinSelector />

      {/* Font size — root font-size scale. */}
      <FontSizeSelector />

      {/* Language picker (Station-only — locale doesn't roll into theme). */}
      <div>
        <div style={{ fontSize: 'var(--hms-text-caption)', color: "var(--hms-text-muted)", marginBottom: 8 }}>
          {t.theme.language}
        </div>
        <div style={{ display: "flex", gap: 'var(--hms-space-2)' }}>
          {(["en", "zh"] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLocale(l)}
              style={{
                padding: "6px 14px",
                borderRadius: 6,
                border: `1px solid ${locale === l ? "var(--hms-accent)" : "var(--hms-border)"}`,
                background: "var(--hms-surface)",
                color: "var(--hms-text)",
                cursor: "pointer",
                fontSize: 'var(--hms-text-caption)',
              }}
            >
              {l === "en" ? "English" : "中文"}
            </button>
          ))}
        </div>
      </div>

      {/* keep `t` referenced if no other strings hit; harmless once
          the section above starts pulling translations. */}
      <span style={{ display: "none" }}>{t.common.save}</span>
    </div>
  );
}
