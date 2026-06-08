import { Suspense, lazy, useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useOverlays } from "@/store/overlays";
import { useIsMobile } from "@/hooks/useBreakpoint";

const ProfilePanel = lazy(() => import("@/panels/ProfilePanel"));
const SettingsPanel = lazy(() => import("@/panels/SettingsPanel"));

/**
 * OverlayModals — renders the Profile / Settings modals from the global overlay
 * store. Mounted once at the app shell. The panels render their own headers /
 * tabs; the modal just frames them (backdrop + container + close), full-screen
 * on mobile and a large centred dialog on desktop.
 */
export default function OverlayModals() {
  const modal = useOverlays((s) => s.modal);
  const settingsTab = useOverlays((s) => s.settingsTab);
  const close = useOverlays((s) => s.close);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (!modal) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [modal, close]);

  if (!modal) return null;

  const container: React.CSSProperties = isMobile
    ? { position: "fixed", inset: 0, width: "100%", height: "100%" }
    // Settings now hosts the embedded capability panels (Models / Plugins /
    // Channels) in a two-column layout, so it gets a wider frame than Profile.
    : {
        width: modal === "settings" ? "min(1120px, 95vw)" : "min(960px, 94vw)",
        height: "min(88vh, 920px)",
      };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      onClick={close}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "var(--hms-dialog-backdrop)",
        padding: isMobile ? 0 : 'var(--hms-space-4)',
      }}
    >
      <div
        className={isMobile ? undefined : "hms-pop-in"}
        onClick={(e) => e.stopPropagation()}
        style={{
          ...container,
          position: "relative",
          display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden",
          background: "var(--hms-bg)", border: "1px solid var(--hms-border)",
          borderRadius: isMobile ? 0 : 'var(--hms-radius-lg)',
          boxShadow: "0 16px 64px rgba(0,0,0,0.35)",
        }}
      >
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          style={{
            position: "absolute", top: 8, right: 10, zIndex: 2,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 32, height: 32, border: "none", borderRadius: 'var(--hms-radius-md)',
            background: "transparent", color: "var(--hms-text-muted)", cursor: "pointer",
          }}
        >
          <X size={18} />
        </button>
        <Suspense fallback={null}>
          {modal === "profile" ? <ProfilePanel /> : <SettingsPanel initialTab={settingsTab ?? undefined} />}
        </Suspense>
      </div>
    </div>,
    document.body,
  );
}
