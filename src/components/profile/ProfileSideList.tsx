import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, RefreshCw, User, Upload } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { useProfiles, type ProfileInfo } from "@/hooks/useProfiles";
import { useProfileSelection } from "@/store/panel-selection";
import { useIsMobile } from "@/hooks/useBreakpoint";
import CreateProfileDialog from "./CreateProfileDialog";

/**
 * sidebar list for ``/profile``.
 *
 * Selection lives in the ``useProfileSelection`` zustand store so the
 * sidebar and the right-hand detail stay in sync — matching the
 * ``useChatStore`` pattern used by ``/chat`` ↔ ``SessionRecents``.
 */

export default function ProfileSideList() {
  const { t } = useI18n();
  const pf = t.profile;
  const { data, isLoading, isError, refetch } = useProfiles();

  const selectedName = useProfileSelection((s) => s.selectedName);
  const setSelected = useProfileSelection((s) => s.setSelected);

  const [createOpen, setCreateOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-importing the same filename
    if (!file) return;
    setImporting(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await fetch("/api/profiles/import", {
        method: "POST",
        headers: { "X-HMS-CSRF": "1" },
        body: form,
      });
      const payload = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(payload?.detail || payload?.error || `Import failed (${r.status})`);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["profiles"] });
      if (payload?.name) setSelected(payload.name);
    } catch {
      alert("Import failed");
    } finally {
      setImporting(false);
    }
  };

  const profiles = useMemo(() => data?.profiles ?? [], [data]);
  const isMobile = useIsMobile();

  // Auto-select default on first data load — desktop only. On mobile
  // the side list and detail share the same column, so auto-selecting
  // would skip the list entirely; users land on the detail view of an
  // item they didn't pick. Mobile keeps the list visible until the
  // user taps a row (``MobileListDetail`` flips to detail then).
  useEffect(() => {
    if (isMobile) return;
    if (selectedName || profiles.length === 0) return;
    const def = profiles.find((p) => p.is_default) ?? profiles[0];
    setSelected(def.name);
  }, [profiles, selectedName, setSelected, isMobile]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 'var(--hms-space-2)', padding: 'var(--hms-space-3)', height: "100%", boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: '0.625rem', fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--hms-text-muted)" }}>{pf?.listLabel ?? "Profiles"}</span>
        <div style={{ display: "flex", gap: 'var(--hms-space-1)' }}>
          <button onClick={() => refetch()} title={pf?.refresh ?? "Refresh"} style={iconBtn}>
            <RefreshCw size={11} />
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            title={pf?.importProfile ?? "Import profile"}
            style={iconBtn}
          >
            <Upload size={11} />
          </button>
          <button
            onClick={() => setCreateOpen(true)}
            title={pf?.newProfile ?? "New profile"}
            style={{ ...iconBtn, color: "var(--hms-success-text)" }}
          >
            <Plus size={12} />
          </button>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".tar.gz,.tgz,application/gzip"
        onChange={onImportFile}
        style={{ display: "none" }}
      />

      <CreateProfileDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(name) => setSelected(name)}
      />

      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 'var(--hms-space-1)' }}>
        {isLoading && (
          <div style={{ padding: 'var(--hms-space-3)', fontSize: 'var(--hms-text-xs)', color: "var(--hms-text-muted)" }}>
            {pf?.loading ?? "Loading…"}
          </div>
        )}
        {isError && (
          <div style={{ padding: 'var(--hms-space-3)', fontSize: 'var(--hms-text-xs)', color: "var(--hms-error-text)" }}>
            {pf?.errorLoading ?? "Failed to load profiles."}
          </div>
        )}
        {!isLoading && !isError && profiles.length === 0 && (
          <div
            style={{
              padding: 'var(--hms-space-3)',
              fontSize: 'var(--hms-text-xs)',
              color: "var(--hms-text-muted)",
              textAlign: "center",
              border: "1px dashed var(--hms-border)",
              borderRadius: 6,
            }}
          >
            {pf?.noProfiles ?? "No profiles."}
          </div>
        )}
        {profiles.map((p) => (
          <ProfileRow
            key={p.name}
            profile={p}
            selected={selectedName === p.name}
            onSelect={() => setSelected(p.name)}
            defaultBadge={pf?.defaultBadge ?? "default"}
          />
        ))}
      </div>
    </div>
  );
}

function ProfileRow({
  profile,
  selected,
  onSelect,
  defaultBadge,
}: {
  profile: ProfileInfo;
  selected: boolean;
  onSelect: () => void;
  defaultBadge: string;
}) {
  return (
    <button
      onClick={onSelect}
      style={{
        width: "100%",
        textAlign: "left",
        display: "flex",
        gap: 'var(--hms-space-2)',
        padding: "6px 8px",
        background: selected ? "var(--hms-border)" : "transparent",
        border: "1px solid transparent",
        borderLeft: `3px solid ${profile.is_default ? "var(--hms-accent)" : "#94a3b8"}`,
        borderRadius: 6,
        cursor: "pointer",
        color: "var(--hms-text)",
      }}
    >
      <User
        size={11}
        style={{ color: profile.is_default ? "var(--hms-accent)" : "#94a3b8", flexShrink: 0, marginTop: 1 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 'var(--hms-space-1)',
            fontSize: 'var(--hms-text-xs)',
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{profile.name}</span>
          {profile.is_default && (
            <span
              style={{
                fontSize: 8,
                padding: "1px 4px",
                borderRadius: 3,
                background: "rgba(99,102,241,0.12)",
                color: "#4f46e5",
                fontWeight: 600,
              }}
            >
              {defaultBadge}
            </span>
          )}
        </div>
        {profile.model && (
          <div
            style={{
              fontSize: '0.5625rem',
              color: "var(--hms-text-muted)",
              fontFamily: "monospace",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              marginTop: 1,
            }}
          >
            {profile.model}
          </div>
        )}
      </div>
    </button>
  );
}

const iconBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 24,
  height: 24,
  borderRadius: 5,
  border: "1px solid var(--hms-border)",
  background: "transparent",
  color: "var(--hms-text-muted)",
  cursor: "pointer",
};
