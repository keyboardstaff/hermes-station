// Single source of truth for every navigable route. Both DesktopShell
// and MobileShell derive their `<Routes>` from this list — adding a
// route requires exactly one edit here. Sidebar / UserButton
// also key off this same array.
//
// `panel` uses React.lazy so the panel bundle is split per route; the
// shell wraps <Routes> in <Suspense> with a null fallback (panels render
// their own loading states once mounted).

import { lazy } from "react";
import type { LazyExoticComponent, ComponentType } from "react";
import {
  MessageSquare, LayoutList, Users, Kanban, Clock,
  Sparkles, Puzzle, Cpu,
  BarChart3, Globe, FileText, FolderOpen, Files,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Translations } from "@/i18n/types";

export interface RouteRecord {
  path: string;
  labelKey: keyof Translations["nav"];
  icon: LucideIcon;
  panel: LazyExoticComponent<ComponentType<unknown>>;
  order: number;
  /** Routed + reachable, but never listed in the sidebar nav. Reached via
   *  other affordances: /chat (New session + Recents), /settings & /profile
   *  (UserButton popover), /models//plugins//channels (Settings embeds). */
  hidden?: boolean;
}

export const ROUTES: RouteRecord[] = [
  // ── Sidebar nav (pinned by default, or under "More") ──────────────
  { path: "/sessions",  labelKey: "sessions",  icon: LayoutList,  panel: lazy(() => import("@/panels/SessionsPanel")),  order: 1 },
  // "Tools" = the agent's skills + toolsets + MCP (labelKey `skills`, relabeled).
  { path: "/skills",    labelKey: "skills",    icon: Sparkles,    panel: lazy(() => import("@/panels/SkillsPanel")),    order: 3 },
  { path: "/artifacts", labelKey: "artifacts", icon: Files,       panel: lazy(() => import("@/panels/ArtifactsPanel")), order: 4 },
  { path: "/cron",      labelKey: "cron",      icon: Clock,       panel: lazy(() => import("@/panels/CronPanel")),      order: 5 },
  { path: "/kanban",    labelKey: "kanban",    icon: Kanban,      panel: lazy(() => import("@/panels/KanbanPanel")),    order: 6 },
  { path: "/files",     labelKey: "files",     icon: FolderOpen,  panel: lazy(() => import("@/panels/FilesPanel")),     order: 7 },
  { path: "/analytics", labelKey: "analytics", icon: BarChart3,   panel: lazy(() => import("@/panels/AnalyticsPanel")), order: 8 },
  { path: "/logs",      labelKey: "logs",      icon: FileText,    panel: lazy(() => import("@/panels/LogsPanel")),      order: 9 },

  // /chat is reachable via Sidebar's "New session" button + Recents.
  { path: "/chat",      labelKey: "chat",      icon: MessageSquare, panel: lazy(() => import("@/panels/ChatPanel")),   order: 99, hidden: true },
  // /agents = the active session's subagent tree — opened as a modal from the
  // chat topbar (Users button), not a sidebar destination. Routed for deep links.
  { path: "/agents",    labelKey: "agents",    icon: Users,         panel: lazy(() => import("@/panels/AgentsPanel")), order: 99, hidden: true },

  // ── Folded into the Settings modal (Capabilities) ─────────────────
  // Routed (deep-link / palette compat) but hidden from the sidebar — the
  // Settings two-column list is their home; SettingsPanel embeds these panels.
  { path: "/models",    labelKey: "models",    icon: Cpu,         panel: lazy(() => import("@/panels/ModelsPanel")),   order: 99, hidden: true },
  { path: "/plugins",   labelKey: "plugins",   icon: Puzzle,      panel: lazy(() => import("@/panels/PluginsPanel")),  order: 99, hidden: true },
  { path: "/channels",  labelKey: "channels",  icon: Globe,       panel: lazy(() => import("@/panels/ChannelsPanel")), order: 99, hidden: true },

  // Profile + Settings are NOT routes — they open as modals (see
  // `useOverlays` / OverlayModals), so config pops in over the current view.
];

export const DEFAULT_ROUTE = "/sessions";

/** Sidebar-listable routes, in canonical order. */
export const NAV_ROUTES: RouteRecord[] = ROUTES
  .filter((r) => !r.hidden)
  .sort((a, b) => a.order - b.order);

/** Paths pinned to the sidebar out of the box; the rest live under "More".
 *  Users override the set in Settings → Preferences → Sidebar. */
export const DEFAULT_PINNED: readonly string[] = [
  "/sessions", "/skills", "/artifacts", "/cron",
];
