import { useState } from "react";
import { ChevronRight, Pencil, ArrowUp, Trash2 } from "lucide-react";
import { useI18n } from "@/i18n";
import type { QueuedPromptEntry } from "@/store/composer-queue";

/**
 * Queued-prompts panel above the composer (desktop parity): a collapsed
 * "N queued" disclosure header; expanded rows show a one-line preview with
 * hover-revealed Edit / Send-now / Delete actions. Send-now while busy
 * promotes + interrupts (the settle auto-drain delivers it).
 */
export default function QueuePanel({
  busy, editingId, entries, onDelete, onEdit, onSendNow,
}: {
  busy: boolean;
  editingId: string | null;
  entries: QueuedPromptEntry[];
  onDelete: (id: string) => void;
  onEdit: (entry: QueuedPromptEntry) => void;
  onSendNow: (id: string) => void;
}) {
  const { t } = useI18n();
  const c = t.composer;
  const [collapsed, setCollapsed] = useState(true);

  if (entries.length === 0) return null;

  return (
    <div className="hms-queue-panel">
      <button
        type="button"
        className="hms-queue-head"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((v) => !v)}
      >
        <ChevronRight size={11} className="hms-queue-chevron" data-open={!collapsed || undefined} />
        <span className="hms-queue-count">
          {entries.length} {c?.queuedLabel ?? "queued"}
        </span>
      </button>

      {!collapsed && (
        <div className="hms-queue-rows">
          {entries.map((entry) => {
            const isEditing = editingId === entry.id;
            const preview =
              entry.text.trim() ||
              (entry.attachments.length > 0 ? (c?.attachmentOnly ?? "(attachment only)") : "");
            const sendLabel = busy
              ? (c?.sendQueuedNext ?? "Send next (interrupts the current turn)")
              : (c?.sendQueuedNow ?? "Send now");
            return (
              <div key={entry.id} className="hms-queue-row" data-editing={isEditing || undefined}>
                <span className="hms-queue-dot" aria-hidden />
                <div className="hms-queue-main">
                  <p className="hms-queue-preview">{preview}</p>
                  {(entry.attachments.length > 0 || isEditing) && (
                    <div className="hms-queue-meta">
                      {entry.attachments.length > 0 && (
                        <span>{entry.attachments.length} {c?.attachmentsLabel ?? "attachments"}</span>
                      )}
                      {isEditing && (
                        <span className="hms-queue-editing">{c?.editingInComposer ?? "Editing in composer"}</span>
                      )}
                    </div>
                  )}
                </div>
                <div className="hms-queue-actions">
                  <button
                    type="button"
                    className="hms-queue-btn"
                    title={c?.editQueued ?? "Edit"}
                    aria-label={c?.editQueued ?? "Edit"}
                    disabled={Boolean(editingId) && !isEditing}
                    onClick={() => onEdit(entry)}
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    type="button"
                    className="hms-queue-btn"
                    title={sendLabel}
                    aria-label={sendLabel}
                    disabled={isEditing}
                    onClick={() => onSendNow(entry.id)}
                  >
                    <ArrowUp size={11} />
                  </button>
                  <button
                    type="button"
                    className="hms-queue-btn"
                    title={c?.deleteQueued ?? "Delete"}
                    aria-label={c?.deleteQueued ?? "Delete"}
                    onClick={() => onDelete(entry.id)}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
