import { Layers } from "lucide-react";
import { PopupSelect, type PopupSelectOption } from "@/components/ui/PopupSelect";
import { useProfiles, useActiveProfile } from "@/hooks/useProfiles";
import { useProfileScope, ALL_PROFILES } from "@/store/profile-scope";
import { useI18n } from "@/i18n";

/**
 * Profile view-scope picker — the "workspace switcher" (upstream desktop's
 * `$profileScope`): pick which profile's sessions/data the views show, or
 * "All profiles" for the aggregated view. Read-only scope, decoupled from the
 * Composer run-profile pill. Hidden for single-profile users (only the default
 * home exists — nothing to switch), so their path is byte-for-byte unchanged.
 */
export default function ProfileScopeSelector({ fullWidth = true }: { fullWidth?: boolean }) {
  const { t } = useI18n();
  const { data: profilesData } = useProfiles();
  const { data: active } = useActiveProfile();
  const scope = useProfileScope((s) => s.scope);
  const setScope = useProfileScope((s) => s.setScope);

  const profiles = profilesData?.profiles ?? [];
  if (profiles.length <= 1) return null; // single-profile → no switcher

  const activeName = active?.current ?? "default";
  // scope === null means "follow active"; surface that as the active profile.
  const current = scope === ALL_PROFILES ? ALL_PROFILES : (scope ?? activeName);

  const options: PopupSelectOption[] = [
    ...profiles.map((p) => ({ value: p.name, label: p.name })),
    { value: ALL_PROFILES, label: t.sessions.allProfiles },
  ];
  const label = current === ALL_PROFILES ? t.sessions.allProfiles : current;

  // Sidebar (fullWidth) renders as a deliberate top band (own class); the inline
  // pill (topbar) sits bare in the actions row.
  return (
    <div className={fullWidth ? "hms-scope-switcher" : undefined}>
      <PopupSelect
        icon={<Layers size={15} />}
        label={label}
        value={current}
        options={options}
        onChange={(v) => setScope(v)}
        fullWidth={fullWidth}
        plain={fullWidth}
        muted={current === ALL_PROFILES}
        popupWidth={200}
      />
    </div>
  );
}
