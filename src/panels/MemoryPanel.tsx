import { Brain, Trash2 } from "lucide-react";
import PageTopBar from "@/components/layout/PageTopBar";
import { useI18n } from "@/i18n";
import { useMemory, type MemoryFact } from "@/hooks/useMemory";

/** Data sovereignty: review + forget the facts the agent has stored about you
 *  (the holographic provider's local memory_store.db). Degrades cleanly when
 *  that provider isn't the active one. */
export default function MemoryPanel() {
  const { t } = useI18n();
  const { query, forget } = useMemory();
  const data = query.data;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <PageTopBar
        title={t.nav.memory}
        subtitle={data?.available ? `${data.facts.length} items` : ""}
      />
      <div style={{ flex: 1, overflowY: "auto", padding: 'var(--hms-space-5)' }}>
        {query.isLoading && (
          <div style={{ color: "var(--hms-text-muted)", fontSize: 'var(--hms-text-sm)' }}>Loading…</div>
        )}

        {!query.isLoading && data && !data.available && (
          <div style={{ maxWidth: 480, color: "var(--hms-text-muted)" }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 'var(--hms-space-2)',
              color: "var(--hms-text)", fontWeight: 600, fontSize: 'var(--hms-text-base)',
              marginBottom: 'var(--hms-space-2)',
            }}>
              <Brain size={16} /> {t.memory.unavailable}
            </div>
            <div style={{ fontSize: 'var(--hms-text-sm)' }}>{t.memory.unavailableHint}</div>
          </div>
        )}

        {!query.isLoading && data?.available && data.facts.length === 0 && (
          <div style={{ color: "var(--hms-text-muted)", fontSize: 'var(--hms-text-sm)' }}>{t.memory.empty}</div>
        )}

        {!query.isLoading && data?.available && data.facts.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 'var(--hms-space-3)', maxWidth: 760 }}>
            <div style={{ color: "var(--hms-text-muted)", fontSize: 'var(--hms-text-sm)' }}>{t.memory.explainer}</div>
            {data.facts.map((f) => (
              <FactCard
                key={f.fact_id}
                fact={f}
                onForget={() => { if (confirm(t.memory.confirmDelete)) forget.mutate(f.fact_id); }}
              />
            ))}
          </div>
        )}
      </div>
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
