import { useState } from "react";
import Dialog from "@/components/ui/Dialog";
import Button from "@/components/ui/Button";
import { useI18n } from "@/i18n";
import {
  useCreateProfile,
  useProfiles,
  type CreateProfileBody,
} from "@/hooks/useProfiles";
import { errorMessage } from "@/lib/errors";

/** Lower-snake/hyphen, ≤64 chars — mirrors upstream profiles._PROFILE_ID_RE. */
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (name: string) => void;
}

export default function CreateProfileDialog({ open, onClose, onCreated }: Props) {
  const { t } = useI18n();
  const cp = t.createProfile;
  const { data } = useProfiles();
  const create = useCreateProfile();

  const [name, setName] = useState("");
  const [cloneFrom, setCloneFrom] = useState<string>("");
  const [model, setModel] = useState("");
  const [provider, setProvider] = useState("");
  const [noSkills, setNoSkills] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reset = () => {
    setName(""); setCloneFrom(""); setModel("");
    setProvider(""); setNoSkills(false); setErr(null);
  };
  const close = () => { reset(); onClose(); };

  const submit = async () => {
    const trimmed = name.trim();
    if (!NAME_RE.test(trimmed)) {
      setErr(cp?.invalidName ?? "Name must be lowercase letters / digits / hyphens / underscores (≤64).");
      return;
    }
    const body: CreateProfileBody = {
      name: trimmed,
      no_skills: noSkills,
    };
    if (cloneFrom) body.clone_from = cloneFrom;
    if (model.trim()) body.model = model.trim();
    if (provider.trim()) body.provider = provider.trim();
    try {
      const r = await create.mutateAsync(body);
      onCreated(r.name);
      close();
    } catch (e) {
      setErr(errorMessage(e));
    }
  };

  const profiles = data?.profiles ?? [];

  return (
    <Dialog
      open={open}
      title={cp?.title ?? "New profile"}
      onClose={close}
      footer={
        <>
          <Button size="sm" onClick={close} disabled={create.isPending}>
            {cp?.cancel ?? "Cancel"}
          </Button>
          <Button size="sm" variant="primary" onClick={submit} disabled={create.isPending || !name.trim()}>
            {create.isPending ? (cp?.creating ?? "Creating…") : (cp?.create ?? "Create")}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        <Field label={cp?.name ?? "Name"}>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
            placeholder="my-profile"
            style={textInput}
          />
        </Field>

        <Field label={cp?.cloneFrom ?? "Clone from"} hint={cp?.cloneFromHint ?? "Leave empty for a clean profile."}>
          <select
            value={cloneFrom}
            onChange={(e) => setCloneFrom(e.target.value)}
            style={textInput}
          >
            <option value="">{cp?.none ?? "(none)"}</option>
            {profiles.map((p) => (
              <option key={p.name} value={p.name}>{p.name}</option>
            ))}
          </select>
        </Field>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
          <Field label={cp?.model ?? "Model (optional)"}>
            <input value={model} onChange={(e) => setModel(e.target.value)} style={textInput} placeholder="gpt-4o" />
          </Field>
          <Field label={cp?.provider ?? "Provider (optional)"}>
            <input value={provider} onChange={(e) => setProvider(e.target.value)} style={textInput} placeholder="openai" />
          </Field>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: 'var(--hms-text-sm)' }}>
          <input type="checkbox" checked={noSkills} onChange={(e) => setNoSkills(e.target.checked)} />
          {cp?.noSkills ?? "Skip bundled skills"}
        </label>

        {err && (
          <div style={{
            padding: "0.5rem 0.75rem",
            border: "1px solid var(--hms-error-border)",
            background: "var(--hms-error-weak)",
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

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: 'var(--hms-text-caption)' }}>
      <span style={{ color: "var(--hms-text-muted)", fontWeight: 600 }}>{label}</span>
      {children}
      {hint && <span style={{ color: "var(--hms-text-muted)", fontSize: 'var(--hms-text-xs)' }}>{hint}</span>}
    </label>
  );
}

const textInput: React.CSSProperties = {
  padding: "0.375rem 0.625rem",
  fontSize: 'var(--hms-text-sm)',
  background: "var(--hms-bg)",
  border: "1px solid var(--hms-border)",
  borderRadius: "0.375rem",
  color: "var(--hms-text)",
  outline: "none",
};
