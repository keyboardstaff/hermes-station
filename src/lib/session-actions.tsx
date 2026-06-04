/**
 * session-actions — the single source of truth for per-session actions.
 *
 * Upstream's desktop renders ONE action spec as both a ··· dropdown and a
 * right-click context menu. We mirror that: `buildSessionActions` returns the
 * canonical, ordered, i18n-labelled, capability-gated item list; each surface
 * (the ChatTitleBar dropdown, the SessionRecents context menu) renders the
 * same items its own way. An action is omitted when its handler is absent —
 * so a surface that can't (say) archive simply doesn't show Archive.
 */
import type { ReactNode } from "react";
import {
  Pencil,
  Pin,
  PinOff,
  Copy,
  Download,
  Eraser,
  Archive,
  Trash2,
} from "lucide-react";
import type { Translations } from "@/i18n";

export interface SessionActionItem {
  key: string;
  icon: ReactNode;
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

export interface SessionActionHandlers {
  /** Current pin state — drives the Pin/Unpin label + icon. */
  pinned?: boolean;
  onRename?: () => void;
  onTogglePin?: () => void;
  onCopyId?: () => void;
  onExportJson?: () => void;
  onExportMarkdown?: () => void;
  onExportPdf?: () => void;
  onClearLocal?: () => void;
  onArchive?: () => void;
  onDelete?: () => void;
}

const ICON = 13;

/** Assemble the ordered session-action items for the given handlers. */
export function buildSessionActions(
  t: Translations,
  h: SessionActionHandlers,
): SessionActionItem[] {
  const items: SessionActionItem[] = [];

  if (h.onRename) {
    items.push({ key: "rename", icon: <Pencil size={ICON} />, label: t.nav.renameSession, onSelect: h.onRename });
  }
  if (h.onTogglePin) {
    items.push({
      key: "pin",
      icon: h.pinned ? <PinOff size={ICON} /> : <Pin size={ICON} />,
      label: h.pinned ? t.nav.unpin : t.nav.pin,
      onSelect: h.onTogglePin,
    });
  }
  if (h.onCopyId) {
    items.push({ key: "copyId", icon: <Copy size={ICON} />, label: t.nav.copyId, onSelect: h.onCopyId });
  }
  if (h.onExportJson) {
    items.push({ key: "json", icon: <Download size={ICON} />, label: t.nav.exportJson, onSelect: h.onExportJson });
  }
  if (h.onExportMarkdown) {
    items.push({ key: "md", icon: <Download size={ICON} />, label: t.nav.exportMarkdown, onSelect: h.onExportMarkdown });
  }
  if (h.onExportPdf) {
    items.push({ key: "pdf", icon: <Download size={ICON} />, label: t.nav.exportPdf, onSelect: h.onExportPdf });
  }
  if (h.onClearLocal) {
    items.push({ key: "clear", icon: <Eraser size={ICON} />, label: t.nav.clearLocal, onSelect: h.onClearLocal });
  }
  if (h.onArchive) {
    items.push({ key: "archive", icon: <Archive size={ICON} />, label: t.nav.archiveSession, onSelect: h.onArchive });
  }
  if (h.onDelete) {
    items.push({ key: "delete", icon: <Trash2 size={ICON} />, label: t.nav.deleteSession, onSelect: h.onDelete, danger: true });
  }

  return items;
}
