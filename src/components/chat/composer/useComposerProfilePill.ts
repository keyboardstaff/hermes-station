/** Profile pill state for the Composer — the view-scope picker that scopes
 *  reads + runs to the chosen profile without a sticky write or restart.
 *  Extracted from Composer.tsx to isolate the profile/scope query fan-out. */
import { useMemo, useCallback } from "react";
import { useProfiles, useActiveProfile } from "@/hooks/useProfiles";
import { useActiveSessionProfile } from "@/hooks/useActiveSessionProfile";
import { useProfileScope, effectiveScopeName, ALL_PROFILES } from "@/store/profile-scope";

export function useComposerProfilePill() {
  const profilesQuery = useProfiles();
  const profileNames: string[] = useMemo(
    () => (profilesQuery.data?.profiles ?? []).map((p) => p.name),
    [profilesQuery.data],
  );
  const activeProfileQuery = useActiveProfile();
  const scope = useProfileScope((s) => s.scope);
  const setScope = useProfileScope((s) => s.setScope);
  const sessionProfile = useActiveSessionProfile();

  const activeProfileName =
    activeProfileQuery.data?.current ?? activeProfileQuery.data?.sticky ?? "default";

  const currentProfileName =
    scope === ALL_PROFILES
      ? (sessionProfile ?? activeProfileName)
      : (effectiveScopeName(scope, activeProfileName) ?? activeProfileName);

  const profileChoices = profileNames.length > 0 ? profileNames : [currentProfileName];

  const handleProfileChange = useCallback(
    (next: string) => {
      if (next !== currentProfileName || scope === ALL_PROFILES) setScope(next);
    },
    [currentProfileName, scope, setScope],
  );

  return { currentProfileName, profileChoices, handleProfileChange };
}
