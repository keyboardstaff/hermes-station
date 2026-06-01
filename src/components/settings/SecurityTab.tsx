import { useCallback, useEffect, useRef, useState } from "react";
import { Network, Key, Shield } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/i18n";
import { useDebouncedEffect } from "@/hooks/useDebouncedValue";
import { api, ApiError } from "@/lib/api";
import { Section } from "@/components/settings/shared";

interface SecuritySettings {
  host?: string;
  /** Server-side hash is never returned; this boolean is the only signal. */
  password_set?: boolean;
  session_ttl_seconds?: number;
}

export function SecurityTab() {
  const { t } = useI18n();
  const qc = useQueryClient();

  const { data: settings } = useQuery<SecuritySettings>({
    queryKey: ["internal-settings"],
    queryFn: () => api.get<SecuritySettings>("/api/settings"),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  const [bindHost, setBindHost] = useState("127.0.0.1");
  const [sessionTtl, setSessionTtl] = useState(86400);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "ok" | "err">("idle");
  const [saveError, setSaveError] = useState<string>("");
  const [pwStatus, setPwStatus] = useState<"idle" | "ok" | "err">("idle");
  const [pwError, setPwError] = useState<string>("");
  // Guards debounced auto-save from PATCHing back the just-loaded value.
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (!settings) return;
    setBindHost(settings.host ?? "127.0.0.1");
    setSessionTtl(settings.session_ttl_seconds ?? 86400);
    hydratedRef.current = true;
  }, [settings]);

  const hasStoredPassword = !!settings?.password_set;
  const dangerHost = bindHost === "0.0.0.0" && !hasStoredPassword;
  const bindChanged = !!settings && (settings.host ?? "127.0.0.1") !== bindHost;

  const saveSecurity = useCallback(async (
    payload: { host?: string; session_ttl_seconds?: number },
  ) => {
    setSaveStatus("saving");
    setSaveError("");
    try {
      // PUT mirrors PATCH (see server/routes/settings.py).
      await api.json<unknown>("/api/settings", "PUT", payload);
      qc.invalidateQueries({ queryKey: ["internal-settings"] });
      setSaveStatus("ok");
      setTimeout(() => setSaveStatus("idle"), 1500);
    } catch (err) {
      setSaveStatus("err");
      if (err instanceof ApiError) {
        const detail =
          (err.detail && typeof err.detail === "object" && "error" in err.detail)
            ? String((err.detail as { error: unknown }).error)
            : err.message;
        setSaveError(detail);
      } else {
        setSaveError(err instanceof Error ? err.message : "save failed");
      }
    }
  }, [qc]);

  // Auto-save 600ms after the last edit; refuses 0.0.0.0 without password (backend re-checks).
  useDebouncedEffect(() => {
    if (!hydratedRef.current) return;
    if (dangerHost) return;
    // PATCH only diverging fields to avoid clobbering concurrent edits.
    const payload: { host?: string; session_ttl_seconds?: number } = {};
    if (settings && bindHost !== (settings.host ?? "127.0.0.1")) {
      payload.host = bindHost;
    }
    if (settings && sessionTtl !== (settings.session_ttl_seconds ?? 86400)) {
      payload.session_ttl_seconds = sessionTtl;
    }
    if (Object.keys(payload).length === 0) return;
    void saveSecurity(payload);
  }, [bindHost, sessionTtl, dangerHost, saveSecurity], 600);

  const submitPassword = async () => {
    setPwStatus("idle");
    setPwError("");
    if (newPassword.length < 8) {
      setPwStatus("err");
      setPwError(t.settings.security.passwordTooShort);
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwStatus("err");
      setPwError(t.settings.security.passwordMismatch);
      return;
    }
    try {
      const body: Record<string, string> = { new: newPassword };
      if (hasStoredPassword) body.current = currentPassword;
      await api.json<unknown>("/api/password", "POST", body);
      qc.invalidateQueries({ queryKey: ["internal-settings"] });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPwStatus("ok");
      setTimeout(() => setPwStatus("idle"), 2500);
    } catch (err) {
      setPwStatus("err");
      if (err instanceof ApiError) {
        const detail =
          (err.detail && typeof err.detail === "object" && "error" in err.detail)
            ? String((err.detail as { error: unknown }).error)
            : err.message;
        setPwError(detail);
        return;
      }
      setPwError((err as Error).message);
    }
  };

  // Form renders with defaults while /api/settings loads; hydratedRef guards auto-save.
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 'var(--hms-space-4)' }}>
      <Section icon={<Network size={14} />} title={t.settings.security.networkSection}>
        <div style={{ display: "flex", flexDirection: "column", gap: 'var(--hms-space-2)' }}>
          {[
            { value: "127.0.0.1", label: t.settings.security.bindLocalhost },
            { value: "0.0.0.0", label: t.settings.security.bindAllInterfaces },
          ].map((opt) => (
            <label key={opt.value} style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-2)', fontSize: 'var(--hms-text-sm)', cursor: "pointer" }}>
              <input
                type="radio"
                name="bind-host"
                value={opt.value}
                checked={bindHost === opt.value}
                onChange={() => setBindHost(opt.value)}
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
        {bindChanged ? (
          <div style={{ padding: "8px 12px", borderRadius: 6, background: "var(--hms-warning-bg)", border: "1px solid #f59e0b", fontSize: 'var(--hms-text-caption)', color: "var(--hms-warning-text)" }}>
            ⚠ {t.settings.security.restartHint} — run <code>pnpm dev</code> again (or restart the production server) after saving.
          </div>
        ) : (
          <div style={{ fontSize: 'var(--hms-text-xs)', color: "var(--hms-text-muted)" }}>
            {t.settings.security.restartHint}
          </div>
        )}
      </Section>

      <Section icon={<Key size={14} />} title={t.settings.security.authSection}>
        <div style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-2)', fontSize: 'var(--hms-text-sm)'}}>
          <span style={{ color: hasStoredPassword ? "var(--hms-success)" : "var(--hms-error)" }}>
            {hasStoredPassword ? "✓" : "✗"}
          </span>
          <span>{hasStoredPassword ? t.settings.security.passwordConfigured : t.settings.security.passwordNotSet}</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 'var(--hms-space-2)' }}>
          {hasStoredPassword && (
            <Field
              // English label acceptable: only renders for the operator path (post-install).
              label="Current password"
              value={currentPassword}
              onChange={setCurrentPassword}
              type="password"
              autoComplete="current-password"
            />
          )}
          <Field
            label={`${t.settings.security.newPassword} (${t.settings.security.newPasswordHint})`}
            value={newPassword}
            onChange={setNewPassword}
            type="password"
            autoComplete="new-password"
          />
          <Field
            label={t.settings.security.confirmPassword}
            value={confirmPassword}
            onChange={setConfirmPassword}
            type="password"
            autoComplete="new-password"
          />
        </div>

        {pwStatus === "err" && pwError && (
          <div style={{ padding: "6px 10px", borderRadius: 6, background: "var(--hms-error-bg)", border: "1px solid #ef4444", fontSize: 'var(--hms-text-caption)', color: "var(--hms-error-dark)" }}>
            {pwError}
          </div>
        )}

        <div style={{ display: "flex", gap: 'var(--hms-space-2)' }}>
          <button
            onClick={submitPassword}
            disabled={!newPassword || !confirmPassword || (hasStoredPassword && !currentPassword)}
            style={{
              padding: "6px 18px",
              borderRadius: 6,
              border: "none",
              background: !newPassword || !confirmPassword || (hasStoredPassword && !currentPassword)
                ? "var(--hms-border)"
                : "var(--hms-text)",
              color: !newPassword || !confirmPassword || (hasStoredPassword && !currentPassword)
                ? "var(--hms-text-muted)"
                : "var(--hms-bg)",
              fontSize: 'var(--hms-text-sm)',
              cursor: !newPassword || !confirmPassword || (hasStoredPassword && !currentPassword)
                ? "not-allowed"
                : "pointer",
            }}
          >
            {pwStatus === "ok" ? "Saved ✓" : hasStoredPassword ? t.settings.security.updatePassword : t.settings.security.setPassword}
          </button>
          {/* No "clear password" — backend has no unset semantic; edit config.yaml directly. */}
        </div>

        <div style={{ marginTop: 4, paddingTop: 12, borderTop: "1px solid var(--hms-border)", display: "flex", flexDirection: "column", gap: 'var(--hms-space-3)' }}>
          {/* Existence of password_hash IS the enable signal; localhost still bypasses. */}
          <div>
            <div style={{ fontSize: 'var(--hms-text-caption)', color: "var(--hms-text-muted)", marginBottom: 4 }}>
              {t.settings.security.sessionTtl}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-3)' }}>
              <input
                type="number"
                value={sessionTtl}
                min={300}
                max={604800}
                onChange={(e) => setSessionTtl(Number(e.target.value))}
                style={{
                  padding: "6px 10px",
                  borderRadius: 6,
                  border: "1px solid var(--hms-border)",
                  background: "var(--hms-bg)",
                  color: "var(--hms-text)",
                  fontSize: 'var(--hms-text-sm)',
                  width: 120,
                }}
              />
              <span style={{ fontSize: 'var(--hms-text-caption)', color: "var(--hms-text-muted)" }}>
                {Math.round(sessionTtl / 3600)}h
              </span>
            </div>
          </div>
        </div>
      </Section>

      {/* Only error / dangerous-bind warnings get a banner — success and
          in-flight states stay silent per UX request (auto-save is the
          contract, no chrome needed). */}
      {dangerHost && (
        <div style={{ padding: "8px 12px", borderRadius: 6, background: "var(--hms-warning-bg)", border: "1px solid #f59e0b", fontSize: 'var(--hms-text-caption)', color: "var(--hms-warning-text)" }}>
          {t.settings.security.networkWarning}
        </div>
      )}
      {saveStatus === "err" && saveError && (
        <div style={{ padding: "8px 12px", borderRadius: 6, background: "var(--hms-error-bg)", border: "1px solid #ef4444", fontSize: 'var(--hms-text-caption)', color: "var(--hms-error-dark)" }}>
          {saveError}
        </div>
      )}

      {/* Hardening info */}
      <Section icon={<Shield size={14} />} title={t.settings.security.hardeningSection}>
        <ul style={{ paddingLeft: 16, margin: 0, fontSize: 'var(--hms-text-caption)', color: "var(--hms-text-muted)", lineHeight: 1.8 }}>
          <li>{t.settings.security.csrfNote}</li>
          <li>{t.settings.security.rateLimitNote}</li>
          <li>{t.settings.security.argon2Note}</li>
        </ul>
      </Section>
    </div>
  );
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  autoComplete?: string;
}

function Field({ label, value, onChange, placeholder, type, autoComplete }: FieldProps) {
  return (
    <div>
      <div style={{ fontSize: 'var(--hms-text-caption)', color: "var(--hms-text-muted)", marginBottom: 4 }}>{label}</div>
      <input
        type={type ?? "text"}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: "100%",
          padding: "6px 10px",
          borderRadius: 6,
          border: "1px solid var(--hms-border)",
          background: "var(--hms-bg)",
          color: "var(--hms-text)",
          fontSize: 'var(--hms-text-sm)',
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}
