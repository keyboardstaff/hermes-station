import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, Wrench, ExternalLink } from "lucide-react";
import { useI18n } from "@/i18n";
import { useThemeStore } from "@/store/app";
import { useSessionArtifacts, type Artifact } from "@/hooks/useSessionArtifacts";
import { useFilesSelection } from "@/store/panel-selection";
import FilesSideTree from "@/components/files/FilesSideTree";
import FileEditor from "@/components/files/FileEditor";
import FileBreadcrumb from "@/components/files/FileBreadcrumb";

/**
 * WorkspaceContextPanel — the "current session work context" surface for
 * /chat. Replaces the old overlay WorkspacesDrawer with a panel that lives
 * inline to the right of the chat column (Sidebar | Chat main | Workspace).
 *
 *   • `variant="inline"`  — desktop: in-flow right column, drag-to-resize.
 *   • `variant="overlay"` — mobile: slide-over (no horizontal room inline).
 *
 * Body switches between three single-column views:
 *   • Files tab, no selection → <FilesSideTree embedded />
 *   • Files tab, selection    → <FileBreadcrumb> + <FileEditor variant="drawer">
 *   • Artifacts tab           → <ArtifactsList>
 *
 * The selection store (`useFilesSelection`) is shared with the `/files`
 * page, so "Open full Files page" hands off the same selection.
 */

const WIDTH_KEY = "hms:chat:workspace:w";
const WIDTH_MIN = 280;
const WIDTH_MAX = 640;
const WIDTH_DEFAULT = 380;

function readStoredWidth(): number {
  try {
    const n = parseInt(localStorage.getItem(WIDTH_KEY) ?? "", 10);
    if (!isNaN(n)) return Math.max(WIDTH_MIN, Math.min(WIDTH_MAX, n));
  } catch { /* private browsing */ }
  return WIDTH_DEFAULT;
}

export default function WorkspaceContextPanel({
  onClose,
  variant = "inline",
  open = true,
}: {
  onClose: () => void;
  variant?: "inline" | "overlay";
  /** Inline only — drives the collapse animation (panel stays mounted). */
  open?: boolean;
}) {
  const { t } = useI18n();
  const f = t.files;
  const navigate = useNavigate();
  const [tab, setTab] = useState<"files" | "artifacts">("files");
  const artifacts = useSessionArtifacts();
  const selected = useFilesSelection((s) => s.selected);
  const setSelected = useFilesSelection((s) => s.setSelected);
  const { resolvedTheme } = useThemeStore();
  const monacoTheme = resolvedTheme === "dark" ? "vs-dark" : "vs";

  const inEditor = tab === "files" && selected !== null;

  // Width (inline only) — drag the left edge to resize, persisted.
  const [width, setWidth] = useState(readStoredWidth);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    startX.current = e.clientX;
    startW.current = width;
    (e.target as HTMLDivElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }, [width]);
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    // Dragging the left edge: leftward (negative delta) widens the panel.
    const next = Math.max(WIDTH_MIN, Math.min(WIDTH_MAX, startW.current - (e.clientX - startX.current)));
    setWidth(next);
  }, []);
  const onPointerUp = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    try { localStorage.setItem(WIDTH_KEY, String(width)); } catch { /* ignore */ }
  }, [width]);

  // Overlay: ESC to close (inline stays open — it's part of the layout).
  useEffect(() => {
    if (variant !== "overlay") return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [variant, onClose]);

  const header = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "0 var(--hms-space-2) 0 var(--hms-space-4)",
        height: "var(--hms-header-h, 48px)",
        borderBottom: "1px solid var(--hms-border)",
        flexShrink: 0,
        gap: "var(--hms-space-2)",
      }}
    >
      {inEditor ? (
        <FileBreadcrumb
          root={selected!.root}
          path={selected!.path}
          onBack={() => setSelected(null)}
          chrome="inline"
        />
      ) : (
        <div style={{ display: "flex", gap: "var(--hms-space-1)", flex: 1 }}>
          {(["files", "artifacts"] as const).map((t_) => {
            const label = t_ === "files"
              ? f.filesTab
              : `${f.artifactsTab}${artifacts.length > 0 ? ` (${artifacts.length})` : ""}`;
            return (
              <button
                key={t_}
                type="button"
                onClick={() => setTab(t_)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "4px 8px",
                  fontSize: "var(--hms-text-sm)",
                  fontWeight: tab === t_ ? 600 : 400,
                  color: tab === t_ ? "var(--hms-text)" : "var(--hms-text-muted)",
                  borderBottom: tab === t_ ? "2px solid var(--hms-accent)" : "2px solid transparent",
                  borderRadius: 0,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* Open the full Files page (deep link, shares the selection). */}
      {tab === "files" && (
        <button
          type="button"
          onClick={() => navigate("/files", { state: { from: "chat" } })}
          title={f.openFullPage ?? "Open full Files page"}
          aria-label={f.openFullPage ?? "Open full Files page"}
          style={iconBtn}
        >
          <ExternalLink size={15} />
        </button>
      )}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close workspace"
        style={iconBtn}
      >
        <X size={16} />
      </button>
    </div>
  );

  const body = (
    <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {tab === "files" ? (
        selected ? (
          <FileEditor
            key={`${selected.root}:${selected.path}`}
            root={selected.root}
            path={selected.path}
            monacoTheme={monacoTheme}
            onAfterDelete={() => setSelected(null)}
            variant="drawer"
          />
        ) : (
          <FilesSideTree embedded />
        )
      ) : (
        <ArtifactsList artifacts={artifacts} noArtifactsLabel={f.noArtifacts} />
      )}
    </div>
  );

  if (variant === "overlay") {
    return (
      <>
        <div
          aria-hidden="true"
          onClick={onClose}
          style={{ position: "fixed", inset: 0, zIndex: 500, background: "var(--hms-dialog-backdrop)" }}
        />
        <div
          role="dialog"
          aria-label={t.nav.workspacesDrawer}
          aria-modal="true"
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            bottom: 0,
            zIndex: 501,
            width: "min(480px, 92vw)",
            display: "flex",
            flexDirection: "column",
            background: "var(--hms-surface)",
            borderLeft: "1px solid var(--hms-border)",
            boxShadow: "-4px 0 24px rgba(0,0,0,0.12)",
            overflow: "hidden",
          }}
        >
          {header}
          {body}
        </div>
      </>
    );
  }

  // Inline variant — in-flow right column with a drag-to-resize left edge.
  // Stays mounted and animates its width to 0 on close for a smooth slide.
  return (
    <div
      style={{
        display: "flex",
        flexShrink: 0,
        height: "100%",
        minHeight: 0,
        width: open ? width + 5 : 0,
        opacity: open ? 1 : 0,
        overflow: "hidden",
        pointerEvents: open ? "auto" : "none",
        transition: "width 220ms cubic-bezier(0.25, 0.1, 0.25, 1), opacity 180ms ease",
      }}
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{
          width: 5,
          flexShrink: 0,
          cursor: "col-resize",
          background: "transparent",
          borderLeft: "1px solid var(--hms-border)",
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "var(--hms-hover-bg)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
        aria-hidden="true"
      />
      <div
        role="complementary"
        aria-label={t.nav.workspacesDrawer}
        style={{
          width,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          background: "var(--hms-surface)",
          overflow: "hidden",
        }}
      >
        {header}
        {body}
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 32,
  height: 32,
  border: "none",
  borderRadius: 6,
  background: "transparent",
  color: "var(--hms-text-muted)",
  cursor: "pointer",
  flexShrink: 0,
};

// ── Artifacts list ────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  done: "var(--hms-success-text, #16a34a)",
  running: "var(--hms-accent)",
  error: "var(--hms-error-text, #dc2626)",
};

function ArtifactsList({
  artifacts,
  noArtifactsLabel,
}: {
  artifacts: Artifact[];
  noArtifactsLabel: string;
}) {
  if (artifacts.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "var(--hms-text-muted)", fontSize: "var(--hms-text-sm)" }}>
        {noArtifactsLabel}
      </div>
    );
  }

  return (
    <div style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: 2, overflowY: "auto", height: "100%" }}>
      {artifacts.map((a) => (
        <div
          key={a.id}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 10,
            padding: "6px 8px",
            borderRadius: 6,
            background: "var(--hms-surface)",
            border: "1px solid var(--hms-border)",
          }}
        >
          <Wrench size={13} style={{ color: STATUS_COLOR[a.status] ?? "var(--hms-text-muted)", flexShrink: 0, marginTop: 2 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: "var(--hms-text-xs)", fontFamily: "monospace", fontWeight: 600, color: "var(--hms-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {a.toolName}
            </div>
            {a.preview && (
              <div style={{ fontSize: "var(--hms-text-xs)", color: "var(--hms-text-muted)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {a.preview}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
