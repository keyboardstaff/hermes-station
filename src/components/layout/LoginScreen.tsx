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
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError("");
    try {
      await api.json("/api/login", "POST", { username: username.trim(), password });
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
    <div className="hms-auth-root">
      <form onSubmit={submit} className="hms-auth-card">
        <header className="hms-auth-brand">
          <HermesMark size={44} />
          <div className="hms-auth-wordmark">Hermes Station</div>
          <p className="hms-auth-subtitle">{t.login.subtitle}</p>
        </header>

        <div className="hms-auth-fields">
          <label className="hms-auth-label">{t.login.username}</label>
          <input
            type="text"
            autoFocus
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="hms-input"
          />
          <label className="hms-auth-label">{t.login.password}</label>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="hms-input"
          />
        </div>

        {error && <div className="hms-auth-error">{error}</div>}

        <Button type="submit" size="lg" variant="primary" disabled={busy || !password} style={{ width: "100%" }}>
          <Lock size={13} />
          {busy ? t.login.signingIn : t.login.signIn}
          {!busy && <ArrowRight size={13} />}
        </Button>
      </form>
    </div>
  );
}
