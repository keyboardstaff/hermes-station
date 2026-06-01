import { ChevronLeft } from "lucide-react";
import { useI18n } from "@/i18n";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import type { FileRoot } from "@/hooks/useFiles";

/**
 * Path breadcrumb shown above the file editor when the side tree is
 * hidden (drawer mode, mobile detail view). Layout:
 *
 *   [←]  hermes  /  docs  /  ARCHITECTURE.md
 *    ▲     ▲         ▲          ▲
 *    |     |         |          └ current file, bold, ellipsis-truncated
 *    |     |         └ middle directories — muted, context only
 *    |     └ root label — clickable, returns to tree
 *    └ icon back — clickable, returns to tree
 *
 * The back arrow and the root label both clear the selection. Middle
 * dir segments are intentionally non-interactive — we don't have a
 * "scroll the tree to this dir" affordance yet and a no-op click would
 * confuse users.
 *
 * `chrome="bar"` — default; renders the breadcrumb as a self-contained
 * 36 px bar with its own bottom border (use in mobile back-bar).
 *
 * `chrome="inline"` — strips height / border / background so the
 * breadcrumb can be slotted into an existing header (use in the chat
 * `WorkspaceContextPanel` header that already owns the border).
 */
export default function FileBreadcrumb({
  root,
  path,
  onBack,
  chrome = "bar",
}: {
  root: FileRoot;
  path: string;
  onBack: () => void;
  chrome?: "bar" | "inline";
}) {
  const { t } = useI18n();
  const f = t.files;
  const wsQuery = useWorkspaces();

  const rootLabel = root === "hermes"
    ? f.rootHermes
    : wsQuery.data?.workspaces.find((w) => w.id === wsQuery.data?.active_id)?.name
      ?? f.rootWorkspace;

  const segments = path.split("/").filter(Boolean);
  const filename = segments.pop() ?? path;

  const wrapperStyle: React.CSSProperties = chrome === "bar"
    ? {
        display: "flex",
        alignItems: "center",
        gap: "var(--hms-space-1)",
        padding: "0 var(--hms-space-3)",
        height: 36,
        borderBottom: "1px solid var(--hms-border)",
        background: "var(--hms-surface)",
        flexShrink: 0,
        minWidth: 0,
      }
    : {
        display: "flex",
        alignItems: "center",
        gap: "var(--hms-space-1)",
        minWidth: 0,
        flex: 1,
      };

  return (
    <div style={wrapperStyle}>
      <button
        type="button"
        onClick={onBack}
        aria-label={t.common.back}
        title={t.common.back}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 24,
          height: 24,
          border: "none",
          borderRadius: 4,
          background: "transparent",
          color: "var(--hms-text-muted)",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        <ChevronLeft size={15} />
      </button>

      <nav
        aria-label="path"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          fontSize: "var(--hms-text-xs)",
          fontFamily: "monospace",
          minWidth: 0,
          flex: 1,
        }}
      >
        <button
          type="button"
          onClick={onBack}
          style={{
            ...segmentBtn,
            color: "var(--hms-text-muted)",
            flexShrink: 0,
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--hms-text)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = "var(--hms-text-muted)"; }}
        >
          {rootLabel}
        </button>
        {segments.map((seg, i) => (
          <span key={i} style={{ display: "flex", alignItems: "center", color: "var(--hms-text-muted)", minWidth: 0 }}>
            <span style={separator}>/</span>
            <span
              title={seg}
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: 120,
              }}
            >
              {seg}
            </span>
          </span>
        ))}
        <span style={{ display: "flex", alignItems: "center", minWidth: 0, flex: 1 }}>
          <span style={separator}>/</span>
          <span
            title={filename}
            style={{
              color: "var(--hms-text)",
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
            }}
          >
            {filename}
          </span>
        </span>
      </nav>
    </div>
  );
}

const segmentBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: "2px 4px",
  borderRadius: 4,
  fontFamily: "monospace",
  fontSize: "var(--hms-text-xs)",
  transition: "color var(--hms-duration-fast)",
};

const separator: React.CSSProperties = {
  margin: "0 4px",
  color: "var(--hms-text-muted)",
  opacity: 0.6,
  flexShrink: 0,
};
