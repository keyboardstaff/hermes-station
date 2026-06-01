import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/i18n";
import PageTopBar from "@/components/layout/PageTopBar";
import { useCapabilityStore, type CapabilityFlags } from "@/store/capabilities";
import { errorMessage } from "@/lib/errors";
import {
  useProviders,
  useKeys,
  useAuxiliary,
  useRefreshProviders,
  useAssignModel,
  type AuxSlot,
  type KeyEntry,
} from "@/hooks/useProviders";
import ModelPickerDialog from "@/components/models/ModelPickerDialog";
import KeyRow from "@/components/models/KeyRow";
import ParetoSlider from "@/components/models/ParetoSlider";
import Button from "@/components/ui/Button";
import { RefreshCw, ArrowRightLeft, Info, AlertTriangle } from "lucide-react";

/**
 * +16 — Models panel.
 *
 * Four hash-routed tabs:
 *   #primary   — primary model w/ CHANGE button (opens ModelPickerDialog)
 *   #auxiliary — 9 upstream slots, each with CHANGE button
 *   #fallback  — clarifies the upstream v0.14 limitation
 *   #keys      — grouped API keys (provider/messaging/tool/...) w/ edit/delete
 */

type Tab = "primary" | "auxiliary" | "fallback" | "keys";
// 9 upstream auxiliary task slots, in canonical order.
const AUX_SLOTS = [
  "vision",
  "web_extract",
  "compression",
  "session_search",
  "skills_hub",
  "approval",
  "mcp",
  "title_generation",
  "curator",
] as const;
type AuxSlotKey = typeof AUX_SLOTS[number];

export default function ModelsPanel() {
  const { t } = useI18n();
  const { caps } = useCapabilityStore();
  const flags = caps?.flags;

  const m = t.modelsPanel;

  // Consume deep-link hash on mount so URL stays clean.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  const tabLabels: Record<Tab, string> = {
    primary:   m?.tabPrimary   ?? "Primary",
    auxiliary: m?.tabAuxiliary ?? "Auxiliary",
    fallback:  m?.tabFallback  ?? "Fallback",
    keys:      m?.tabKeys      ?? "API Keys",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <PageTopBar title={t.nav.models} />
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "var(--hms-space-6)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--hms-space-8, 32px)",
        }}
      >
        {/* Primary */}
        <SectionCard title={tabLabels.primary}>
          <PrimaryTab m={m} flags={flags} />
        </SectionCard>

        {/* Auxiliary */}
        <SectionCard title={tabLabels.auxiliary}>
          <AuxiliaryTab m={m} />
        </SectionCard>

        {/* Fallback */}
        <SectionCard title={tabLabels.fallback}>
          <FallbackTab m={m} />
        </SectionCard>

        {/* API Keys */}
        <SectionCard title={tabLabels.keys}>
          <KeysTab m={m} />
        </SectionCard>
      </div>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2
        style={{
          margin: "0 0 12px",
          fontSize: "var(--hms-text-body)",
          fontWeight: 700,
          color: "var(--hms-text)",
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

// ── Tabs ────────────────────────────────────────────────────────────

type ML = NonNullable<ReturnType<typeof useI18n>["t"]["modelsPanel"]>;

function PrimaryTab({ m, flags }: { m: ML | undefined; flags: CapabilityFlags | undefined }) {
  const { data, isLoading, isError } = useProviders();
  const refreshProviders = useRefreshProviders();
  const assign = useAssignModel();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  if (isLoading) return <LoadingBox />;
  if (isError || !data) {
    return <EmptyState text={m?.providerUnavailable ?? "Provider data unavailable."} />;
  }

  const providers = data.providers ?? [];
  const currentModel = data.model;
  const currentProvider = data.provider;

  const handleSelect = async (provider: string, model: string) => {
    setPickerOpen(false);
    if (!provider || !model) return;
    setStatusMsg(null);
    try {
      await assign.mutateAsync({ scope: "main", provider, model });
      setStatusMsg(m?.savedRestart ?? "Saved. Restart the gateway for changes to take effect.");
    } catch (e: unknown) {
      setStatusMsg(errorMessage(e));
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 'var(--hms-space-3)' }}>
      {/* Current model card */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 'var(--hms-space-3)',
          padding: "14px 16px",
          background: "var(--hms-surface)",
          border: "1px solid var(--hms-border)",
          borderRadius: 10,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 'var(--hms-text-xs)', color: "var(--hms-text-muted)", marginBottom: 4 }}>
            {m?.currentModel ?? "Current model"}
          </div>
          <div style={{ fontFamily: "monospace", fontSize: 'var(--hms-text-body)', fontWeight: 600 }}>
            {currentModel || "--"}
          </div>
          {currentProvider && (
            <div style={{ fontSize: 'var(--hms-text-xs)', color: "var(--hms-text-muted)", marginTop: 2 }}>
              via {currentProvider}
              {data.model_default && currentModel !== data.model_default && (
                <span> · {m?.default ?? "default"}: {data.model_default}</span>
              )}
            </div>
          )}
        </div>
        <Button variant="primary" size="sm" onClick={() => setPickerOpen(true)}>
          <ArrowRightLeft size={12} />
          {m?.change ?? "Change"}
        </Button>
      </div>

      {statusMsg && (
        <div
          style={{
            padding: "8px 12px",
            background: "rgba(34,197,94,0.08)",
            border: "1px solid rgba(34,197,94,0.20)",
            borderRadius: 6,
            color: "var(--hms-success-text)",
            fontSize: 'var(--hms-text-caption)',
          }}
        >
          {statusMsg}
        </div>
      )}

      <div
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
      >
        <span style={{ fontSize: 'var(--hms-text-caption)', color: "var(--hms-text-muted)" }}>
          {providers.length} {m?.providersLabel ?? "providers"}
        </span>
        <Button size="sm" onClick={refreshProviders}>
          <RefreshCw size={12} />
          {m?.refresh ?? "Refresh"}
        </Button>
      </div>

      {/* Provider summary cards (without Test button — keep the layout compact) */}
      {providers.map((p) => (
        <div
          key={p.slug}
          style={{
            padding: "10px 14px",
            background: "var(--hms-surface)",
            border: `1px solid ${p.is_current ? "var(--hms-text)" : "var(--hms-border)"}`,
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            gap: 'var(--hms-space-3)',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", gap: 'var(--hms-space-2)', alignItems: "center" }}>
              <span style={{ fontSize: 'var(--hms-text-sm)', fontWeight: 600 }}>
                {p.name || p.slug}
              </span>
              {p.is_current && (
                <span
                  style={{
                    fontSize: '0.5625rem',
                    padding: "1px 5px",
                    borderRadius: 4,
                    background: "rgba(34,197,94,0.12)",
                    color: "var(--hms-success-text)",
                    fontWeight: 600,
                  }}
                >
                  {m?.current ?? "current"}
                </span>
              )}
              {p.source && p.source !== "built-in" && (
                <span
                  style={{
                    fontSize: '0.5625rem',
                    padding: "1px 5px",
                    borderRadius: 4,
                    background: "var(--hms-border)",
                    color: "var(--hms-text-muted)",
                  }}
                >
                  {p.source}
                </span>
              )}
            </div>
            <div style={{ fontSize: 'var(--hms-text-xs)', color: "var(--hms-text-muted)", marginTop: 2 }}>
              {p.models?.length ?? p.total_models ?? 0} {m?.modelsCount ?? "models"}
            </div>
          </div>
        </div>
      ))}

      {flags?.pareto_code_router && (
        <div style={{ marginTop: 12 }}>
          <ParetoSlider
            value={0.5}
            enabled
            labels={{
              title:       m?.paretoTitle ?? "Pareto Code Router",
              disabled:    m?.paretoDisabled ?? "v0.14+ required",
              description: m?.paretoDesc ?? "Minimum coding score threshold for OpenRouter Pareto routing.",
            }}
          />
        </div>
      )}

      <ModelPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        providers={providers}
        currentModel={currentModel}
        title={m?.pickPrimary ?? "Select primary model"}
        onSelect={handleSelect}
        labels={{
          searchPlaceholder: m?.searchPlaceholder ?? "Search models...",
          noResults:         m?.noResults ?? "No models match the search.",
          auto:              m?.auto ?? "Auto",
          autoHint:          m?.autoHint ?? "Use the active provider's default model.",
          close:             m?.close ?? "Close",
        }}
      />
    </div>
  );
}

function AuxiliaryTab({ m }: { m: ML | undefined }) {
  const { data: providers } = useProviders();
  const { data: aux, isLoading } = useAuxiliary();
  const assign = useAssignModel();
  const [editingSlot, setEditingSlot] = useState<AuxSlotKey | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const slotMap = useMemo(() => {
    const map = new Map<string, AuxSlot>();
    if (aux?.tasks) for (const t of aux.tasks) map.set(t.task, t);
    return map;
  }, [aux]);

  if (isLoading) return <LoadingBox />;

  const handleSelect = async (provider: string, model: string) => {
    const slot = editingSlot;
    setEditingSlot(null);
    if (!slot) return;
    setStatusMsg(null);
    try {
      await assign.mutateAsync({
        scope: "auxiliary",
        provider: provider || "auto",
        model: model || "",
        task: slot,
      });
      setStatusMsg(m?.savedRestart ?? "Saved. Restart the gateway for changes to take effect.");
    } catch (e: unknown) {
      setStatusMsg(errorMessage(e));
    }
  };

  // Slot label helper — uses i18n if present, else falls back to readable form.
  const slotLabel = (slot: AuxSlotKey): string => {
    return (m?.[`aux_${slot}` as keyof ML] as string | undefined) ?? prettySlot(slot);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 'var(--hms-space-2)' }}>
      <p style={{ fontSize: 'var(--hms-text-caption)', color: "var(--hms-text-muted)", margin: "0 0 8px" }}>
        {m?.auxiliaryHintV2 ?? "Each upstream task uses an auxiliary model. Auto resolves to the primary provider's recommended model."}
      </p>

      {statusMsg && (
        <div
          style={{
            padding: "8px 12px",
            background: "rgba(34,197,94,0.08)",
            border: "1px solid rgba(34,197,94,0.20)",
            borderRadius: 6,
            color: "var(--hms-success-text)",
            fontSize: 'var(--hms-text-caption)',
          }}
        >
          {statusMsg}
        </div>
      )}

      {AUX_SLOTS.map((slot) => {
        const entry = slotMap.get(slot);
        const provider = entry?.provider || "auto";
        const model = entry?.model || "";
        const isAuto = provider === "auto" || !model;
        return (
          <div
            key={slot}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 'var(--hms-space-3)',
              padding: "10px 14px",
              background: "var(--hms-surface)",
              border: "1px solid var(--hms-border)",
              borderRadius: 8,
            }}
          >
            <span
              style={{
                fontSize: '0.625rem',
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                color: "var(--hms-text-muted)",
                minWidth: 130,
                flexShrink: 0,
              }}
            >
              {slotLabel(slot)}
            </span>
            <span
              style={{
                flex: 1,
                fontFamily: "monospace",
                fontSize: 'var(--hms-text-caption)',
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                color: isAuto ? "var(--hms-text-muted)" : "var(--hms-text)",
              }}
            >
              {isAuto ? (m?.autoLabel ?? "Auto") : `${provider} / ${model}`}
            </span>
            <Button size="sm" onClick={() => setEditingSlot(slot)}>
              <ArrowRightLeft size={11} />
              {m?.change ?? "Change"}
            </Button>
          </div>
        );
      })}

      <ModelPickerDialog
        open={editingSlot !== null}
        onClose={() => setEditingSlot(null)}
        providers={providers?.providers ?? []}
        currentModel={editingSlot ? slotMap.get(editingSlot)?.model : null}
        allowAuto
        title={
          editingSlot
            ? `${m?.pickAux ?? "Select model for"} ${slotLabel(editingSlot)}`
            : ""
        }
        onSelect={handleSelect}
        labels={{
          searchPlaceholder: m?.searchPlaceholder ?? "Search models...",
          noResults:         m?.noResults ?? "No models match the search.",
          auto:              m?.auto ?? "Auto",
          autoHint:          m?.autoHint ?? "Use the active provider's default model.",
          close:             m?.close ?? "Close",
        }}
      />
    </div>
  );
}

function FallbackTab({ m }: { m: ML | undefined }) {
  // Upstream v0.14 does NOT support a fallback model chain. Be explicit
  // about this rather than expose a broken edit UX.
  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 'var(--hms-space-3)',
          padding: "14px 16px",
          background: "rgba(245,158,11,0.06)",
          border: "1px solid rgba(245,158,11,0.18)",
          borderRadius: 10,
        }}
      >
        <AlertTriangle size={16} style={{ color: "var(--hms-warning)", flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 'var(--hms-text-sm)', lineHeight: 1.5 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {m?.fallbackUnsupportedTitle ?? "Fallback chain not supported"}
          </div>
          <div style={{ color: "var(--hms-text-muted)" }}>
            {m?.fallbackUnsupportedBody ?? "Upstream hermes-agent v0.14 has no fallback-chain configuration — the primary model is used exclusively. Per-provider request/timeout overrides can be set under model.providers in config.yaml."}
          </div>
        </div>
      </div>
    </div>
  );
}

function KeysTab({ m }: { m: ML | undefined }) {
  const { data, isLoading, isError } = useKeys();

  if (isLoading) return <LoadingBox />;
  if (isError || !data || data.error) {
    return (
      <EmptyState
        text={m?.keysUnavailable ?? "Dashboard is not reachable — cannot fetch API keys."}
      />
    );
  }
  if (!data.keys.length) {
    return <EmptyState text={m?.noKeys ?? "No API keys found in the Dashboard environment."} />;
  }

  // Group by category. Unknown / empty categories fall under "other".
  const groups: Record<string, KeyEntry[]> = {};
  for (const k of data.keys) {
    const cat = k.category || "other";
    (groups[cat] ??= []).push(k);
  }
  // Canonical category order — others fall through alphabetically.
  const ORDER = ["provider", "messaging", "tool", "skill", "setting", "other"];
  const sortedCats = Object.keys(groups).sort((a, b) => {
    const ai = ORDER.indexOf(a);
    const bi = ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  const labels = {
    reveal: m?.reveal ?? "Reveal",
    hide: m?.hide ?? "Hide",
    notSet: m?.notSet ?? "(not set)",
    rateLimited: m?.rateLimited ?? "Rate limited",
    edit: m?.edit ?? "Edit",
    delete: m?.delete ?? "Delete",
    confirmDelete: m?.confirmDelete ?? "Remove key",
    editTitle: m?.editTitle ?? "Edit key",
    editValueLabel: m?.editValueLabel ?? "Value",
    editValuePlaceholder: m?.editValuePlaceholder ?? "Paste key value...",
    editSave: m?.editSave ?? "Save",
    editSaving: m?.editSaving ?? "Saving...",
    editCancel: m?.editCancel ?? "Cancel",
    editGetKeyAt: m?.editGetKeyAt ?? "Get a key",
    editClose: m?.close ?? "Close",
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 'var(--hms-space-2)',
          marginBottom: 16,
          padding: "8px 12px",
          background: "rgba(99,102,241,0.06)",
          border: "1px solid rgba(99,102,241,0.18)",
          borderRadius: 6,
          fontSize: 'var(--hms-text-xs)',
          color: "var(--hms-text-muted)",
        }}
      >
        <Info size={12} style={{ color: "var(--hms-accent)", flexShrink: 0 }} />
        <span>
          {m?.keysHintV2 ?? "Edits write to ~/.hermes/.env. Restart the gateway for changes to take effect."}
        </span>
      </div>

      {sortedCats.map((cat) => (
        <div key={cat} style={{ marginBottom: 18 }}>
          <div
            style={{
              fontSize: '0.625rem',
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--hms-text-muted)",
              marginBottom: 8,
            }}
          >
            {(m?.[`cat_${cat}` as keyof ML] as string | undefined) ?? prettyCat(cat)}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 'var(--hms-space-2)' }}>
            {groups[cat].map((k) => (
              <KeyRow key={k.name} entry={k} labels={labels} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function prettySlot(slot: string): string {
  return slot
    .split("_")
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(" ");
}

function prettyCat(cat: string): string {
  return cat[0]?.toUpperCase() + cat.slice(1);
}

function LoadingBox() {
  return (
    <div
      style={{
        padding: 32,
        textAlign: "center",
        color: "var(--hms-text-muted)",
        fontSize: 'var(--hms-text-sm)',
      }}
    >
      Loading...
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: 'var(--hms-space-6)',
        border: "1px dashed var(--hms-border)",
        borderRadius: 8,
        textAlign: "center",
        color: "var(--hms-text-muted)",
        fontSize: 'var(--hms-text-sm)',
      }}
    >
      {text}
    </div>
  );
}


