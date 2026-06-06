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
/** Normalise a requested tab key to a real tab. Legacy aliases stay supported
 *  for callers (connection→system, theme→appearance, config→advanced). */
function normalizeTab(key: string | undefined): Tab | null {
  if (!key) return null;
  if (key === "connection") return "system";
  if (key === "theme") return "appearance";
  if (key === "config") return "advanced";
  return (ALL_TABS as string[]).includes(key) ? (key as Tab) : null;
}

/** Initial tab: an explicit request (the modal's `initialTab`) > localStorage > default. */
function readTabInitial(initialTab?: string): Tab {
  const requested = normalizeTab(initialTab);
  if (requested) return requested;
  try {
    const s = localStorage.getItem(SETTINGS_TAB_KEY);
    if (s && (ALL_TABS as string[]).includes(s)) return s as Tab;
  } catch { /* localStorage disabled */ }
  return "preferences";
}

export default function SettingsPanel({ initialTab }: { initialTab?: string } = {}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>(() => readTabInitial(initialTab));

  // Persist selected tab to localStorage (so the modal reopens on the last tab).
  useEffect(() => {
    try { localStorage.setItem(SETTINGS_TAB_KEY, tab); } catch { /* localStorage disabled */ }
  }, [tab]);

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
