import { useState } from "react";
import { Sparkles, Copy, Check, ChevronDown, ChevronRight } from "lucide-react";
import { useI18n } from "@/i18n";
import { useProfilePersonalities, type Personality } from "@/hooks/useProfiles";

/** Read-only view of a profile's defined personality overlays
 *  (agent.personalities in its config.yaml). The active overlay is a runtime,
 *  per-chat choice (the /personality picker) — each card offers a one-click
 *  "copy /personality <name>" to apply it in chat. */
export default function Personalities({ profile }: { profile: string }) {
  const { t } = useI18n();
  const { data, isLoading } = useProfilePersonalities(profile);
  const list = data?.personalities ?? [];

  if (isLoading) {
    return <div style={{ color: "var(--hms-text-muted)", fontSize: 'var(--hms-text-sm)' }}>Loading…</div>;
  }
  if (list.length === 0) {
    return <div style={{ color: "var(--hms-text-muted)", fontSize: 'var(--hms-text-sm)' }}>{t.personality.empty}</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 'var(--hms-space-3)' }}>
      <div style={{ color: "var(--hms-text-muted)", fontSize: 'var(--hms-text-sm)' }}>{t.personality.explainer}</div>
      {list.map((p) => <PersonalityCard key={p.name} p={p} />)}
    </div>
  );
}

function PersonalityCard({ p }: { p: Personality }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(`/personality ${p.name}`).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div style={{ border: "1px solid var(--hms-border)", borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-2)' }}>
        <Sparkles size={14} style={{ color: "var(--hms-text-muted)", flexShrink: 0 }} />
        <span style={{ fontWeight: 600, fontSize: 'var(--hms-text-sm)', color: "var(--hms-text)", flex: 1, minWidth: 0 }}>
          {p.name}
        </span>
        <button
          onClick={copy}
          title={t.personality.copyCommand}
          aria-label={t.personality.copyCommand}
          style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", color: "var(--hms-text-muted)", padding: 'var(--hms-space-1)', display: "flex" }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
      {p.description && (
        <div style={{ marginTop: 'var(--hms-space-1)', fontSize: 'var(--hms-text-xs)', color: "var(--hms-text-muted)" }}>
          {p.description}
        </div>
      )}
      {p.prompt && (
        <>
          <button
            onClick={() => setOpen((o) => !o)}
            style={{
              marginTop: 'var(--hms-space-2)', display: "flex", alignItems: "center", gap: 'var(--hms-space-1)',
              background: "none", border: "none", cursor: "pointer",
              color: "var(--hms-text-muted)", fontSize: 'var(--hms-text-xs)', padding: 0,
            }}
          >
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Prompt
          </button>
          {open && (
            <pre style={{
              marginTop: 'var(--hms-space-2)', marginBottom: 0,
              padding: "8px 10px", borderRadius: 6,
              background: "color-mix(in srgb, var(--hms-border) 40%, transparent)",
              fontSize: 'var(--hms-text-xs)', color: "var(--hms-text)",
              whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 220, overflowY: "auto",
            }}>
              {p.prompt}
            </pre>
          )}
        </>
      )}
    </div>
  );
}
