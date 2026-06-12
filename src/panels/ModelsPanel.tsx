import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/i18n";
import ProfileScopeSelector from "@/components/chat/ProfileScopeSelector";
import { useCapabilityStore, type CapabilityFlags } from "@/store/capabilities";
import { errorMessage } from "@/lib/errors";
import {
  useProviders,
  useKeys,
  useAuxiliary,
  useRefreshProviders,
  useAssignModel,
  useFallback,
  useSetFallback,
  type AuxSlot,
  type KeyEntry,
} from "@/hooks/useProviders";
import ModelPickerDialog from "@/components/models/ModelPickerDialog";
import KeyRow from "@/components/models/KeyRow";
import ParetoSlider from "@/components/models/ParetoSlider";
import Button from "@/components/ui/Button";
import IconButton from "@/components/ui/IconButton";
import StatusBadge from "@/components/ui/StatusBadge";
import Switch from "@/components/ui/Switch";
import {
  RefreshCw, ArrowRightLeft, Info, Plus, Trash2, ArrowUp, ArrowDown, ChevronRight,
} from "lucide-react";

/**
 * Models panel — progressive disclosure.
 *
 * Primary and API Keys stay open (the everyday surfaces); Auxiliary and
 * Fallback collapse into summary headers (slots customized / chain length).
 * A top filter box narrows aux slots, fallback entries and key names at once
 * and force-opens the collapsed sections while active; Auxiliary additionally
 * offers a "modified only" switch that hides slots still on Auto.
 */

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

/** A slot counts as customized once it pins a concrete provider/model (not Auto). */
function isCustomized(entry: AuxSlot | undefined): boolean {
  return !!entry && entry.provider !== "auto" && !!entry.model;
}

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

  const [query, setQuery] = useState("");
  const [auxOpen, setAuxOpen] = useState(false);
  const [fbOpen, setFbOpen] = useState(false);
  const filter = query.trim().toLowerCase();
  const filtering = filter.length > 0;

  // Collapsed-header summaries read the same react-query caches the section
  // bodies use, so these extra hook calls don't add requests.
  const { data: auxData } = useAuxiliary();
  const { data: fbData } = useFallback();
  const auxModified = useMemo(() => {
    if (!auxData?.tasks) return null;
    const byTask = new Map(auxData.tasks.map((e) => [e.task, e]));
    return AUX_SLOTS.filter((s) => isCustomized(byTask.get(s))).length;
  }, [auxData]);

  return (
    <div className="hms-models-root">
      <div className="hms-models-body">
        {/* Filter + profile scope — which profile's keys/config this page
            reads/writes (the page header is gone now that Models lives
            inside Settings). */}
        <div className="hms-models-scope-row">
          <input
            type="text"
            className="hms-input hms-models-filter-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={m?.filterPlaceholder ?? "Filter slots and keys..."}
          />
          <ProfileScopeSelector />
        </div>

        {/* Primary — always open */}
        <SectionCard title={m?.tabPrimary ?? "Primary"}>
          <PrimaryTab m={m} flags={flags} />
        </SectionCard>

        {/* Auxiliary — collapsed by default; header shows customized count */}
        <CollapsibleSection
          title={m?.tabAuxiliary ?? "Auxiliary"}
          summary={
            auxModified !== null
              ? `${auxModified}/${AUX_SLOTS.length} ${m?.modifiedLabel ?? "modified"}`
              : undefined
          }
          open={filtering || auxOpen}
          onToggle={() => setAuxOpen((v) => !v)}
        >
          <AuxiliaryTab m={m} filter={filter} />
        </CollapsibleSection>

        {/* Fallback — collapsed by default; header shows chain length */}
        <CollapsibleSection
          title={m?.tabFallback ?? "Fallback"}
          summary={fbData ? `${fbData.chain?.length ?? 0} ${m?.modelsCount ?? "models"}` : undefined}
          open={filtering || fbOpen}
          onToggle={() => setFbOpen((v) => !v)}
        >
          <FallbackTab m={m} filter={filter} />
        </CollapsibleSection>

        {/* API Keys — always open */}
        <SectionCard title={m?.tabKeys ?? "API Keys"}>
          <KeysTab m={m} filter={filter} />
        </SectionCard>
      </div>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="hms-models-section-title">{title}</h2>
      {children}
    </section>
  );
}

function CollapsibleSection({
  title, summary, open, onToggle, children,
}: {
  title: string;
  summary?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="hms-models-collapse" data-open={open || undefined}>
      <button
        type="button"
        className="hms-models-collapse-head"
        aria-expanded={open}
        onClick={onToggle}
      >
        <ChevronRight size={14} className="hms-models-collapse-chevron" />
        <span className="hms-models-collapse-title">{title}</span>
        {summary && <span className="hms-models-collapse-summary">{summary}</span>}
      </button>
      {open && <div className="hms-models-collapse-body">{children}</div>}
    </section>
  );
}

// ── Sections ────────────────────────────────────────────────────────

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
    <div className="hms-models-tab">
      {/* Current model card */}
      <div className="hms-models-current">
        <div className="hms-models-main">
          <div className="hms-models-label">{m?.currentModel ?? "Current model"}</div>
          <div className="hms-models-current-model">{currentModel || "--"}</div>
          {currentProvider && (
            <div className="hms-models-current-via">
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
        <div className="hms-settings-notice hms-settings-notice--success">
          {statusMsg}
        </div>
      )}

      <div className="hms-models-toolbar">
        <span className="hms-models-muted-caption">
          {providers.length} {m?.providersLabel ?? "providers"}
        </span>
        <Button size="sm" onClick={refreshProviders}>
          <RefreshCw size={12} />
          {m?.refresh ?? "Refresh"}
        </Button>
      </div>

      {/* Provider summary cards (without Test button — keep the layout compact) */}
      {providers.map((p) => (
        <div key={p.slug} className="hms-models-provider" data-current={p.is_current || undefined}>
          <div className="hms-models-main">
            <div className="hms-models-provider-namerow">
              <span className="hms-models-provider-name">{p.name || p.slug}</span>
              {p.is_current && (
                <StatusBadge tone="success" uppercase={false}>{m?.current ?? "current"}</StatusBadge>
              )}
              {p.source && p.source !== "built-in" && (
                <StatusBadge tone="muted" uppercase={false}>{p.source}</StatusBadge>
              )}
            </div>
            <div className="hms-models-provider-count">
              {p.models?.length ?? p.total_models ?? 0} {m?.modelsCount ?? "models"}
            </div>
          </div>
        </div>
      ))}

      {flags?.pareto_code_router && (
        <div className="hms-models-pareto">
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

function AuxiliaryTab({ m, filter }: { m: ML | undefined; filter: string }) {
  const { data: providers } = useProviders();
  const { data: aux, isLoading } = useAuxiliary();
  const assign = useAssignModel();
  const [editingSlot, setEditingSlot] = useState<AuxSlotKey | null>(null);
  const [modifiedOnly, setModifiedOnly] = useState(false);
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

  const visibleSlots = AUX_SLOTS.filter((slot) => {
    const entry = slotMap.get(slot);
    if (modifiedOnly && !isCustomized(entry)) return false;
    if (!filter) return true;
    const value = `${entry?.provider ?? ""}/${entry?.model ?? ""}`.toLowerCase();
    return (
      slotLabel(slot).toLowerCase().includes(filter) ||
      slot.includes(filter) ||
      value.includes(filter)
    );
  });

  return (
    <div className="hms-models-aux">
      <div className="hms-models-aux-toolbar">
        <p className="hms-models-hint">
          {m?.auxiliaryHintV2 ?? "Each upstream task uses an auxiliary model. Auto resolves to the primary provider's recommended model."}
        </p>
        <div className="hms-models-toggle">
          <span className="hms-models-muted-caption">{m?.modifiedOnly ?? "Modified only"}</span>
          <Switch checked={modifiedOnly} onChange={setModifiedOnly} />
        </div>
      </div>

      {statusMsg && (
        <div className="hms-settings-notice hms-settings-notice--success">
          {statusMsg}
        </div>
      )}

      {visibleSlots.length === 0 && (
        <EmptyState
          text={
            modifiedOnly && !filter
              ? m?.noModified ?? "All slots are Auto — nothing customized yet."
              : m?.noMatches ?? "Nothing matches the filter."
          }
        />
      )}

      {visibleSlots.map((slot) => {
        const entry = slotMap.get(slot);
        const provider = entry?.provider || "auto";
        const model = entry?.model || "";
        const isAuto = provider === "auto" || !model;
        return (
          <div key={slot} className="hms-models-provider">
            <span className="hms-models-aux-label">{slotLabel(slot)}</span>
            <span className="hms-models-aux-value" data-auto={isAuto || undefined}>
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

function FallbackTab({ m, filter }: { m: ML | undefined; filter: string }) {
  // Fallback chain = `fallback_providers` (+ legacy `fallback_model`) — the
  // models GatewayRunner tries, in order, when the primary model fails.
  const { data: fb, isLoading } = useFallback();
  const { data: providersData } = useProviders();
  const setFallback = useSetFallback();
  const [pickerOpen, setPickerOpen] = useState(false);

  const chain = fb?.chain ?? [];

  const commit = (next: { provider: string; model: string }[]) => setFallback.mutate(next);

  const handleAdd = (provider: string, model: string) => {
    setPickerOpen(false);
    if (!provider || !model) return;
    if (chain.some((e) => e.provider === provider && e.model === model)) return;
    commit([...chain, { provider, model }]);
  };
  const removeAt = (i: number) => commit(chain.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= chain.length) return;
    const next = chain.map((e) => ({ provider: e.provider, model: e.model }));
    [next[i], next[j]] = [next[j], next[i]];
    commit(next);
  };

  if (isLoading) return <LoadingBox />;

  // Filtered view keeps original chain indices so move/remove stay correct.
  const visible = chain
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => !filter || `${entry.provider}/${entry.model}`.toLowerCase().includes(filter));

  return (
    <div className="hms-models-aux">
      <p className="hms-models-hint">
        {m?.fallbackHint ?? "When the primary model fails, these are tried in order."}
      </p>

      {chain.length === 0 ? (
        <EmptyState text={m?.fallbackEmpty ?? "No fallback models — add one to retry on failure."} />
      ) : visible.length === 0 ? (
        <EmptyState text={m?.noMatches ?? "Nothing matches the filter."} />
      ) : (
        visible.map(({ entry: e, index: i }) => (
          <div key={`${e.provider}/${e.model}/${i}`} className="hms-models-provider">
            <span className="hms-models-fallback-index">{i + 1}</span>
            <span className="hms-models-aux-value">{e.provider} / {e.model}</span>
            <IconButton
              size="sm"
              title={m?.moveUp ?? "Move up"}
              disabled={i === 0 || setFallback.isPending}
              onClick={() => move(i, -1)}
            >
              <ArrowUp size={12} />
            </IconButton>
            <IconButton
              size="sm"
              title={m?.moveDown ?? "Move down"}
              disabled={i === chain.length - 1 || setFallback.isPending}
              onClick={() => move(i, 1)}
            >
              <ArrowDown size={12} />
            </IconButton>
            <IconButton
              size="sm"
              danger
              title={m?.remove ?? "Remove"}
              disabled={setFallback.isPending}
              onClick={() => removeAt(i)}
            >
              <Trash2 size={12} />
            </IconButton>
          </div>
        ))
      )}

      <div>
        <Button size="sm" onClick={() => setPickerOpen(true)}>
          <Plus size={12} />
          {m?.addFallback ?? "Add fallback model"}
        </Button>
      </div>

      <ModelPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        providers={providersData?.providers ?? []}
        currentModel={null}
        title={m?.addFallback ?? "Add fallback model"}
        onSelect={handleAdd}
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

function KeysTab({ m, filter }: { m: ML | undefined; filter: string }) {
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

  const keys = filter
    ? data.keys.filter((k) => k.name.toLowerCase().includes(filter))
    : data.keys;
  if (!keys.length) {
    return <EmptyState text={m?.noMatches ?? "Nothing matches the filter."} />;
  }

  // Group by category. Unknown / empty categories fall under "other".
  const groups: Record<string, KeyEntry[]> = {};
  for (const k of keys) {
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
      <div className="hms-settings-notice hms-settings-notice--info hms-models-notice-inline">
        <Info size={12} className="hms-models-notice-info-icon" />
        <span>
          {m?.keysHintV2 ?? "Edits write to ~/.hermes/.env. Restart the gateway for changes to take effect."}
        </span>
      </div>

      {sortedCats.map((cat) => (
        <div key={cat} className="hms-models-cat">
          <div className="hms-models-cat-label">
            {(m?.[`cat_${cat}` as keyof ML] as string | undefined) ?? prettyCat(cat)}
          </div>
          <div className="hms-models-cat-rows">
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
  return <div className="hms-models-loading">Loading...</div>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="hms-models-empty">{text}</div>;
}
