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
  BarChart3, Globe, FileText, FolderOpen,
  User, Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Translations } from "@/i18n/types";

export type RouteModule = "agent" | "tasks" | "manage";

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
  // ── agent ─────────────────────────────────────────────────────────
  { path: "/sessions", labelKey: "sessions", icon: LayoutList,    panel: lazy(() => import("@/panels/SessionsPanel")), module: "agent", order: 1 },
  { path: "/agents",   labelKey: "agents",   icon: Users,         panel: lazy(() => import("@/panels/AgentsPanel")),   module: "agent", order: 2 },
  // /chat is reachable via Sidebar's "New session" button + Recents.
  { path: "/chat",     labelKey: "chat",     icon: MessageSquare, panel: lazy(() => import("@/panels/ChatPanel")),     module: "agent", order: 99, hidden: true },

  // ── tasks ─────────────────────────────────────────────────────────
  { path: "/cron",     labelKey: "cron",     icon: Clock,         panel: lazy(() => import("@/panels/CronPanel")),     module: "tasks", order: 1 },
  { path: "/kanban",   labelKey: "kanban",   icon: Kanban,        panel: lazy(() => import("@/panels/KanbanPanel")),   module: "tasks", order: 2 },
  // /files is reached from the chat workspace context panel + deep links.
  { path: "/files",    labelKey: "files",    icon: FolderOpen,    panel: lazy(() => import("@/panels/FilesPanel")),    module: "tasks", order: 99, hidden: true },

  // ── manage ────────────────────────────────────────────────────────
  // Group A (capabilities): skills, plugins, models, channels   (order 1–4)
  { path: "/skills",   labelKey: "skills",   icon: Sparkles,      panel: lazy(() => import("@/panels/SkillsPanel")),   module: "manage", order: 1 },
  { path: "/plugins",  labelKey: "plugins",  icon: Puzzle,        panel: lazy(() => import("@/panels/PluginsPanel")),  module: "manage", order: 2 },
  { path: "/models",   labelKey: "models",   icon: Cpu,           panel: lazy(() => import("@/panels/ModelsPanel")),   module: "manage", order: 3 },
  { path: "/channels", labelKey: "channels", icon: Globe,         panel: lazy(() => import("@/panels/ChannelsPanel")), module: "manage", order: 4 },
  // Group B (observability): analytics, logs                    (order 5–6)
  { path: "/analytics", labelKey: "analytics", icon: BarChart3,   panel: lazy(() => import("@/panels/AnalyticsPanel")), module: "manage", order: 5 },
  { path: "/logs",      labelKey: "logs",      icon: FileText,    panel: lazy(() => import("@/panels/LogsPanel")),      module: "manage", order: 6 },

  // ── UserButton routes (popover, not module nav) ────────────────────
  { path: "/profile",  labelKey: "profile",  icon: User,          panel: lazy(() => import("@/panels/ProfilePanel")),  module: "manage", order: 99, hidden: true },
  { path: "/settings", labelKey: "settings", icon: Settings,      panel: lazy(() => import("@/panels/SettingsPanel")), module: "manage", order: 99, hidden: true },
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
