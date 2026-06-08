import { create } from "zustand";

/**
 * Sidebar session-search query. The sidebar header search box writes it; the
 * Recents/Pinned list (`SessionRecents`) reads it to filter sessions by title
 * (and, while non-empty, ignores the recents `limit` so matches beyond the top
 * N still surface).
 */
interface SidebarSearchState {
  query: string;
  setQuery: (q: string) => void;
}

export const useSidebarSearch = create<SidebarSearchState>((set) => ({
  query: "",
  setQuery: (query) => set({ query }),
}));
