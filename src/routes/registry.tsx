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

export type RouteModule = "agent" | "activity";

export interface RouteRecord {
  path: string;
  labelKey: keyof Translations["nav"];
  icon: LucideIcon;
  panel: LazyExoticComponent<ComponentType<unknown>>;
  /** Module the route belongs to — also used by the Sidebar to auto-follow
   *  the active module on direct navigation. */
  module: RouteModule;
  order: number;
  /** Routed + reachable, but never listed in the module nav. Reached via
   *  other affordances: /chat (New session + Recents), /files (chat
   *  workspace deep-link), /settings & /profile (UserButton popover). */
  hidden?: boolean;
}

export const ROUTES: RouteRecord[] = [
  // ── Agent (interactive work with the agent) ───────────────────────
  { path: "/sessions", labelKey: "sessions", icon: LayoutList,    panel: lazy(() => import("@/panels/SessionsPanel")), module: "agent", order: 1 },
  { path: "/agents",   labelKey: "agents",   icon: Users,         panel: lazy(() => import("@/panels/AgentsPanel")),   module: "agent", order: 2 },
  // "Tools" = the agent's skills + toolsets + MCP (labelKey `skills`, relabeled).
  { path: "/skills",   labelKey: "skills",   icon: Sparkles,      panel: lazy(() => import("@/panels/SkillsPanel")),   module: "agent", order: 3 },
  { path: "/artifacts", labelKey: "artifacts", icon: Files,       panel: lazy(() => import("@/panels/ArtifactsPanel")), module: "agent", order: 4 },
  // /chat is reachable via Sidebar's "New session" button + Recents.
  { path: "/chat",     labelKey: "chat",     icon: MessageSquare, panel: lazy(() => import("@/panels/ChatPanel")),     module: "agent", order: 99, hidden: true },
  // /files is the chat workspace's full page — reached from there + deep links.
  { path: "/files",    labelKey: "files",    icon: FolderOpen,    panel: lazy(() => import("@/panels/FilesPanel")),    module: "agent", order: 99, hidden: true },

  // ── Activity (the agent's background work + observability) ─────────
  { path: "/cron",     labelKey: "cron",     icon: Clock,         panel: lazy(() => import("@/panels/CronPanel")),     module: "activity", order: 1 },
  { path: "/kanban",   labelKey: "kanban",   icon: Kanban,        panel: lazy(() => import("@/panels/KanbanPanel")),   module: "activity", order: 2 },
  { path: "/analytics", labelKey: "analytics", icon: BarChart3,   panel: lazy(() => import("@/panels/AnalyticsPanel")), module: "activity", order: 3 },
  { path: "/logs",      labelKey: "logs",      icon: FileText,    panel: lazy(() => import("@/panels/LogsPanel")),      module: "activity", order: 4 },

  // ── Folded into the Settings modal (Capabilities) ─────────────────
  // Routed (deep-link / palette compat) but hidden from the sidebar — the
  // Settings two-column list is their home; SettingsPanel embeds these panels.
  { path: "/models",   labelKey: "models",   icon: Cpu,           panel: lazy(() => import("@/panels/ModelsPanel")),   module: "agent", order: 99, hidden: true },
  { path: "/plugins",  labelKey: "plugins",  icon: Puzzle,        panel: lazy(() => import("@/panels/PluginsPanel")),  module: "agent", order: 99, hidden: true },
  { path: "/channels", labelKey: "channels", icon: Globe,         panel: lazy(() => import("@/panels/ChannelsPanel")), module: "agent", order: 99, hidden: true },

  // Profile + Settings are NOT routes — they open as modals (see
  // `useOverlays` / OverlayModals), so config pops in over the current view.
];

export const DEFAULT_ROUTE = "/sessions";

/** The module a pathname belongs to, or null if it matches no route. */
export function moduleForPath(pathname: string): RouteModule | null {
  return ROUTES.find((r) => pathname.startsWith(r.path))?.module ?? null;
}

/** First *visible* route of a module, by `order` (the module's landing page). */
export function firstRouteForModule(m: RouteModule): RouteRecord | undefined {
  return ROUTES
    .filter((r) => r.module === m && !r.hidden)
    .sort((a, b) => a.order - b.order)[0];
}

/**
 * Where a module-tab click should navigate. Returns the module's first
 * visible route's path, or ``null`` to stay put — which happens when the
 * current path already belongs to that module, so an in-module hidden route
 * (e.g. `/chat`, `/files`) isn't yanked to its sibling.
 */
export function moduleNavTarget(m: RouteModule, currentPath: string): string | null {
  if (moduleForPath(currentPath) === m) return null;
  return firstRouteForModule(m)?.path ?? null;
}
