import { Brain, Trash2 } from "lucide-react";
import { useI18n } from "@/i18n";
import { useMemory, type MemoryFact } from "@/hooks/useMemory";

/** Data sovereignty: review + forget the structured facts the agent has stored
 *  for one profile (the holographic provider's per-profile memory_store.db).
 *  Rendered inside the Profile panel, beside SOUL.md / MEMORY.md / USER.md.
 *  Degrades cleanly when that provider isn't active. */
export default function MemoryFacts({ profile }: { profile: string }) {
  const { t } = useI18n();
  const { query, forget } = useMemory(profile);
  const data = query.data;

  if (query.isLoading) {
    return <div style={{ color: "var(--hms-text-muted)", fontSize: 'var(--hms-text-sm)' }}>Loading…</div>;
  }
  if (data && !data.available) {
    return (
      <div style={{ maxWidth: 520, color: "var(--hms-text-muted)" }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 'var(--hms-space-2)',
          color: "var(--hms-text)", fontWeight: 600, fontSize: 'var(--hms-text-base)',
          marginBottom: 'var(--hms-space-2)',
        }}>
          <Brain size={16} /> {t.memory.unavailable}
        </div>
        <div style={{ fontSize: 'var(--hms-text-sm)' }}>{t.memory.unavailableHint}</div>
      </div>
    );
  }
  if (data?.available && data.facts.length === 0) {
    return <div style={{ color: "var(--hms-text-muted)", fontSize: 'var(--hms-text-sm)' }}>{t.memory.empty}</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 'var(--hms-space-3)' }}>
      <div style={{ color: "var(--hms-text-muted)", fontSize: 'var(--hms-text-sm)' }}>{t.memory.explainer}</div>
      {(data?.facts ?? []).map((f) => (
        <FactCard
          key={f.fact_id}
          fact={f}
          onForget={() => { if (confirm(t.memory.confirmDelete)) forget.mutate(f.fact_id); }}
        />
      ))}
    </div>
  );
}

function FactCard({ fact, onForget }: { fact: MemoryFact; onForget: () => void }) {
  const { t } = useI18n();
  return (
    <div style={{
      border: "1px solid var(--hms-border)",
      borderRadius: 10,
      padding: "12px 14px",
      display: "flex",
      gap: 'var(--hms-space-3)',
      alignItems: "flex-start",
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 'var(--hms-text-sm)', color: "var(--hms-text)", lineHeight: 1.5,
          whiteSpace: "pre-wrap", wordBreak: "break-word",
        }}>
          {fact.content}
        </div>
        <div style={{
          marginTop: 'var(--hms-space-2)', display: "flex", flexWrap: "wrap",
          gap: 'var(--hms-space-2)', fontSize: 'var(--hms-text-xs)', color: "var(--hms-text-muted)",
        }}>
          {fact.category && (
            <span style={{
              background: "var(--hms-border)", borderRadius: 4, padding: "1px 6px",
              textTransform: "uppercase", letterSpacing: "0.04em",
            }}>{fact.category}</span>
          )}
          {fact.tags && <span>{fact.tags}</span>}
          {typeof fact.trust_score === "number" && (
            <span>{t.memory.trust} {Math.round(fact.trust_score * 100)}%</span>
          )}
          {typeof fact.retrieval_count === "number" && fact.retrieval_count > 0 && (
            <span>{t.memory.retrieved} {fact.retrieval_count}×</span>
          )}
          {fact.created_at && <span>{fact.created_at.slice(0, 10)}</span>}
        </div>
      </div>
      <button
        onClick={onForget}
        title={t.memory.delete}
        aria-label={t.memory.delete}
        style={{
          flexShrink: 0, background: "none", border: "none", cursor: "pointer",
          color: "var(--hms-text-muted)", padding: 'var(--hms-space-1)', display: "flex",
        }}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
