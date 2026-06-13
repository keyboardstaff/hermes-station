import { useMemo, useRef, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { PanelLeftClose, PanelLeftOpen, Plus, MoreHorizontal } from "lucide-react";
import { useI18n } from "@/i18n";
import SearchInput from "@/components/ui/SearchInput";
import { useSidebarSearch } from "@/store/sidebar-search";
import { useChatStore } from "@/store/chat";
import { NAV_ROUTES } from "@/routes/registry";
import { useSidebarNav, effectivePinned } from "@/store/sidebar-nav";
import Tooltip from "@/components/ui/Tooltip";
import ConnectionDot from "./ConnectionDot";
import UserButton from "./UserButton";
import SidebarRecents from "./SidebarRecents";

const ICON_SIZE = 18;

/**
 * Unified Sidebar — flat nav with a "More" disclosure (module switcher
 * removed; the former Activity pages live under More).
 *
 * Layout (same sections in both states; only widths/labels change):
 *   • Header — session search + Fold toggle (Fold hidden on mobile)
 *   • Primary action — "+ New session"
 *   • Pinned nav — the user-configured (or default) route set
 *   • More — disclosure revealing the remaining routes
 *   • Recents — expanded only
 *   • Bottom — UserButton + ConnectionDot
 *
 * The pinned set comes from Settings → Preferences → Sidebar
 * (`useSidebarNav`, persisted client-side).
 */
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
  const search = useSidebarSearch((s) => s.query);
  const setSearch = useSidebarSearch((s) => s.setQuery);
  const setActiveSession = useChatStore((s) => s.setActiveSession);

  const pinnedPaths = useSidebarNav((s) => s.pinnedPaths);
  const pinned = effectivePinned(pinnedPaths);
  const pinnedRoutes = useMemo(
    () => NAV_ROUTES.filter((r) => pinned.includes(r.path)),
    [pinned],
  );
  const moreRoutes = useMemo(
    () => NAV_ROUTES.filter((r) => !pinned.includes(r.path)),
    [pinned],
  );

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

      {/* ── Primary Action ───────────────────────────────────────── */}
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

      {/* ── Nav: pinned + More disclosure ────────────────────────── */}
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
        {pinnedRoutes.map(({ path, labelKey, icon: Icon }) => (
          <SidebarLink
            key={path}
            to={path}
            label={t.nav[labelKey] ?? labelKey}
            icon={<Icon size={ICON_SIZE} />}
            collapsed={collapsed}
            onClick={onNavigate}
          />
        ))}

        {moreRoutes.length > 0 && (
          <MoreFlyout
            routes={moreRoutes}
            collapsed={collapsed}
            label={t.nav.more}
            labelFor={(k) => t.nav[k] ?? k}
            onNavigate={onNavigate}
          />
        )}
      </nav>

      {/* ── Recents (expanded only) ──────────────────────────────── */}
      {!collapsed ? (
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
      ) : (
        <div style={{ flex: 1 }} />
      )}

      {/* ── Bottom: UserButton + ConnectionDot ───────────────────── */}
      <div
        style={{
          padding: collapsed ? 6 : "8px 10px",
          flexShrink: 0,
          display: "flex",
          flexDirection: collapsed ? "column" : "row",
          alignItems: "center",
          gap: 'var(--hms-space-2)',
        }}
      >
        <div style={{ flex: collapsed ? undefined : 1, minWidth: 0 }}>
          <UserButton collapsed={collapsed} />
        </div>
        <ConnectionDot />
      </div>
    </aside>
  );
}

// ── More flyout ───────────────────────────────────────────────────
// Hovering "More" opens a panel to the RIGHT of the trigger (fixed-positioned
// so no ancestor overflow clips it). A short close delay lets the cursor
// travel from the trigger into the panel without it collapsing.
function MoreFlyout({
  routes, collapsed, label, labelFor, onNavigate,
}: {
  routes: typeof NAV_ROUTES;
  collapsed: boolean;
  label: string;
  labelFor: (k: NAV_LABEL) => string;
  onNavigate?: () => void;
}) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);

  const open = () => {
    window.clearTimeout(closeTimer.current);
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) setPos({ left: r.right + 4, top: r.top });
  };
  const scheduleClose = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setPos(null), 140);
  };

  return (
    <div
      className="hms-sidebar-more-wrap"
      onMouseEnter={open}
      onMouseLeave={scheduleClose}
    >
      <button
        ref={triggerRef}
        type="button"
        className="hms-sidebar-row hms-sidebar-more"
        aria-haspopup="menu"
        aria-expanded={pos !== null}
        onClick={open}
        style={collapsed ? { justifyContent: "center", width: 36, height: 36 } : undefined}
      >
        <MoreHorizontal size={collapsed ? 16 : ICON_SIZE} />
        {!collapsed && <span>{label}</span>}
      </button>

      {pos && (
        <div
          className="hms-sidebar-more-flyout"
          role="menu"
          style={{ left: pos.left, top: pos.top }}
          onMouseEnter={open}
          onMouseLeave={scheduleClose}
        >
          {routes.map(({ path, labelKey, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              onClick={() => { setPos(null); onNavigate?.(); }}
              className={({ isActive }) => "hms-sidebar-more-item" + (isActive ? " active" : "")}
            >
              <Icon size={15} />
              <span>{labelFor(labelKey)}</span>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

type NAV_LABEL = (typeof NAV_ROUTES)[number]["labelKey"];

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
