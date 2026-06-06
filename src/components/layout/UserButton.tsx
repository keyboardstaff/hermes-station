import { useEffect, useRef, useState } from "react";
import { User, Settings as SettingsIcon, Keyboard, LogOut } from "lucide-react";
import { useI18n } from "@/i18n";
import { api } from "@/lib/api";
import { useOverlays } from "@/store/overlays";
import ShortcutsPanel from "@/components/shortcuts/ShortcutsPanel";

/**
 * Bottom-pinned user button with an upward popover.
 *
 * Replaces the right-corner CapabilityBadge as the home
 * for Profile / Settings / Shortcuts / Sign out. Sign out is only
 * surfaced when the backend reports both ``requiresLogin`` and
 * ``loggedIn`` true; otherwise it would be a visual no-op.
 *
 * Collapsed mode renders just the avatar — the same popover anchors to
 * it. Theme / skin / font controls intentionally do NOT live here:
 * they live under /settings.
 */
export default function UserButton({ collapsed = false }: { collapsed?: boolean }) {
  const { t } = useI18n();
  const openProfile = useOverlays((s) => s.openProfile);
  const openSettings = useOverlays((s) => s.openSettings);
  const [open, setOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [showLogout, setShowLogout] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.get<{ requiresLogin: boolean; loggedIn: boolean }>("/api/auth-status")
      .then((s) => setShowLogout(s.requiresLogin && s.loggedIn))
      .catch(() => setShowLogout(false));
  }, []);

  // Click-outside dismiss — keep keyboard Escape handling minimal; this
  // is a popover not a modal.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const onShortcuts = () => { setShortcutsOpen(true); setOpen(false); };
  const onLogout = async () => {
    try { await api.json("/api/logout", "POST"); } catch { /* silent */ }
    window.location.reload();
  };

  const label = t.user.localUser;

  return (
    <div style={{ position: "relative", width: "100%" }} ref={popRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="hms-sidebar-row"
        data-active={open}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 'var(--hms-space-2)',
          width: "100%",
          padding: collapsed ? 6 : "6px 8px",
          border: "1px solid transparent",
          borderRadius: 8,
          color: "var(--hms-text)",
          cursor: "pointer",
          textAlign: "left",
          justifyContent: collapsed ? "center" : "flex-start",
        }}
      >
        <span
          style={{
            width: 28,
            height: 28,
            flexShrink: 0,
            borderRadius: "999px",
            background: "var(--hms-surface-2, var(--hms-surface))",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <User size={16} />
        </span>
        {!collapsed && (
          <span style={{ fontSize: 'var(--hms-text-sm)', whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {label}
          </span>
        )}
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
            left: 0,
            right: collapsed ? "auto" : 0,
            minWidth: 200,
            padding: 6,
            borderRadius: 8,
            border: "1px solid var(--hms-border)",
            background: "var(--hms-surface)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
            zIndex: 40,
          }}
        >
          <MenuItem icon={<User size={14} />} label={t.user.profile} onClick={() => { openProfile(); setOpen(false); }} />
          <MenuItem icon={<SettingsIcon size={14} />} label={t.user.settings} onClick={() => { openSettings(); setOpen(false); }} />
          <MenuItem icon={<Keyboard size={14} />} label={t.user.shortcuts} onClick={onShortcuts} />
          {showLogout && (
            <>
              <div style={{ height: 1, background: "var(--hms-border)", margin: "4px 0" }} />
              <MenuItem icon={<LogOut size={14} />} label={t.user.signOut} onClick={onLogout} danger />
            </>
          )}
        </div>
      )}

      {shortcutsOpen && <ShortcutsPanel onClose={() => setShortcutsOpen(false)} />}
    </div>
  );
}

function MenuItem({
  icon, label, onClick, danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="menuitem"
      className="hms-sidebar-row"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 'var(--hms-space-2)',
        width: "100%",
        padding: "6px 8px",
        border: "none",
        borderRadius: 6,
        color: danger ? "var(--hms-error-text)" : "var(--hms-text)",
        cursor: "pointer",
        textAlign: "left",
        fontSize: 'var(--hms-text-sm)',
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
