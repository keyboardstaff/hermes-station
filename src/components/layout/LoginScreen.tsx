import { useState } from "react";
import { Lock, ArrowRight } from "lucide-react";
import { useI18n } from "@/i18n";
import { api, ApiError } from "@/lib/api";

/**
 * Rendered by SetupGuard when the server reports {requiresLogin:true, loggedIn:false}.
 * Posts the password to /api/login which sets an HttpOnly cookie on success,
 * then reloads the SPA so every subsequent fetch carries the cookie automatically.
 */
export default function LoginScreen({ onSuccess }: { onSuccess: () => void }) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError("");
    try {
      await api.json("/api/login", "POST", { password });
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.status === 429 ? t.login.rateLimited : t.login.invalidPassword);
      } else {
        setError((err as Error).message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        background: "var(--hms-bg)",
      }}
    >
      <form
        onSubmit={submit}
        style={{
          width: 340,
          padding: 28,
          borderRadius: 12,
          border: "1px solid var(--hms-border)",
          background: "var(--hms-surface)",
          display: "flex",
          flexDirection: "column",
          gap: 'var(--hms-space-4)',
          boxShadow: "0 8px 24px rgba(0,0,0,0.06)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-3)' }}>
          <Lock size={18} />
          <span style={{ fontSize: 'var(--hms-text-md)', fontWeight: 600 }}>{t.login.title}</span>
        </div>
        <p style={{ margin: 0, fontSize: 'var(--hms-text-caption)', color: "var(--hms-text-muted)", lineHeight: 1.5 }}>
          {t.login.subtitle}
        </p>

        <div>
          <div style={{ fontSize: 'var(--hms-text-caption)', color: "var(--hms-text-muted)", marginBottom: 4 }}>
            {t.login.password}
          </div>
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: 6,
              border: "1px solid var(--hms-border)",
              background: "var(--hms-bg)",
              color: "var(--hms-text)",
              fontSize: 'var(--hms-text-body)',
              outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        {error && (
          <div style={{ padding: "6px 10px", borderRadius: 6, background: "var(--hms-error-bg)", border: "1px solid #ef4444", fontSize: 'var(--hms-text-caption)', color: "var(--hms-error-dark)" }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={busy || !password}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 'var(--hms-space-2)',
            padding: "8px 12px",
            borderRadius: 6,
            border: "none",
            background: busy || !password ? "var(--hms-border)" : "var(--hms-text)",
            color: busy || !password ? "var(--hms-text-muted)" : "var(--hms-bg)",
            fontSize: 'var(--hms-text-sm)',
            cursor: busy || !password ? "not-allowed" : "pointer",
          }}
        >
          {busy ? t.login.signingIn : t.login.signIn}
          {!busy && <ArrowRight size={13} />}
        </button>
      </form>
    </div>
  );
}
