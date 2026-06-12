import { useState } from "react";
import { useI18n } from "@/i18n";
import { useInstallPlugin } from "@/hooks/usePlugins";
import { errorMessage } from "@/lib/errors";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import Switch from "@/components/ui/Switch";

/**
 * Install a plugin from a GitHub owner/repo shorthand or a full git URL.
 * Routes through the shared agent-plugins install endpoint.
 */
export default function GitInstallCard() {
  const { t } = useI18n();
  const p = t.plugins;
  const install = useInstallPlugin();
  const [identifier, setIdentifier] = useState("");
  const [force, setForce] = useState(false);
  const [enable, setEnable] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const onInstall = async () => {
    const id = identifier.trim();
    if (!id) return;
    setMsg(null);
    try {
      const res = await install.mutateAsync({ identifier: id, force, enable });
      if (res.ok) {
        setMsg({ ok: true, text: `${p?.installSuccess ?? "Installed:"} ${res.name ?? id}` });
        setIdentifier("");
      } else {
        setMsg({ ok: false, text: res.error ?? "install failed" });
      }
    } catch (e: unknown) {
      setMsg({ ok: false, text: errorMessage(e) });
    }
  };

  return (
    <Card>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--hms-space-4)" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "var(--hms-text-body)", fontWeight: 700 }}>
            {p?.gitTitle ?? "Install from GitHub / Git URL"}
          </h3>
          <p style={{ margin: "4px 0 0", fontSize: "var(--hms-text-xs)", color: "var(--hms-text-muted)" }}>
            {p?.gitHint ?? "Use owner/repo shorthand or a full https:// or git@ clone URL."}
          </p>
        </div>
        <Field label={p?.gitUrlLabel ?? "Git URL or owner/repo"}>
          <input
            type="text"
            className="hms-input"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="owner/repo or https://…"
            onKeyDown={(e) => { if (e.key === "Enter") onInstall(); }}
          />
        </Field>
        <div style={{ display: "flex", gap: "var(--hms-space-4)", flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "var(--hms-space-2)", fontSize: "var(--hms-text-sm)", cursor: "pointer" }}>
            <Switch checked={force} onChange={setForce} />
            {p?.forceReinstall ?? "Force reinstall"}
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: "var(--hms-space-2)", fontSize: "var(--hms-text-sm)", cursor: "pointer" }}>
            <Switch checked={enable} onChange={setEnable} />
            {p?.enableAfterInstall ?? "Enable after install"}
          </label>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--hms-space-3)" }}>
          <Button variant="primary" size="sm" onClick={onInstall} disabled={install.isPending || !identifier.trim()}>
            {install.isPending ? (p?.installing ?? "Installing…") : (p?.installBtn ?? "Install")}
          </Button>
          {msg && (
            <span style={{ fontSize: "var(--hms-text-caption)", color: msg.ok ? "var(--hms-success-text)" : "var(--hms-error-text)" }}>
              {msg.text}
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}
