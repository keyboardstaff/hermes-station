import { List } from "lucide-react";
import { PopupSelect, type PopupSelectOption } from "@/components/ui/PopupSelect";
import { useProfiles, useActiveProfile } from "@/hooks/useProfiles";
import { useProfileScope, ALL_PROFILES } from "@/store/profile-scope";
import { useProfileColors, profileColor } from "@/store/profile-colors";
import { useI18n } from "@/i18n";

/**
 * Profile view-scope picker — the "workspace switcher" (upstream desktop's
 * `$profileScope`): pick which profile's sessions/data the views show, or
 * "All profiles" for the aggregated view. Read-only scope, decoupled from the
 * Composer run-profile pill. Hidden for single-profile users (only the default
 * home exists — nothing to switch), so their path is byte-for-byte unchanged.
 *
 * `variant="tabs"` (sidebar) renders a horizontal, scrollable tab strip with a
 * per-profile color dot; `"dropdown"` (topbar / Models) stays a compact pill.
 */
export default function ProfileScopeSelector({
  fullWidth = true,
  variant = "dropdown",
}: {
  fullWidth?: boolean;
  variant?: "dropdown" | "tabs";
}) {
  const { t } = useI18n();
  const { data: profilesData } = useProfiles();
  const { data: active } = useActiveProfile();
  const scope = useProfileScope((s) => s.scope);
  const setScope = useProfileScope((s) => s.setScope);
  const colors = useProfileColors((s) => s.colors);

  const profiles = profilesData?.profiles ?? [];
  if (profiles.length <= 1) return null; // single-profile → no switcher

  const activeName = active?.current ?? "default";
  // scope === null means "follow active"; surface that as the active profile.
  const current = scope === ALL_PROFILES ? ALL_PROFILES : (scope ?? activeName);

  if (variant === "tabs") {
    return (
      <div className="hms-profile-tabs" role="tablist" aria-label={t.nav.profile}>
        {/* "All" first — the aggregated every-profile view. */}
        <button
          type="button"
          role="tab"
          aria-selected={current === ALL_PROFILES}
          className="hms-profile-tab"
          data-active={current === ALL_PROFILES || undefined}
          onClick={() => setScope(ALL_PROFILES)}
        >
          <List size={13} />
          <span className="hms-profile-tab-label">{t.sessions.allShort}</span>
        </button>
        {profiles.map((p) => (
          <button
            key={p.name}
            type="button"
            role="tab"
            aria-selected={current === p.name}
            className="hms-profile-tab"
            data-active={current === p.name || undefined}
            onClick={() => setScope(p.name)}
          >
            <span
              className="hms-profile-tab-dot"
              style={{ background: profileColor(p.name, colors) }}
            />
            <span className="hms-profile-tab-label">{p.name}</span>
          </button>
        ))}
      </div>
    );
  }

  const options: PopupSelectOption[] = [
    { value: ALL_PROFILES, label: t.sessions.allShort },
    ...profiles.map((p) => ({ value: p.name, label: p.name })),
  ];
  const label = current === ALL_PROFILES ? t.sessions.allShort : current;

  return (
    <div className={fullWidth ? "hms-scope-switcher" : undefined}>
      <PopupSelect
        icon={<List size={15} />}
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
