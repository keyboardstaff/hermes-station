import { useEffect, useState } from "react";
import Dialog from "@/components/ui/Dialog";
import Button from "@/components/ui/Button";
import { useI18n } from "@/i18n";
import { useRenameProfile } from "@/hooks/useProfiles";
import { errorMessage } from "@/lib/errors";

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

interface Props {
  open: boolean;
  currentName: string;
  onClose: () => void;
  onRenamed: (newName: string) => void;
}

export default function RenameProfileDialog({ open, currentName, onClose, onRenamed }: Props) {
  const { t } = useI18n();
  const rp = t.renameProfile;
  const rename = useRenameProfile();

  const [next, setNext] = useState(currentName);
  const [err, setErr] = useState<string | null>(null);

  // Reset draft when reopened against a different profile.
  useEffect(() => {
    if (open) { setNext(currentName); setErr(null); }
  }, [open, currentName]);

  const submit = async () => {
    const trimmed = next.trim();
    if (!NAME_RE.test(trimmed)) {
      setErr(rp?.invalidName ?? "Name must be lowercase letters / digits / hyphens / underscores (≤64).");
      return;
    }
    if (trimmed === currentName) { onClose(); return; }
    try {
      const r = await rename.mutateAsync({ name: currentName, new_name: trimmed });
      onRenamed(r.name);
      onClose();
    } catch (e) {
      setErr(errorMessage(e));
    }
  };

  return (
    <Dialog
      open={open}
      title={rp?.title ?? "Rename profile"}
      onClose={onClose}
      footer={
        <>
          <Button size="sm" onClick={onClose} disabled={rename.isPending}>
            {rp?.cancel ?? "Cancel"}
          </Button>
          <Button size="sm" variant="primary" onClick={submit} disabled={rename.isPending || !next.trim()}>
            {rename.isPending ? (rp?.renaming ?? "Renaming…") : (rp?.rename ?? "Rename")}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: 'var(--hms-text-sm)' }}>
        <label style={{ color: "var(--hms-text-muted)", fontWeight: 600, fontSize: 'var(--hms-text-caption)' }}>
          {rp?.newName ?? "New name"}
        </label>
        <input
          autoFocus
          value={next}
          onChange={(e) => setNext(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
          style={{
            padding: "0.375rem 0.625rem",
            fontSize: 'var(--hms-text-sm)',
            background: "var(--hms-bg)",
            border: "1px solid var(--hms-border)",
            borderRadius: "0.375rem",
            color: "var(--hms-text)",
            outline: "none",
          }}
        />
        {err && (
          <div style={{
            padding: "0.5rem 0.75rem",
            border: "1px solid rgba(239,68,68,0.18)",
            background: "rgba(239,68,68,0.08)",
            borderRadius: "0.375rem",
            color: "var(--hms-error-text)",
            fontSize: 'var(--hms-text-caption)',
          }}>
            {err}
          </div>
        )}
      </div>
    </Dialog>
  );
}
