import { useEffect, useState } from "react";
import { useI18n } from "@/i18n";
import { usePlugins, useSaveRuntimeProviders } from "@/hooks/usePlugins";
import { PopupSelect } from "@/components/ui/PopupSelect";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";

/**
 * Runtime provider plugins — pick the memory provider (empty = built-in) and
 * context engine, persisted to config.yaml. Options come from the plugin hub
 * payload; takes effect next session.
 */
export default function RuntimeProvidersCard() {
  const { t } = useI18n();
  const p = t.plugins;
  const { data } = usePlugins();
  const save = useSaveRuntimeProviders();

  const providers = data?.providers;
  const memoryOptions = providers?.memory_options ?? [];
  const contextOptions = providers?.context_options ?? [];

  const [memory, setMemory] = useState("");
  const [context, setContext] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!providers) return;
    setMemory(providers.memory_provider ?? "");
    setContext(providers.context_engine ?? "");
  }, [providers]);

  const onSave = async () => {
    await save.mutateAsync({ memory_provider: memory, context_engine: context });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <Card>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--hms-space-4)" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "var(--hms-text-body)", fontWeight: 700 }}>
            {p?.runtimeTitle ?? "Runtime provider plugins"}
          </h3>
          <p style={{ margin: "4px 0 0", fontSize: "var(--hms-text-xs)", color: "var(--hms-text-muted)" }}>
            {p?.runtimeHint ?? "Writes memory.provider (empty = built-in) and context.engine to config.yaml. Takes effect next session."}
          </p>
        </div>
        <div style={{ display: "flex", gap: "var(--hms-space-4)", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 240px" }}>
            <Field label={p?.memoryProvider ?? "Memory provider"}>
              <PopupSelect
                value={memory}
                label={memory || (p?.builtIn ?? "built-in")}
                options={[{ value: "", label: p?.builtIn ?? "built-in" }, ...memoryOptions.map((o) => ({ value: o.name, label: o.name }))]}
                onChange={setMemory}
              />
            </Field>
          </div>
          <div style={{ flex: "1 1 240px" }}>
            <Field label={p?.contextEngine ?? "Context engine"}>
              <PopupSelect
                value={context}
                label={context || (contextOptions[0]?.name ?? "default")}
                options={contextOptions.map((o) => ({ value: o.name, label: o.name }))}
                onChange={setContext}
              />
            </Field>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--hms-space-3)" }}>
          <Button variant="primary" size="sm" onClick={onSave} disabled={save.isPending}>
            {save.isPending ? (p?.saving ?? "Saving…") : (p?.save ?? "Save")}
          </Button>
          {saved && <span style={{ fontSize: "var(--hms-text-caption)", color: "var(--hms-success-text)" }}>✓ {p?.saved ?? "Saved"}</span>}
        </div>
      </div>
    </Card>
  );
}
