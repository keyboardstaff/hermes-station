import { useState, useEffect } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { PanelLeftClose, PanelLeftOpen, Plus, MessageSquare, Activity } from "lucide-react";
import { useI18n } from "@/i18n";
import SearchInput from "@/components/ui/SearchInput";
import { useSidebarSearch } from "@/store/sidebar-search";
import { useChatStore } from "@/store/chat";
import { ROUTES, moduleNavTarget, type RouteModule } from "@/routes/registry";
import Tooltip from "@/components/ui/Tooltip";
import ConnectionDot from "./ConnectionDot";
import UserButton from "./UserButton";
import SidebarRecents from "./SidebarRecents";

const ICON_SIZE = 18;
const MODULE_STORAGE_KEY = "hms:sidebar:module";

/**
 * Unified Sidebar — module-switcher architecture (UI restructure S1).
 *
 * Layout (same sections in both states; only widths/labels change):
 *   • Header — brand + ConnectionDot + Fold toggle (Fold hidden on mobile)
 *   • Module tabs — 3 tabs switching the nav context (Agent / Tasks / Manage)
 *   • Primary action — "+ New session" for Agent module only
 *   • Module nav — routes for the active module (Manage has visual dividers)
 *   • Recents — only for Agent module when expanded
 *   • UserButton — always at the bottom
 *
 * activeModule persists to localStorage (key: `hms:sidebar:module`). On
 * route change the active module auto-follows the current path's module.
 */

// ── Module definitions ────────────────────────────────────────────

const MODULES: { id: RouteModule; icon: typeof MessageSquare; labelKey: "moduleAgent" | "moduleActivity" }[] = [
  { id: "agent",    icon: MessageSquare, labelKey: "moduleAgent" },
  { id: "activity", icon: Activity,      labelKey: "moduleActivity" },
];

function readStoredModule(): RouteModule {
  try {
    const v = localStorage.getItem(MODULE_STORAGE_KEY);
    if (v === "agent" || v === "activity") return v;
  } catch { /* private browsing */ }
  return "agent";
}

export default function Sidebar({
  collapsed = false,
  onToggleCollapsed,
  mobile = false,
  onNavigate,
  recentsLimit = 50,
}: {
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  mobile?: boolean;
  onNavigate?: () => void;
  recentsLimit?: number;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const search = useSidebarSearch((s) => s.query);
  const setSearch = useSidebarSearch((s) => s.setQuery);
  const setActiveSession = useChatStore((s) => s.setActiveSession);

  const [activeModule, setActiveModuleState] = useState<RouteModule>(readStoredModule);

  const setModule = (m: RouteModule) => {
    setActiveModuleState(m);
    try { localStorage.setItem(MODULE_STORAGE_KEY, m); } catch { /* ignore */ }
  };

  // Most-recently-updated session from the shared sessions cache (Recents/Sessions
  // populate it), or null if none/not loaded yet.
  const latestSessionId = (): string | null => {
    const data = queryClient.getQueryData<{
      sessions: Array<{ session_id: string; updated_at?: number; started_at?: number }>;
    }>(["sessions-table-all"]);
    const sessions = data?.sessions ?? [];
    if (sessions.length === 0) return null;
    return [...sessions].sort(
      (a, b) => (b.updated_at ?? b.started_at ?? 0) - (a.updated_at ?? a.started_at ?? 0),
    )[0].session_id;
  };

  // Clicking a module tab also navigates to that module's first route
  // otherwise the page stayed put while only the nav list changed.
  // moduleNavTarget returns null (stay) when already in the module, so an
  // in-module hidden route (e.g. /chat, /files) isn't yanked to its sibling.
  const handleModuleClick = (m: RouteModule) => {
    setModule(m);
    const target = moduleNavTarget(m, location.pathname);
    if (target) {
      // Entering the agent module lands on the most recent conversation (not the
      // /sessions list); fall back to the list when there are no sessions yet.
      const latest = m === "agent" ? latestSessionId() : null;
      if (latest) {
        setActiveSession(latest);
        navigate("/chat");
      } else {
        navigate(target);
      }
    }
    onNavigate?.();
  };

  // Auto-follow module when navigating directly to a route
  useEffect(() => {
    const route = ROUTES.find((r) => location.pathname.startsWith(r.path));
    if (route && route.module !== activeModule) {
      setModule(route.module);
    }
    // Intentionally not including activeModule in deps to avoid re-running on setModule
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Hidden routes (chat, files, settings, profile) stay reachable via other
  // affordances but never appear in the module nav list.
  const navRoutes = ROUTES
    .filter((r) => r.module === activeModule && !r.hidden)
    .sort((a, b) => a.order - b.order);

  const onNewChat = () => {
    setActiveSession(null);
    navigate("/chat");
    onNavigate?.();
  };

  const className = [
    "hms-sidebar-root",
    collapsed ? "collapsed" : "",
    mobile ? "mobile" : "",
  ].filter(Boolean).join(" ");

  return (
    <aside className={className} aria-label="Sidebar">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 'var(--hms-space-2)',
          padding: collapsed ? "10px 8px" : "10px 12px",
          minHeight: "var(--hms-header-h, 48px)",
          justifyContent: collapsed ? "center" : "space-between",
          flexShrink: 0,
        }}
      >
        {collapsed ? (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={t.nav.expandSidebar}
            disabled={!onToggleCollapsed}
            style={iconBtnStyle}
          >
            <PanelLeftOpen size={ICON_SIZE} />
          </button>
        ) : (
          <>
            <SearchInput
              size="sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.nav.searchSessions}
              aria-label={t.nav.searchSessions}
              style={{ flex: 1, minWidth: 0 }}
            />
            <ConnectionDot />
            {!mobile && onToggleCollapsed && (
              <button
                type="button"
                onClick={onToggleCollapsed}
                aria-label={t.nav.collapseSidebar}
                style={iconBtnStyle}
              >
                <PanelLeftClose size={ICON_SIZE} />
              </button>
            )}
          </>
        )}
      </div>

      {/* ── Module Tabs ─────────────────────────────────────────── */}
      {collapsed ? (
        /* Collapsed: stacked icon buttons */
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 2,
            padding: "4px 8px",
            flexShrink: 0,
          }}
        >
          {MODULES.map((m) => (
            <Tooltip key={m.id} label={t.nav[m.labelKey]} placement="right">
              <button
                type="button"
                onClick={() => handleModuleClick(m.id)}
                aria-label={t.nav[m.labelKey]}
                aria-pressed={activeModule === m.id}
                className="hms-module-tab"
              >
                <m.icon size={16} />
              </button>
            </Tooltip>
          ))}
        </div>
      ) : (
        /* Expanded: pill segmented control */
        <div className="hms-module-tabs">
          {MODULES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => handleModuleClick(m.id)}
              aria-pressed={activeModule === m.id}
              className="hms-module-tab"
            >
              <m.icon size={14} />
              <span>{t.nav[m.labelKey]}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Divider between module tabs and nav (collapsed only) ── */}
      {collapsed && (
        <div
          aria-hidden="true"
          style={{ height: 1, background: "var(--hms-border)", margin: "2px 10px 4px", flexShrink: 0 }}
        />
      )}

      {/* ── Primary Action (Agent module only) ──────────────────── */}
      {activeModule === "agent" && (
        <div style={{ padding: "4px 8px", flexShrink: 0 }}>
          {collapsed ? (
            <Tooltip label={t.nav.newSession} placement="right">
              <button
                type="button"
                onClick={onNewChat}
                aria-label={t.nav.newSession}
                className="hms-sidebar-row"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 36,
                  height: 36,
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  color: "var(--hms-text-muted)",
                }}
              >
                <Plus size={ICON_SIZE} />
              </button>
            </Tooltip>
          ) : (
            <button
              type="button"
              onClick={onNewChat}
              className="hms-sidebar-row"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                padding: "6px 10px",
                border: "none",
                borderRadius: 6,
                color: "var(--hms-text-muted)",
                cursor: "pointer",
                fontSize: 'var(--hms-text-sm)',
                textAlign: "left",
              }}
            >
              <Plus size={ICON_SIZE} />
              <span style={{ flex: 1 }}>{t.nav.newSession}</span>
              <kbd
                className="hms-shortcut-hint"
                style={{
                  fontSize: 'var(--hms-text-xs)',
                  color: "var(--hms-text-muted)",
                  background: "transparent",
                  border: "1px solid var(--hms-border)",
                  borderRadius: 4,
                  padding: "1px 5px",
                  fontFamily: "monospace",
                  letterSpacing: "0.2em",
                }}
              >
                {(typeof navigator !== "undefined" && navigator.platform.includes("Mac")) ? "⌃⌘N" : "Ctrl+Shift+N"}
              </kbd>
            </button>
          )}
        </div>
      )}

      {/* ── Module nav ─────────────────────────────────────────── */}
      <nav
        style={{
          display: "flex",
          flexDirection: "column",
          padding: "0 8px",
          gap: 1,
          flexShrink: 0,
          alignItems: collapsed ? "center" : "stretch",
        }}
      >
        {navRoutes.map(({ path, labelKey, icon: Icon }) => (
          <SidebarNavItem key={path}>
            <SidebarLink
              to={path}
              label={t.nav[labelKey] ?? labelKey}
              icon={<Icon size={ICON_SIZE} />}
              collapsed={collapsed}
              onClick={onNavigate}
            />
          </SidebarNavItem>
        ))}
      </nav>

      {/* ── Recents (Agent module, expanded only) ────────────────── */}
      {activeModule === "agent" && !collapsed && (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            marginTop: 4,
            position: "relative",
          }}
        >
          <SidebarRecents limit={recentsLimit} />
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: 24,
              background: "linear-gradient(to bottom, transparent, var(--hms-surface))",
              pointerEvents: "none",
            }}
          />
        </div>
      )}
      {(activeModule !== "agent" || collapsed) && <div style={{ flex: 1 }} />}

      {/* ── UserButton ──────────────────────────────────────────── */}
      <div style={{ padding: collapsed ? 6 : "8px 10px", flexShrink: 0 }}>
        <UserButton collapsed={collapsed} />
      </div>
    </aside>
  );
}

// ── SidebarNavItem wrapper ────────────────────────────────────────

function SidebarNavItem({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

// ── SidebarLink ───────────────────────────────────────────────────

function SidebarLink({
  to,
  label,
  icon,
  collapsed,
  onClick,
}: {
  to: string;
  label: string;
  icon: React.ReactNode;
  collapsed: boolean;
  onClick?: () => void;
}) {
  const link = (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        "hms-sidebar-row" + (isActive ? " active" : "")
      }
      style={({ isActive }) => ({
        display: "flex",
        alignItems: "center",
        gap: collapsed ? 0 : 10,
        padding: collapsed ? "8px" : "6px 10px",
        borderRadius: 6,
        color: isActive ? "var(--hms-text)" : "var(--hms-text-muted)",
        textDecoration: "none",
        fontSize: 'var(--hms-text-sm)',
        justifyContent: collapsed ? "center" : "flex-start",
        width: collapsed ? 36 : "auto",
        height: collapsed ? 36 : "auto",
      })}
    >
      {icon}
      {!collapsed && <span>{label}</span>}
    </NavLink>
  );
  return collapsed ? <Tooltip label={label} placement="right">{link}</Tooltip> : link;
}

// ── styles ────────────────────────────────────────────────────────

const iconBtnStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  padding: 4,
  cursor: "pointer",
  color: "var(--hms-text)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const rowBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 'var(--hms-space-3)',
  width: "100%",
  padding: "6px 10px",
  border: "none",
  borderRadius: 6,
  color: "var(--hms-text-muted)",
  cursor: "pointer",
  textAlign: "left",
  fontSize: 'var(--hms-text-sm)',
};

// rowBtnStyle is defined but only used if future callers need it.
void rowBtnStyle;

