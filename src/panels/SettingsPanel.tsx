import { useEffect, useState } from "react";
import { useI18n } from "@/i18n";
import PageTopBar from "@/components/layout/PageTopBar";
import { AdvancedTab } from "@/components/settings/AdvancedTab";
import { PreferencesTab } from "@/components/settings/PreferencesTab";
import { AppearanceTab } from "@/components/settings/AppearanceTab";
import { SecurityTab } from "@/components/settings/SecurityTab";
import { SystemTab } from "@/components/settings/SystemTab";
import SegmentedControl from "@/components/ui/SegmentedControl";

// Preferences (Station-global knobs) · Appearance · Security · System
// (integration + runtime status) · Advanced (the config.yaml editor).
type Tab = "preferences" | "appearance" | "security" | "system" | "advanced";

const ALL_TABS: Tab[] = ["preferences", "appearance", "security", "system", "advanced"];

const SETTINGS_TAB_KEY = "hms:settings:tab";

/** Resolve tab from the current hash (used for deep links). */
function readTabFromHash(): Tab {
  if (typeof window === "undefined") return "preferences";
  const h = window.location.hash.replace(/^#/, "");
  // Old keys kept deep-link-compatible: connection→system, theme→appearance,
  // config→advanced (the raw config.yaml editor is now the Advanced tab).
  if (h === "connection") return "system";
  if (h === "theme") return "appearance";
  if (h === "config") return "advanced";
  return (ALL_TABS as string[]).includes(h) ? (h as Tab) : "preferences";
}

/** Initial tab: deep-link hash > localStorage > default. */
function readTabInitial(): Tab {
  if (typeof window === "undefined") return "preferences";
  if (window.location.hash.replace(/^#/, "")) return readTabFromHash();
  try {
    const s = localStorage.getItem(SETTINGS_TAB_KEY);
    if (s && (ALL_TABS as string[]).includes(s)) return s as Tab;
  } catch { /* localStorage disabled */ }
  return "preferences";
}

export default function SettingsPanel() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>(readTabInitial);

  // Consume deep-link hash on mount so URL stays clean (/settings, not /settings#system).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  // Persist selected tab to localStorage (no URL changes on manual tab switch).
  useEffect(() => {
    try { localStorage.setItem(SETTINGS_TAB_KEY, tab); } catch { /* localStorage disabled */ }
  }, [tab]);

  // Sync from in-app deep links (e.g. navigate("/settings#connection")).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onHash = () => {
      setTab(readTabFromHash());
      window.history.replaceState(null, "", window.location.pathname);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <PageTopBar
        title={t.nav.settings}
        context={
          <div style={{ display: "flex", overflowX: "auto" }}>
            <SegmentedControl
              value={tab}
              onChange={setTab}
              ariaLabel={t.nav.settings}
              options={ALL_TABS.map((tabKey) => ({
                value: tabKey,
                label: t.settings.tabs[tabKey] ?? tabKey,
              }))}
            />
          </div>
        }
      />
      <div style={{ flex: 1, overflow: "auto", padding: 'var(--hms-space-6)' }}>
        {tab === "advanced" ? (
          // The config.yaml editor (profile-scoped) wants the full pane width.
          <AdvancedTab />
        ) : (
          <div style={{ maxWidth: "var(--hms-content-max-w)" }}>
            {tab === "preferences" && <PreferencesTab />}
            {tab === "appearance" && <AppearanceTab />}
            {tab === "security" && <SecurityTab />}
            {tab === "system" && <SystemTab />}
          </div>
        )}
      </div>
    </div>
  );
}
