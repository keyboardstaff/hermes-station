import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Per-profile accent colors — the dot shown beside session rows (and on the
 * profile tabs) so different profiles read apart at a glance. Client-side and
 * persisted (a profile is a server entity, but a UI accent is a per-device
 * preference). An unset profile falls back to a deterministic palette pick by
 * name hash, so colors are stable and distinct without any setup.
 */

export const PROFILE_PALETTE = [
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#14b8a6", // teal
  "#f97316", // orange
  "#6366f1", // indigo
  "#84cc16", // lime
] as const;

interface ProfileColorsState {
  colors: Record<string, string>;
  setColor: (profile: string, color: string) => void;
  clearColor: (profile: string) => void;
}

export const useProfileColors = create<ProfileColorsState>()(
  persist(
    (set, get) => ({
      colors: {},
      setColor: (profile, color) =>
        set({ colors: { ...get().colors, [profile]: color } }),
      clearColor: (profile) => {
        const next = { ...get().colors };
        delete next[profile];
        set({ colors: next });
      },
    }),
    { name: "hms-profile-colors" },
  ),
);

function hashIndex(name: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % mod;
}

/** The effective dot color for a profile: an explicit choice, else a stable
 *  palette pick by name hash. */
export function profileColor(name: string | null | undefined, colors: Record<string, string>): string {
  const key = name || "default";
  return colors[key] ?? PROFILE_PALETTE[hashIndex(key, PROFILE_PALETTE.length)];
}
