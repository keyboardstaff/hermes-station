import { create } from "zustand";

/**
 * Global overlay (modal) state. Profile & Settings are Shortcuts-style modals —
 * transient utility pop-ins that preserve the underlying chat/session context
 * instead of routing away. Any trigger (UserButton, ⌘K, a "manage profiles"
 * link, the connection dot) opens them through this single store.
 */

export type OverlayModal = "profile" | "settings" | null;

interface OverlaysState {
  modal: OverlayModal;
  /** Active Settings tab to open on (e.g. "connection"); null = last/default. */
  settingsTab: string | null;
  openProfile: () => void;
  openSettings: (tab?: string) => void;
  close: () => void;
}

export const useOverlays = create<OverlaysState>((set) => ({
  modal: null,
  settingsTab: null,
  openProfile: () => set({ modal: "profile", settingsTab: null }),
  openSettings: (tab) => set({ modal: "settings", settingsTab: tab ?? null }),
  close: () => set({ modal: null }),
}));
