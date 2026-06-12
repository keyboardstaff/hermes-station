import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Shield, Globe, PanelLeft } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { useDebouncedEffect } from "@/hooks/useDebouncedValue";
import { api, ApiError } from "@/lib/api";
import { Section } from "@/components/settings/shared";
import Switch from "@/components/ui/Switch";
import { NAV_ROUTES } from "@/routes/registry";
import { useSidebarNav, effectivePinned } from "@/store/sidebar-nav";

interface AdvancedSettings {
  max_concurrent_runs?: number;
  max_upload_bytes?: number;
  upload_retention_days?: number;
}

const MIB = 1024 * 1024;

// Preferences — Station-global knobs (operational limits + chat display).
// Lives in platforms.station.extra.* / chat store; NOT per-Profile config.yaml.
export function PreferencesTab() {
  const { t, locale, setLocale } = useI18n();
  const qc = useQueryClient();
  const { data: settings } = useQuery<AdvancedSettings>({
    queryKey: ["internal-settings"],
    queryFn: () => api.get<AdvancedSettings>("/api/settings"),
    staleTime: 60_000,
  });

  const [maxRuns, setMaxRuns] = useState(10);
  const [maxUploadMib, setMaxUploadMib] = useState(50);
  const [retentionDays, setRetentionDays] = useState(30);
  const [status, setStatus] = useState<"idle" | "saving" | "ok" | "err">("idle");
  const [error, setError] = useState("");
  const hydrated = useRef(false);

  useEffect(() => {
    if (!settings) return;
    setMaxRuns(settings.max_concurrent_runs ?? 10);
    setMaxUploadMib(Math.round((settings.max_upload_bytes ?? 50 * MIB) / MIB));
    setRetentionDays(settings.upload_retention_days ?? 30);
    hydrated.current = true;
  }, [settings]);

  const save = useCallback(async (payload: Record<string, number>) => {
    setStatus("saving");
    setError("");
    try {
      await api.json<unknown>("/api/settings", "PUT", payload);
      qc.invalidateQueries({ queryKey: ["internal-settings"] });
      qc.invalidateQueries({ queryKey: ["caps-snapshot"] });
      setStatus("ok");
      setTimeout(() => setStatus("idle"), 1500);
    } catch (err) {
      setStatus("err");
      setError(err instanceof ApiError && err.detail && typeof err.detail === "object" && "error" in err.detail
        ? String((err.detail as { error: unknown }).error)
        : err instanceof Error ? err.message : "save failed");
    }
  }, [qc]);

  useDebouncedEffect(() => {
    if (!hydrated.current) return;
    save({
      max_concurrent_runs: maxRuns,
      max_upload_bytes: maxUploadMib * MIB,
      upload_retention_days: retentionDays,
    });
  }, [maxRuns, maxUploadMib, retentionDays], 600);

  const label = t.settings.preferences!;

  return (
    <div id="preferences" style={{ display: "flex", flexDirection: "column", gap: 'var(--hms-space-4)' }}>
      <Section icon={<Globe size={14} />} title={t.theme.language}>
        <div style={{ display: "flex", gap: 'var(--hms-space-2)' }}>
          {(["en", "zh"] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLocale(l)}
              aria-pressed={locale === l}
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
      </Section>
      <Section icon={<Shield size={14} />} title={label.section}>
        <AdvField label={label.maxRuns} hint={label.maxRunsHint}>
          <AdvNumber value={maxRuns} min={1} max={100} onChange={setMaxRuns} />
        </AdvField>
        <AdvField label={label.maxUpload} hint={label.maxUploadHint}>
          <AdvNumber value={maxUploadMib} min={1} max={500} onChange={setMaxUploadMib} />
        </AdvField>
        <AdvField label={label.retention} hint={label.retentionHint}>
          <AdvNumber value={retentionDays} min={1} max={365} onChange={setRetentionDays} />
        </AdvField>
        <div style={{ fontSize: 'var(--hms-text-xs)', color: "var(--hms-text-muted)" }}>
          {status === "saving" && "…"}
          {status === "ok" && `✓ ${label.saved}`}
          {status === "err" && <span style={{ color: "var(--hms-error)" }}>{error}</span>}
        </div>
        <div style={{ fontSize: 'var(--hms-text-xs)', color: "var(--hms-text-muted)" }}>
          {label.restartHint}
        </div>
      </Section>
      <Section icon={<PanelLeft size={14} />} title={label.sidebarSection}>
        <SidebarButtonsConfig hint={label.sidebarHint} />
      </Section>
    </div>
  );
}

/** Which nav routes are pinned directly in the sidebar — enabled here means
 *  shown as a button; everything else collapses under the sidebar's More. */
function SidebarButtonsConfig({ hint }: { hint: string }) {
  const { t } = useI18n();
  const pinnedPaths = useSidebarNav((s) => s.pinnedPaths);
  const togglePinned = useSidebarNav((s) => s.togglePinned);
  const pinned = effectivePinned(pinnedPaths);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 'var(--hms-space-2)' }}>
      <div style={{ fontSize: 'var(--hms-text-xs)', color: "var(--hms-text-muted)" }}>{hint}</div>
      {NAV_ROUTES.map(({ path, labelKey, icon: Icon }) => (
        <div
          key={path}
          style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-2)' }}
        >
          <Icon size={14} style={{ color: "var(--hms-text-muted)", flexShrink: 0 }} />
          <span style={{ flex: 1, fontSize: 'var(--hms-text-caption)' }}>
            {t.nav[labelKey] ?? labelKey}
          </span>
          <Switch checked={pinned.includes(path)} onChange={() => togglePinned(path)} />
        </div>
      ))}
    </div>
  );
}

function AdvField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 'var(--hms-space-1)' }}>
      <label style={{ fontSize: 'var(--hms-text-caption)', fontWeight: 500 }}>{label}</label>
      {children}
      {hint && <div style={{ fontSize: 'var(--hms-text-xs)', color: "var(--hms-text-muted)" }}>{hint}</div>}
    </div>
  );
}

function AdvNumber({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(e) => {
        const n = Number(e.target.value);
        if (!Number.isFinite(n)) return;
        onChange(Math.max(min, Math.min(max, Math.round(n))));
      }}
      style={{
        width: 120,
        padding: "4px 8px",
        background: "var(--hms-bg)",
        color: "var(--hms-text)",
        border: "1px solid var(--hms-border)",
        borderRadius: 4,
        fontSize: 'var(--hms-text-sm)',
      }}
    />
  );
}
