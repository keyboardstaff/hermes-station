import { useState } from "react";
import { Send, Settings2, ExternalLink } from "lucide-react";
import Switch from "@/components/ui/Switch";
import { api } from "@/lib/api";

// 1:1 client of the upstream dashboard's messaging-platform management API
// (GET/PUT /api/messaging/platforms + POST …/{id}/test), reached through the
// Station dashboard proxy. The payload shape mirrors web_server.py's
// _messaging_platform_payload.

export interface PlatformEnvField {
  key: string;
  required: boolean;
  is_set: boolean;
  redacted_value: string | null;
  description: string;
  prompt: string;
  url: string | null;
  is_password: boolean;
  advanced: boolean;
}

export interface MessagingPlatform {
  id: string;
  name: string;
  enabled: boolean;
  configured: boolean;
  gateway_running: boolean;
  state: string;
  error_message?: string | null;
  env_vars: PlatformEnvField[];
}

export interface ChannelLabels {
  configure: string;
  test: string;
  testing: string;
  save: string;
  cancel: string;
  clear: string;
  restartHint: string;
}

const STATE_TONE: Record<string, string> = {
  connected: "ok",
  running: "ok",
  disabled: "muted",
  not_configured: "warn",
  pending_restart: "warn",
  stopped: "muted",
  error: "err",
  broken: "err",
  circuit_open: "err",
};

function stateLabel(state: string): string {
  return state.replace(/_/g, " ");
}

export default function ChannelCard({
  platform, labels, onChanged,
}: {
  platform: MessagingPlatform;
  labels: ChannelLabels;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [clearKeys, setClearKeys] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const put = async (body: { enabled?: boolean; env?: Record<string, string>; clear_env?: string[] }) => {
    setBusy(true);
    try {
      await api.json(`/api/dashboard/messaging/platforms/${encodeURIComponent(platform.id)}`, "PUT", {
        env: {}, clear_env: [], ...body,
      });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const saveConfig = async () => {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(draft)) {
      if (v.trim()) env[k] = v.trim();
    }
    await put({ env, clear_env: [...clearKeys] });
    setDraft({});
    setClearKeys(new Set());
    setEditing(false);
  };

  const runTest = async () => {
    setBusy(true);
    setTestMsg(null);
    try {
      const res = await api.json<{ ok: boolean; message: string }>(
        `/api/dashboard/messaging/platforms/${encodeURIComponent(platform.id)}/test`, "POST", {},
      );
      setTestMsg({ ok: !!res?.ok, text: res?.message ?? "" });
    } catch (err) {
      setTestMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const tone = STATE_TONE[platform.state] ?? "muted";

  return (
    <div className="hms-channel-card" data-state={tone}>
      <div className="hms-channel-card-head">
        <span className="hms-channel-card-name">{platform.name}</span>
        <span className="hms-channel-card-state" data-tone={tone}>{stateLabel(platform.state)}</span>
        {/* Enable/disable — config-level; takes effect on gateway restart. */}
        <Switch
          checked={platform.enabled}
          disabled={busy}
          title={labels.restartHint}
          onChange={(next) => void put({ enabled: next })}
        />
      </div>

      {platform.error_message && (
        <div className="hms-channel-card-error">{platform.error_message}</div>
      )}

      <div className="hms-channel-card-actions">
        <button
          type="button"
          className="hms-channel-card-btn"
          onClick={() => setEditing((v) => !v)}
        >
          <Settings2 size={12} /> {labels.configure}
        </button>
        <button
          type="button"
          className="hms-channel-card-btn"
          disabled={busy}
          onClick={() => void runTest()}
        >
          <Send size={12} /> {busy ? labels.testing : labels.test}
        </button>
      </div>

      {testMsg && (
        <div className="hms-channel-card-test" data-ok={testMsg.ok ? "true" : "false"}>
          {testMsg.text}
        </div>
      )}

      {editing && (
        <div className="hms-channel-card-form">
          {platform.env_vars.map((f) => {
            const queuedClear = clearKeys.has(f.key);
            return (
              <div key={f.key} className="hms-channel-card-field">
                <label className="hms-channel-card-label" title={f.description}>
                  {f.prompt}
                  {f.required && <span className="hms-channel-card-req"> *</span>}
                  {f.url && (
                    <a href={f.url} target="_blank" rel="noreferrer noopener" className="hms-channel-card-doc">
                      <ExternalLink size={10} />
                    </a>
                  )}
                </label>
                <div className="hms-channel-card-input-row">
                  <input
                    type={f.is_password ? "password" : "text"}
                    value={draft[f.key] ?? ""}
                    placeholder={queuedClear ? "" : f.is_set ? f.redacted_value ?? "••••" : ""}
                    onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                    className="hms-channel-card-input"
                  />
                  {f.is_set && (
                    <button
                      type="button"
                      className="hms-channel-card-btn"
                      data-active={queuedClear ? "true" : undefined}
                      onClick={() =>
                        setClearKeys((prev) => {
                          const next = new Set(prev);
                          if (next.has(f.key)) next.delete(f.key);
                          else next.add(f.key);
                          return next;
                        })
                      }
                    >
                      {labels.clear}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          <div className="hms-channel-card-form-actions">
            <button type="button" className="hms-channel-card-btn" onClick={() => { setEditing(false); setDraft({}); setClearKeys(new Set()); }}>
              {labels.cancel}
            </button>
            <button type="button" className="hms-channel-card-btn" data-variant="primary" disabled={busy} onClick={() => void saveConfig()}>
              {labels.save}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
