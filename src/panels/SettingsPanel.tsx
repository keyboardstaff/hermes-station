import { Suspense, lazy, useEffect, useState } from "react";
import { useI18n } from "@/i18n";
import { useIsMobile } from "@/hooks/useBreakpoint";
import PageTopBar from "@/components/layout/PageTopBar";
import { AdvancedTab } from "@/components/settings/AdvancedTab";
import { PreferencesTab } from "@/components/settings/PreferencesTab";
import { AppearanceTab } from "@/components/settings/AppearanceTab";
import { SecurityTab } from "@/components/settings/SecurityTab";
import { SystemTab } from "@/components/settings/SystemTab";
import SegmentedControl from "@/components/ui/SegmentedControl";

// Capability pages (folded in from the sidebar) render their own panels lazily.
const ModelsPanel = lazy(() => import("@/panels/ModelsPanel"));
const PluginsPanel = lazy(() => import("@/panels/PluginsPanel"));
const ChannelsPanel = lazy(() => import("@/panels/ChannelsPanel"));

// §Capabilities (the agent's config — Models / Plugins / Channels, embedded
// panels) + §Application (Station settings; Advanced = the raw config.yaml
// editor, last). Each is its own HERMES_HOME-aware surface.
type Section =
  | "models" | "plugins" | "channels"
  | "preferences" | "appearance" | "security" | "system" | "advanced";

const CAPABILITIES: Section[] = ["models", "plugins", "channels"];
const APPLICATION: Section[] = ["preferences", "appearance", "security", "system", "advanced"];
const ALL_SECTIONS: Section[] = [...CAPABILITIES, ...APPLICATION];

const SETTINGS_TAB_KEY = "hms:settings:tab";

/** Normalise a requested key to a real section. Legacy aliases stay supported
 *  (connection→system, theme→appearance, config→advanced). */
function normalizeSection(key: string | undefined): Section | null {
  if (!key) return null;
  if (key === "connection") return "system";
  if (key === "theme") return "appearance";
  if (key === "config") return "advanced";
  return (ALL_SECTIONS as string[]).includes(key) ? (key as Section) : null;
}

/** Initial section: explicit request > localStorage > default. */
function readInitial(initialTab?: string): Section {
  const requested = normalizeSection(initialTab);
  if (requested) return requested;
  try {
    const s = localStorage.getItem(SETTINGS_TAB_KEY);
    if (s && (ALL_SECTIONS as string[]).includes(s)) return s as Section;
  } catch { /* localStorage disabled */ }
  return "preferences";
}

export default function SettingsPanel({ initialTab }: { initialTab?: string } = {}) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const [section, setSection] = useState<Section>(() => readInitial(initialTab));

  useEffect(() => {
    try { localStorage.setItem(SETTINGS_TAB_KEY, section); } catch { /* localStorage disabled */ }
  }, [section]);

  const label = (s: Section): string =>
    s === "models" ? t.nav.models
      : s === "plugins" ? t.nav.plugins
      : s === "channels" ? t.nav.channels
      : (t.settings.tabs[s] ?? s);

  // The embedded capability panels bring their own full-page chrome (topbar +
  // scope selector); the Application tabs are plain content that scrolls.
  const Panel =
    section === "models" ? ModelsPanel
      : section === "plugins" ? PluginsPanel
        : section === "channels" ? ChannelsPanel
          : null;

  const pane = (
    <div className="hms-settings-pane">
      {Panel ? (
        <Suspense fallback={null}><Panel /></Suspense>
      ) : (
        <div className="hms-settings-pane-scroll">
          {section === "advanced" ? (
            <AdvancedTab />
          ) : (
            <div className="hms-settings-section">
              {section === "preferences" && <PreferencesTab />}
              {section === "appearance" && <AppearanceTab />}
              {section === "security" && <SecurityTab />}
              {section === "system" && <SystemTab />}
            </div>
          )}
        </div>
      )}
    </div>
  );

  // Mobile: full-screen + narrow, so a left rail would starve the content —
  // keep a horizontal (scrollable) segmented control on top.
  if (isMobile) {
    return (
      <div className="hms-settings">
        <PageTopBar
          title={t.nav.settings}
          context={
            <div className="hms-settings-segmented">
              <SegmentedControl
                value={section}
                onChange={setSection}
                ariaLabel={t.nav.settings}
                options={ALL_SECTIONS.map((s) => ({ value: s, label: label(s) }))}
              />
            </div>
          }
        />
        {pane}
      </div>
    );
  }

  const navItem = (s: Section) => (
    <button
      key={s}
      type="button"
      className="hms-sidebar-row hms-settings-nav-item"
      data-active={section === s}
      onClick={() => setSection(s)}
    >
      {label(s)}
    </button>
  );

  // Desktop: a left grouped section list + right detail (the page bar of an
  // embedded panel doubles as that section's header; the Settings bar above
  // keeps the close ✕ clear of the panel's own actions).
  return (
    <div className="hms-settings">
      <PageTopBar title={t.nav.settings} />
      <div className="hms-settings-2col">
        <nav className="hms-settings-nav" aria-label={t.nav.settings}>
          <div className="hms-settings-nav-group">{t.settings.groupCapabilities}</div>
          {CAPABILITIES.map(navItem)}
          <div className="hms-settings-nav-group">{t.settings.groupApplication}</div>
          {APPLICATION.map(navItem)}
        </nav>
        {pane}
      </div>
    </div>
  );
}
