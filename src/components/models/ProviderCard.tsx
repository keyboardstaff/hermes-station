import { useState } from "react";
import { ChevronRight, Zap } from "lucide-react";
import { useI18n } from "@/i18n";
import {
  useAssignModel,
  useTestProvider,
  useFallback,
  useSetFallback,
  type ProviderInfo,
  type KeyEntry,
} from "@/hooks/useProviders";
import { AUX_SLOTS, prettySlot } from "@/components/models/aux-slots";
import { buildKeyRowLabels } from "@/components/models/key-labels";
import KeyRow from "@/components/models/KeyRow";
import { PopupSelect, type PopupSelectOption } from "@/components/ui/PopupSelect";
import Button from "@/components/ui/Button";
import StatusBadge from "@/components/ui/StatusBadge";
import { errorMessage } from "@/lib/errors";

type ML = NonNullable<ReturnType<typeof useI18n>["t"]["modelsPanel"]>;

/**
 * Provider-centric card — the provider is the first-class entity: its key(s),
 * its model catalog (server-capped at 50; the page filter narrows), and a
 * connectivity test. Models are pushed INTO task slots from here via the
 * per-row Assign menu (primary / one of the 9 auxiliary slots / fallback
 * chain) instead of each slot pulling from a picker.
 */
export default function ProviderCard({
  provider, currentModel, keys, filter, forceOpen,
}: {
  provider: ProviderInfo;
  currentModel: string | null;
  keys: KeyEntry[];
  filter: string;
  forceOpen: boolean;
}) {
  const { t } = useI18n();
  const m = t.modelsPanel;

  const assign = useAssignModel();
  const test = useTestProvider();
  const { data: fb } = useFallback();
  const setFallback = useSetFallback();

  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const isOpen = forceOpen || open;
  const hasKey = keys.some((k) => k.set);
  const models = filter
    ? provider.models.filter((name) => name.toLowerCase().includes(filter))
    : provider.models;

  const slotLabel = (slot: string): string =>
    (m?.[`aux_${slot}` as keyof ML] as string | undefined) ?? prettySlot(slot);

  const keyLabels = buildKeyRowLabels(m);

  const assignOptions: PopupSelectOption<string | null>[] = [
    { value: "primary", label: m?.assignPrimary ?? "Set as primary" },
    ...AUX_SLOTS.map((slot) => ({
      value: `aux:${slot}`,
      label: `${m?.assignAuxPrefix ?? "Aux"} · ${slotLabel(slot)}`,
    })),
    { value: "fallback", label: m?.assignFallback ?? "Add to fallback" },
  ];

  const runTest = async () => {
    setMsg(null);
    try {
      const r = await test.mutateAsync(provider.slug);
      setMsg(
        r.ok
          ? { ok: true, text: `✓ ${r.models_count ?? "?"} ${m?.testOkModels ?? "models reachable"}` }
          : { ok: false, text: r.reason ?? "failed" },
      );
    } catch (e: unknown) {
      setMsg({ ok: false, text: errorMessage(e) });
    }
  };

  const handleAssign = async (model: string, action: string | null) => {
    if (!action) return;
    setMsg(null);
    try {
      if (action === "primary") {
        await assign.mutateAsync({ scope: "main", provider: provider.slug, model });
      } else if (action === "fallback") {
        const chain = fb?.chain ?? [];
        if (chain.some((e) => e.provider === provider.slug && e.model === model)) {
          setMsg({ ok: false, text: m?.alreadyInFallback ?? "Already in the fallback chain." });
          return;
        }
        await setFallback.mutateAsync(
          chain.map((e) => ({ provider: e.provider, model: e.model }))
            .concat({ provider: provider.slug, model }),
        );
      } else if (action.startsWith("aux:")) {
        await assign.mutateAsync({
          scope: "auxiliary", provider: provider.slug, model, task: action.slice(4),
        });
      }
      setMsg({ ok: true, text: m?.savedRestart ?? "Saved. Restart the gateway for changes to take effect." });
    } catch (e: unknown) {
      setMsg({ ok: false, text: errorMessage(e) });
    }
  };

  return (
    <div
      className="hms-provider-card"
      data-current={provider.is_current || undefined}
      data-open={isOpen || undefined}
    >
      <div
        className="hms-provider-card-head"
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
      >
        <ChevronRight size={13} className="hms-provider-card-chevron" />
        <span className="hms-provider-card-name">{provider.name || provider.slug}</span>
        {provider.is_current && (
          <StatusBadge tone="success" uppercase={false}>{m?.current ?? "current"}</StatusBadge>
        )}
        {provider.source && provider.source !== "built-in" && (
          <StatusBadge tone="muted" uppercase={false}>{provider.source}</StatusBadge>
        )}
        {keys.length > 0 && (
          <span
            className="hms-provider-card-dot"
            data-set={hasKey || undefined}
            title={hasKey ? (m?.keySet ?? "key set") : (m?.keyMissing ?? "key not set")}
          />
        )}
        <span className="hms-provider-card-count">
          {provider.total_models ?? provider.models.length} {m?.modelsCount ?? "models"}
        </span>
        <span onClick={(e) => e.stopPropagation()}>
          <Button size="sm" disabled={test.isPending} onClick={() => void runTest()}>
            <Zap size={11} />
            {test.isPending ? (m?.testing ?? "Testing...") : (m?.test ?? "Test")}
          </Button>
        </span>
      </div>

      {msg && (
        <div className="hms-provider-card-msg" data-ok={msg.ok ? "true" : "false"}>
          {msg.text}
        </div>
      )}

      {isOpen && (
        <div className="hms-provider-card-body">
          {keys.map((k) => (
            <KeyRow key={k.name} entry={k} labels={keyLabels} />
          ))}

          <div className="hms-provider-card-models">
            {models.map((model) => (
              <div key={model} className="hms-provider-card-model">
                <span className="hms-provider-card-model-name">{model}</span>
                {provider.is_current && model === currentModel && (
                  <StatusBadge tone="success" uppercase={false}>{m?.current ?? "current"}</StatusBadge>
                )}
                <PopupSelect<string | null>
                  value={null}
                  label={m?.assign ?? "Assign"}
                  options={assignOptions}
                  onChange={(v) => void handleAssign(model, v)}
                  popupWidth={210}
                />
              </div>
            ))}
            {models.length === 0 && (
              <div className="hms-models-empty">{m?.noMatches ?? "Nothing matches the filter."}</div>
            )}
          </div>

          {(provider.total_models ?? 0) > provider.models.length && (
            <div className="hms-provider-card-caphint">
              {m?.modelsCapHint ?? "Showing the first 50 — use the filter above to narrow."}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
