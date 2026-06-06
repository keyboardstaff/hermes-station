import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, ExternalLink, Image as ImageIcon, FileText, Link2, GitBranch, FilePen } from "lucide-react";
import { useI18n } from "@/i18n";
import { useThemeStore } from "@/store/app";
import { useChatStore } from "@/store/chat";
import {
  collectArtifactsForSession,
  type ArtifactMessage, type ArtifactRecord,
} from "@/lib/artifacts";
import type { ChatMessage } from "@/lib/hermes-types";
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

// Fixed inline width — the panel no longer drag-resizes (owner: fixed width).
const WIDTH = 380;

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
  // Artifacts for THIS session — the same projection the cross-session
  // /artifacts page uses (`collectArtifactsForSession`), scoped to the live
  // chat-store messages so the chat tab and the page classify identically.
  const messages = useChatStore((s) => s.messages);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const artifacts = useMemo(
    () => collectArtifactsForSession(
      { id: activeSessionId ?? "current", title: "" },
      chatToArtifactMessages(messages),
    ),
    [messages, activeSessionId],
  );
  const selected = useFilesSelection((s) => s.selected);
  const setSelected = useFilesSelection((s) => s.setSelected);
  const { resolvedTheme } = useThemeStore();
  const monacoTheme = resolvedTheme === "dark" ? "vs-dark" : "vs";

  const inEditor = tab === "files" && selected !== null;

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
      {/* Jump to the cross-session Artifacts page (same projection, all sessions).
          Uses the same icon as the Files tab's "open full page" button. */}
      {tab === "artifacts" && !inEditor && (
        <button
          type="button"
          onClick={() => navigate("/artifacts")}
          title={f.seeAllArtifacts ?? "See all artifacts"}
          aria-label={f.seeAllArtifacts ?? "See all artifacts"}
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

  // Inline variant — in-flow right column at a fixed width (no drag-resize).
  // Stays mounted and animates its width to 0 on close for a smooth slide.
  return (
    <div
      role="complementary"
      aria-label={t.nav.workspacesDrawer}
      style={{
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        height: "100%",
        minHeight: 0,
        width: open ? WIDTH : 0,
        opacity: open ? 1 : 0,
        overflow: "hidden",
        pointerEvents: open ? "auto" : "none",
        borderLeft: "1px solid var(--hms-border)",
        background: "var(--hms-surface)",
        transition: "width 220ms cubic-bezier(0.25, 0.1, 0.25, 1), opacity 180ms ease",
      }}
    >
      {header}
      {body}
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

/** Adapt live chat-store messages to the extractor's message shape: assistant
 *  text + a synthetic tool_call per tool segment (name + its path/command from
 *  `preview`, so file-edit & git changes are detected) + each tool result.
 *  Mirrors the /artifacts page's raw DB feed, so classification is identical. */
function chatToArtifactMessages(messages: ChatMessage[]): ArtifactMessage[] {
  const out: ArtifactMessage[] = [];
  for (const m of messages) {
    if (m.role === "user") continue;
    const toolCalls: Array<{ function: { name: string; arguments: Record<string, unknown> } }> = [];
    for (const seg of m.segments ?? []) {
      if (seg.type !== "tool") continue;
      const p = seg.tc.preview;
      toolCalls.push({ function: { name: seg.tc.toolName, arguments: p ? { path: p, command: p } : {} } });
      if (seg.tc.result) out.push({ role: "tool", content: seg.tc.result });
    }
    out.push({ role: "assistant", content: m.content ?? "", tool_calls: toolCalls.length ? toolCalls : undefined });
  }
  return out;
}

const KIND_ICON = { image: ImageIcon, file: FileText, link: Link2 } as const;

function isWebOpenable(href: string): boolean {
  return /^(https?:|data:)/i.test(href);
}

function ArtifactsList({
  artifacts,
  noArtifactsLabel,
}: {
  artifacts: ArtifactRecord[];
  noArtifactsLabel: string;
}) {
  const { t } = useI18n();
  const a = t.artifacts;
  if (artifacts.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: "center", color: "var(--hms-text-muted)", fontSize: "var(--hms-text-sm)" }}>
        {noArtifactsLabel}
      </div>
    );
  }

  const edits = artifacts.filter((x) => x.group === "edit");
  const gits = artifacts.filter((x) => x.group === "git");
  const refs = artifacts.filter((x) => x.group === "ref");

  return (
    <div style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: 'var(--hms-space-3)', overflowY: "auto", height: "100%" }}>
      <ArtifactGroupSection title={a.groupChanges} items={edits} />
      <ArtifactGroupSection title={a.groupGit} items={gits} />
      <ArtifactGroupSection title={a.groupReferences} items={refs} />
    </div>
  );
}

function ArtifactGroupSection({ title, items }: { title: string; items: ArtifactRecord[] }) {
  if (items.length === 0) return null;
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 'var(--hms-space-1)' }}>
      <div style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-1)', fontSize: "var(--hms-text-xs)", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--hms-text-muted)", padding: "2px 2px" }}>
        {title} <span style={{ opacity: 0.7 }}>{items.length}</span>
      </div>
      {items.map((a) => <ArtifactRow key={a.id} a={a} />)}
    </section>
  );
}

function ArtifactRow({ a }: { a: ArtifactRecord }) {
  const openable = isWebOpenable(a.href);
  const Icon = a.group === "git" ? GitBranch : a.group === "edit" ? FilePen : KIND_ICON[a.kind];
  const inner = (
    <>
      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, flexShrink: 0, borderRadius: 6, overflow: "hidden", background: "var(--hms-hover-bg)", color: "var(--hms-text-muted)" }}>
        {a.group === "ref" && a.kind === "image" && openable
          ? <img src={a.href} alt={a.label} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <Icon size={13} />}
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: "block", fontSize: "var(--hms-text-xs)", fontWeight: 600, color: "var(--hms-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {a.label}
        </span>
        {a.group !== "git" && (
          <span style={{ display: "block", fontSize: "var(--hms-text-xs)", fontFamily: a.kind === "link" ? undefined : "monospace", color: "var(--hms-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {a.value}
          </span>
        )}
      </span>
      {openable && <ExternalLink size={12} style={{ flexShrink: 0, color: "var(--hms-text-muted)" }} />}
    </>
  );
  const rowStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 8, padding: "5px 8px",
    borderRadius: 6, background: "var(--hms-surface)", border: "1px solid var(--hms-border)",
    textDecoration: "none", color: "var(--hms-text)",
  };
  return openable
    ? <a href={a.href} target="_blank" rel="noreferrer" title={a.value} style={rowStyle}>{inner}</a>
    : <div title={a.value} style={rowStyle}>{inner}</div>;
}
