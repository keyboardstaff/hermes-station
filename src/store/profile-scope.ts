import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Profile view-scope — the "workspace switcher" model (mirrors upstream
 * `apps/desktop`'s `$profileScope`): the read-only views are "in" ONE profile
 * at a time, showing only its sessions/data as clean rows; an explicit opt-in
 * `ALL_PROFILES` mode fans every profile into one aggregated, tagged view.
 *
 * This is a *read-only* view scope, deliberately decoupled from the Composer
 * profile pill (the run/**write** scope) — viewing profile X never causes a run
 * to write under X. Single-profile users never leave the default and never see
 * the selector, so their path is unchanged.
 */

/** Sentinel: the aggregated, every-profile view (the opt-in exception). */
export const ALL_PROFILES = "__all__";

interface ProfileScopeState {
  /** The profile context the views are showing:
   *  - `null` → follow the active (sticky) profile — the default.
   *  - `"<name>"` → a concrete profile (incl. `"default"`).
   *  - `ALL_PROFILES` → the aggregated every-profile view. */
  scope: string | null;
  setScope: (scope: string | null) => void;
}

export const useProfileScope = create<ProfileScopeState>()(
  persist(
    (set) => ({
      scope: null,
      setScope: (scope) => set({ scope }),
    }),
    { name: "hms-profile-scope" },
  ),
);

/** The concrete profile a scope filters/reads to (`"default"` for the root home,
 *  the chosen/active name otherwise). `null` only for `ALL_PROFILES` — "no single
 *  profile". A follow-active scope resolves through `activeProfile`. */
export function effectiveScopeName(
  scope: string | null,
  activeProfile: string | null | undefined,
): string | null {
  if (scope === ALL_PROFILES) return null;
  return scope ?? activeProfile ?? "default";
}

/** The value for a `?profile=` read param: the effective profile, or `undefined`
 *  for the default home / the aggregated view (both read the process db, which
 *  `profileQuery` omits anyway). Keeps page reads honest about scope. */
export function scopeProfileParam(
  scope: string | null,
  activeProfile: string | null | undefined,
): string | undefined {
  const name = effectiveScopeName(scope, activeProfile);
  return name && name !== "default" ? name : undefined;
}

/** Filter a profile-tagged session list by the effective scope: `ALL_PROFILES`
 *  → unfiltered; a concrete profile → only its rows (an absent tag buckets as
 *  `"default"`, matching the backend's cross-home tagging). */
export function filterSessionsByScope<T extends { profile?: string }>(
  sessions: T[],
  scope: string | null,
  activeProfile: string | null | undefined,
): T[] {
  if (scope === ALL_PROFILES) return sessions;
  const target = effectiveScopeName(scope, activeProfile) ?? "default";
  return sessions.filter((s) => (s.profile ?? "default") === target);
}
