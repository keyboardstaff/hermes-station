import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_PINNED } from "@/routes/registry";

/**
 * Which nav routes are pinned directly in the sidebar — the rest collapse
 * under the "More" disclosure. `null` means the built-in default set;
 * Settings → Preferences → Sidebar writes an explicit set.
 */
interface SidebarNavState {
  pinnedPaths: string[] | null;
  togglePinned: (path: string) => void;
  reset: () => void;
}

export const useSidebarNav = create<SidebarNavState>()(
  persist(
    (set, get) => ({
      pinnedPaths: null,

      togglePinned: (path) => {
        const current = get().pinnedPaths ?? [...DEFAULT_PINNED];
        const next = current.includes(path)
          ? current.filter((p) => p !== path)
          : [...current, path];
        set({ pinnedPaths: next });
      },

      reset: () => set({ pinnedPaths: null }),
    }),
    { name: "hms-sidebar-nav" },
  ),
);

/** The effective pinned set (explicit user set, else the defaults). */
export function effectivePinned(pinnedPaths: string[] | null): readonly string[] {
  return pinnedPaths ?? DEFAULT_PINNED;
}
