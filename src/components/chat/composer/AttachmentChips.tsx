import { X, FileText } from "lucide-react";
import type { ComposerAttachment } from "@/lib/hermes-types";

// Attachment chip row (images → thumbnail, others → file chip), extracted from
// Composer (owner-review D7).
export function AttachmentChips({
  attachments,
  onRemove,
}: {
  attachments: ComposerAttachment[];
  onRemove: (id: string) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 'var(--hms-space-2)', padding: "8px 12px 0" }}>
      {attachments.map((att) => (
        <div
          key={att.id}
          style={{
            position: "relative",
            display: "inline-flex", alignItems: "center", gap: 'var(--hms-space-1)',
            padding: att.isImage ? 0 : "2px 8px",
            borderRadius: att.isImage ? 8 : 20,
            border: "1px solid var(--hms-border)",
            background: "var(--hms-bg)",
            fontSize: 'var(--hms-text-caption)',
            overflow: "hidden",
          }}
        >
          {att.isImage ? (
            /* Thumbnail for images */
            <>
              <img
                src={att.content}
                alt={att.name}
                style={{ width: 60, height: 60, objectFit: "cover", display: "block" }}
              />
              <button
                onClick={() => onRemove(att.id)}
                style={{
                  position: "absolute", top: 2, right: 2,
                  border: "none", background: "rgba(0,0,0,0.55)", cursor: "pointer",
                  padding: 0, display: "flex", color: "#fff",
                  borderRadius: "50%", width: 16, height: 16,
                  alignItems: "center", justifyContent: "center",
                }}
              >
                <X size={10} />
              </button>
            </>
          ) : (
            /* Chip for text files */
            <>
              <FileText size={11} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>{att.name}</span>
              <button
                onClick={() => onRemove(att.id)}
                style={{ border: "none", background: "none", cursor: "pointer", padding: 0, display: "flex", color: "var(--hms-text-muted)" }}
              >
                <X size={11} />
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
