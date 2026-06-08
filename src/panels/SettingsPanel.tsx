import { useEffect, useState } from "react";
import { useI18n } from "@/i18n";
import { useIsMobile } from "@/hooks/useBreakpoint";
import PageTopBar from "@/components/layout/PageTopBar";
import { AdvancedTab } from "@/components/settings/AdvancedTab";
import { PreferencesTab } from "@/components/settings/PreferencesTab";
import { AppearanceTab } from "@/components/settings/AppearanceTab";
import { SecurityTab } from "@/components/settings/SecurityTab";
import { SystemTab } from "@/components/settings/SystemTab";
import SegmentedControl from "@/components/ui/SegmentedControl";

// Preferences (Station-global knobs) · Appearance · Security · System
// (integration + runtime status) · Advanced (the config.yaml editor — last,
// it's the raw/destructive power-user surface).
type Tab = "preferences" | "appearance" | "security" | "system" | "advanced";

const ALL_TABS: Tab[] = ["preferences", "appearance", "security", "system", "advanced"];

const SETTINGS_TAB_KEY = "hms:settings:tab";

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
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<Tab>(() => readTabInitial(initialTab));

  // Persist selected tab to localStorage (so the modal reopens on the last tab).
  useEffect(() => {
    try { localStorage.setItem(SETTINGS_TAB_KEY, tab); } catch { /* localStorage disabled */ }
  }, [tab]);

  // The Advanced (config.yaml) editor wants the full pane width; the other tabs
  // read more comfortably capped.
  const body = (
    <div className="hms-settings-body">
      {tab === "advanced" ? (
        <AdvancedTab />
      ) : (
        <div className="hms-settings-section">
          {tab === "preferences" && <PreferencesTab />}
          {tab === "appearance" && <AppearanceTab />}
          {tab === "security" && <SecurityTab />}
          {tab === "system" && <SystemTab />}
        </div>
      )}
    </div>
  );

  // Mobile: the modal is full-screen and narrow, so a left rail would starve the
  // content — keep the horizontal segmented control on top.
  if (isMobile) {
    return (
      <div className="hms-settings">
        <PageTopBar
          title={t.nav.settings}
          context={
            <div className="hms-settings-segmented">
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
        {body}
      </div>
    );
  }

  // Desktop: a left vertical section list + right detail (two-column, matching
  // the rest of the app's list-detail panels).
  return (
    <div className="hms-settings">
      <PageTopBar title={t.nav.settings} />
      <div className="hms-settings-2col">
        <nav className="hms-settings-nav" aria-label={t.nav.settings}>
          {ALL_TABS.map((tabKey) => (
            <button
              key={tabKey}
              type="button"
              className="hms-sidebar-row hms-settings-nav-item"
              data-active={tab === tabKey}
              onClick={() => setTab(tabKey)}
            >
              {t.settings.tabs[tabKey] ?? tabKey}
            </button>
          ))}
        </nav>
        {body}
      </div>
    </div>
  );
}
