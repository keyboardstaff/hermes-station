import { ChevronLeft } from "lucide-react";
import { useI18n } from "@/i18n";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import type { FileRoot } from "@/hooks/useFiles";
import IconButton from "@/components/ui/IconButton";

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

  return (
    <div className="hms-file-breadcrumb" data-chrome={chrome}>
      <IconButton
        type="button"
        onClick={onBack}
        aria-label={t.common.back}
        title={t.common.back}
        size="sm"
        style={{ width: 24, height: 24, borderRadius: 4 }}
      >
        <ChevronLeft size={15} />
      </IconButton>

      <nav aria-label="path" className="hms-file-breadcrumb-nav">
        <button
          type="button"
          onClick={onBack}
          className="hms-file-breadcrumb-root"
        >
          {rootLabel}
        </button>
        {segments.map((seg, i) => (
          <span key={i} className="hms-file-breadcrumb-seg">
            <span className="hms-file-breadcrumb-sep">/</span>
            <span title={seg} className="hms-file-breadcrumb-seg-name">{seg}</span>
          </span>
        ))}
        <span className="hms-file-breadcrumb-last">
          <span className="hms-file-breadcrumb-sep">/</span>
          <span title={filename} className="hms-file-breadcrumb-filename">{filename}</span>
        </span>
      </nav>
    </div>
  );
}


