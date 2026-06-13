// Domain filter stores — Logs panel + Sessions panel. Merged per
// module consolidation so there's one filter module instead of two
// near-identical ones.

import { create } from "zustand";

// ── Logs ──────────────────────────────────────────────────────────

// Files map 1:1 to ~/.hermes/logs/<file>.log — there is no "all" file
// (matches upstream's File selector: agent / errors / gateway).
export type LogFile = "agent" | "errors" | "gateway";
export const LOG_FILES: LogFile[] = ["agent", "errors", "gateway"];

export type LogComponent = "all" | "gateway" | "agent" | "tools" | "cli" | "cron";
export const LOG_COMPONENTS: LogComponent[] = [
  "all", "gateway", "agent", "tools", "cli", "cron",
];

export type LogLines = 50 | 100 | 200 | 500;
export const LOG_LINE_OPTIONS: LogLines[] = [50, 100, 200, 500];

export type LogLevel = "ALL" | "DEBUG" | "INFO" | "WARNING" | "ERROR";
export const LOG_LEVEL_OPTIONS: LogLevel[] = ["ALL", "DEBUG", "INFO", "WARNING", "ERROR"];

interface LogsFiltersState {
  file: LogFile;
  component: LogComponent;
  level: LogLevel;
  lines: LogLines;
  keyword: string;
  follow: boolean;

  setFile: (v: LogFile) => void;
  setComponent: (v: LogComponent) => void;
  setLevel: (v: LogLevel) => void;
  setLines: (v: LogLines) => void;
  setKeyword: (v: string) => void;
  setFollow: (v: boolean) => void;
}

export const useLogsFilters = create<LogsFiltersState>((set) => ({
  file: "agent",
  component: "all",
  level: "ALL",
  lines: 200,
  keyword: "",
  follow: true,
  setFile: (file) => set({ file }),
  setComponent: (component) => set({ component }),
  setLevel: (level) => set({ level }),
  setLines: (lines) => set({ lines }),
  setKeyword: (keyword) => set({ keyword }),
  setFollow: (follow) => set({ follow }),
}));

// ── Sessions ──────────────────────────────────────────────────────

export type SessionsView = "active" | "archived";

interface SessionsFiltersState {
  search: string;
  debouncedSearch: string;
  sourceFilter: string; // "all" or a literal source value (e.g. "hms")
  profileFilter: string; // "all" or a literal profile name (e.g. "default")
  view: SessionsView; // active list vs the archived-only management view
  page: number;

  setSearch: (v: string) => void;
  setDebouncedSearch: (v: string) => void;
  setSourceFilter: (v: string) => void;
  setProfileFilter: (v: string) => void;
  setView: (v: SessionsView) => void;
  setPage: (p: number) => void;
  resetPage: () => void;
}

export const useSessionsFilters = create<SessionsFiltersState>((set) => ({
  search: "",
  debouncedSearch: "",
  sourceFilter: "all",
  profileFilter: "all",
  view: "active",
  page: 0,

  setSearch: (search) => set({ search }),
  setDebouncedSearch: (debouncedSearch) => set({ debouncedSearch, page: 0 }),
  setSourceFilter: (sourceFilter) => set({ sourceFilter, page: 0 }),
  setProfileFilter: (profileFilter) => set({ profileFilter, page: 0 }),
  setView: (view) => set({ view, page: 0 }),
  setPage: (page) => set({ page }),
  resetPage: () => set({ page: 0 }),
}));
