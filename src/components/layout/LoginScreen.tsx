import { useState } from "react";
import { Lock, ArrowRight } from "lucide-react";
import { useI18n } from "@/i18n";
import { api, ApiError } from "@/lib/api";
import Button from "@/components/ui/Button";
import HermesMark from "@/components/ui/HermesMark";

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
        minHeight: "100vh",
        padding: 'var(--hms-space-6)',
        background: [
          "radial-gradient(circle at top left, color-mix(in srgb, var(--hms-accent) 10%, transparent), transparent 34%)",
          "radial-gradient(circle at bottom right, color-mix(in srgb, var(--hms-info) 10%, transparent), transparent 30%)",
          "var(--hms-bg)",
        ].join(", "),
      }}
    >
      <form
        onSubmit={submit}
        style={{
          width: "min(100%, 380px)",
          padding: 28,
          borderRadius: 12,
          border: "1px solid var(--hms-border)",
          background: "var(--hms-surface)",
          display: "flex",
          flexDirection: "column",
          gap: 'var(--hms-space-4)',
          boxShadow: "var(--hms-shadow-card)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 'var(--hms-space-2)' }}>
          <div style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-3)' }}>
            <HermesMark size={24} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 'var(--hms-text-xs)', color: "var(--hms-text-muted)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                Hermes Station
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-2)' }}>
                <Lock size={16} style={{ color: "var(--hms-accent)" }} />
                <span style={{ fontSize: 'var(--hms-text-md)', fontWeight: 600 }}>{t.login.title}</span>
              </div>
            </div>
          </div>
          <p style={{ margin: 0, fontSize: 'var(--hms-text-caption)', color: "var(--hms-text-muted)", lineHeight: 1.5 }}>
            {t.login.subtitle}
          </p>
        </div>

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
          <div style={{ padding: "6px 10px", borderRadius: 6, background: "var(--hms-error-weak)", border: "1px solid var(--hms-error-border)", fontSize: 'var(--hms-text-caption)', color: "var(--hms-error-dark)" }}>
            {error}
          </div>
        )}

        <Button
          type="submit"
          size="lg"
          variant="primary"
          disabled={busy || !password}
          style={{
            width: "100%",
          }}
        >
          {busy ? t.login.signingIn : t.login.signIn}
          {!busy && <ArrowRight size={13} />}
        </Button>
      </form>
    </div>
  );
}
