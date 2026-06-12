/**
 * +16 — single API key row.
 *
 * Shows masked value, Reveal/Hide toggle, Edit, Delete.
 * - Reveal calls ``POST /api/models/keys/reveal`` (rate-limited 5/30s)
 * - Edit opens a dialog that calls ``PUT /api/models/keys``
 * - Delete calls ``DELETE /api/models/keys`` after confirm
 */

import { useState } from "react";
import { Eye, EyeOff, AlertCircle, Pencil, Trash2, ExternalLink } from "lucide-react";
import type { KeyEntry } from "@/hooks/useProviders";
import { useRevealKey, useDeleteKey } from "@/hooks/useProviders";
import { apiErrorStatus } from "@/lib/errors";
import IconButton from "@/components/ui/IconButton";
import KeyEditDialog from "./KeyEditDialog";

interface Props {
  entry: KeyEntry;
  labels: {
    reveal: string;
    hide: string;
    notSet: string;
    rateLimited: string;
    edit: string;
    delete: string;
    confirmDelete: string;
    // Edit dialog labels
    editTitle: string;
    editValueLabel: string;
    editValuePlaceholder: string;
    editSave: string;
    editSaving: string;
    editCancel: string;
    editGetKeyAt: string;
    editClose: string;
  };
}

export default function KeyRow({ entry, labels }: Props) {
  const reveal = useRevealKey();
  const del = useDeleteKey();
  const [shown, setShown] = useState(false);
  const [clearValue, setClearValue] = useState<string | null>(null);
  const [rateLimited, setRateLimited] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  const handleToggle = async () => {
    // Toggle off: clear the revealed value and collapse.
    if (shown) {
      setShown(false);
      setClearValue(null);
      return;
    }
    setRateLimited(false);
    try {
      const r = await reveal.mutateAsync(entry.name);
      setClearValue(r.value);
      setShown(true);
    } catch (err: unknown) {
      if (apiErrorStatus(err) === 429) {
        setRateLimited(true);
      }
    }
  };

  const handleDelete = async () => {
    const confirmed = window.confirm(`${labels.confirmDelete} ${entry.name}?`);
    if (!confirmed) return;
    try {
      await del.mutateAsync(entry.name);
    } catch {
      /* error surfaces via react-query state — no-op here */
    }
  };

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 'var(--hms-space-2)',
          padding: "8px 12px",
          background: "var(--hms-surface)",
          border: "1px solid var(--hms-border)",
          borderRadius: 8,
          fontSize: 'var(--hms-text-caption)',
        }}
      >
        {/* Key name + description */}
        <div style={{ minWidth: 160, flexShrink: 0, overflow: "hidden" }}>
          <div
            style={{
              fontFamily: "monospace",
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              display: "flex",
              alignItems: "center",
              gap: 'var(--hms-space-1)',
            }}
          >
            {entry.name}
            {entry.url && (
              <a
                href={entry.url}
                target="_blank"
                rel="noopener noreferrer"
                title={entry.url}
                style={{
                  color: "var(--hms-text-muted)",
                  display: "inline-flex",
                  alignItems: "center",
                }}
              >
                <ExternalLink size={10} />
              </a>
            )}
          </div>
          {entry.description && (
            <div
              style={{
                fontSize: '0.625rem',
                color: "var(--hms-text-muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                marginTop: 1,
              }}
            >
              {entry.description}
            </div>
          )}
        </div>

        {/* Value */}
        <span
          style={{
            flex: 1,
            fontFamily: "monospace",
            color: entry.set ? "var(--hms-text-muted)" : "#94a3b8",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: 'var(--hms-text-xs)',
          }}
        >
          {!entry.set
            ? labels.notSet
            : shown && clearValue
              ? clearValue
              : entry.masked || "********"}
        </span>

        {/* Rate-limit indicator */}
        {rateLimited && (
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 'var(--hms-space-1)',
              color: "var(--hms-warning)",
              fontSize: '0.625rem',
              flexShrink: 0,
            }}
          >
            <AlertCircle size={12} />
            {labels.rateLimited}
          </span>
        )}

        {/* Reveal/hide toggle */}
        {entry.set && (
          <IconButton
            size="sm"
            onClick={() => void handleToggle()}
            disabled={reveal.isPending}
            title={shown ? labels.hide : labels.reveal}
          >
            {shown ? <EyeOff size={13} /> : <Eye size={13} />}
          </IconButton>
        )}

        {/* Edit */}
        <IconButton size="sm" onClick={() => setEditOpen(true)} title={labels.edit}>
          <Pencil size={13} />
        </IconButton>

        {/* Delete (only if set) */}
        {entry.set && (
          <IconButton
            size="sm"
            danger
            onClick={() => void handleDelete()}
            disabled={del.isPending}
            title={labels.delete}
          >
            <Trash2 size={13} />
          </IconButton>
        )}
      </div>

      <KeyEditDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        name={entry.name}
        initialValue={shown ? clearValue ?? "" : ""}
        description={entry.description}
        url={entry.url}
        labels={{
          title:            labels.editTitle,
          valueLabel:       labels.editValueLabel,
          valuePlaceholder: labels.editValuePlaceholder,
          save:             labels.editSave,
          saving:           labels.editSaving,
          cancel:           labels.editCancel,
          getKeyAt:         labels.editGetKeyAt,
          close:            labels.editClose,
        }}
      />
    </>
  );
}

