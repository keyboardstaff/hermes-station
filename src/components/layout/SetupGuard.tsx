import { useEffect, useState } from "react";
import { AlertTriangle, PackageX, ExternalLink } from "lucide-react";
import { useCapabilityStore, useCapabilitiesPolling } from "@/store/capabilities";
import { useI18n } from "@/i18n";
import LoginScreen from "./LoginScreen";
import type { ReactNode } from "react";

const DISMISSED_KEY = "hms_degraded_dismissed";

interface AuthStatus {
  requiresLogin: boolean;
  loggedIn: boolean;
  localhost: boolean;
}

export default function SetupGuard({ children }: { children: ReactNode }) {
  const { caps, fetch: fetchCaps } = useCapabilityStore();
  useCapabilitiesPolling();
  const { t } = useI18n();
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(DISMISSED_KEY) === "1"; } catch { return false; }
  });
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  // Re-arm the degraded-mode warning when caps recover.  Without this, a
  // user who clicked "Continue anyway" once is locked into the dismissed
  // state forever — even after Dashboard/Gateway come back online and a
  // subsequent outage happens.
  useEffect(() => {
    if (!caps || caps.mode === "degraded") return;
    if (!dismissed) return;
    try { localStorage.removeItem(DISMISSED_KEY); } catch { /* ignore */ }
    setDismissed(false);
  }, [caps, dismissed]);

  const refreshAuth = () => {
    setAuthError(null);
    fetch("/api/auth-status")
      .then(async (r) => {
        if (r.ok) return r.json();
        // Surface backend errors rather than spinning on "Initializing..."
        // Most common: 403 from host_guard when reaching station via
        // an unexpected Host header.
        const body = await r.text().catch(() => "");
        throw new Error(`HTTP ${r.status}${body ? `: ${body.slice(0, 160)}` : ""}`);
      })
      .then((s) => setAuth(s as AuthStatus))
      .catch((err) => setAuthError((err as Error).message || "fetch failed"));
  };

  useEffect(() => { refreshAuth(); }, []);
  useEffect(() => {
    // Only probe capabilities once we know we're authorized.
    if (auth && (!auth.requiresLogin || auth.loggedIn)) fetchCaps();
  }, [auth, fetchCaps]);

  // Earlier we mirrored ``command_allowlist`` here so the legacy
  // NLP auto-approve shim could match patterns client-side. After the
  // bridge cutover the upstream gateway is the only authority — it
  // skips the notify_cb on already-allowed patterns natively, so no
  // mirror is needed.

  if (!auth) {
    if (authError) {
      return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", gap: 'var(--hms-space-3)', padding: 'var(--hms-space-6)', textAlign: "center" }}>
          <AlertTriangle size={36} strokeWidth={1.5} style={{ color: "var(--hms-warning)" }} />
          <h2 style={{ fontSize: 'var(--hms-text-lg)', fontWeight: 600, margin: 0 }}>Cannot reach station backend</h2>
          <p style={{ color: "var(--hms-text-muted)", fontSize: 'var(--hms-text-sm)', maxWidth: 480, margin: 0 }}>
            <code>GET /api/auth-status</code> failed: {authError}
          </p>
          <p style={{ color: "var(--hms-text-muted)", fontSize: 'var(--hms-text-caption)', maxWidth: 520, margin: 0 }}>
            If you're connecting remotely, make sure the station bind is
            set to <code>0.0.0.0</code> (Settings → Security) and that no
            firewall blocks the port. If you just changed the bind, restart
            the station process.
          </p>
          <button
            onClick={refreshAuth}
            style={{
              padding: "6px 18px", borderRadius: 6,
              border: "1px solid var(--hms-border)",
              background: "var(--hms-surface)", color: "var(--hms-text)",
              cursor: "pointer", fontSize: 'var(--hms-text-sm)',
            }}
          >
            {t.common.retry}
          </button>
        </div>
      );
    }
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "var(--hms-text-muted)", fontSize: 'var(--hms-text-body)'}}>
        Initializing...
      </div>
    );
  }

  if (auth.requiresLogin && !auth.loggedIn) {
    return <LoginScreen onSuccess={() => { refreshAuth(); fetchCaps(); }} />;
  }

  if (!caps) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "var(--hms-text-muted)", fontSize: 'var(--hms-text-body)'}}>
        Initializing...
      </div>
    );
  }

  // hermes-agent not installed
  if (!caps.fsReadable) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", gap: 'var(--hms-space-4)' }}>
        <PackageX size={40} strokeWidth={1.5} style={{ color: "var(--hms-text-muted)" }} />
        <h2 style={{ fontSize: 'var(--hms-text-xl)', fontWeight: 600 }}>{t.setup.hermesNotFound}</h2>
        <p style={{ color: "var(--hms-text-muted)", textAlign: "center", maxWidth: 400 }}>
          {t.setup.hermesNotFoundDesc}
        </p>
        <a
          href="https://hermes-agent.nousresearch.com/docs"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--hms-success)", display: "flex", alignItems: "center", gap: 'var(--hms-space-1)' }}
        >
          {t.setup.installLink} <ExternalLink size={12} />
        </a>
      </div>
    );
  }

  // Degraded mode — show confirmation if not already dismissed
  if (caps.mode === "degraded" && !dismissed) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", gap: 'var(--hms-space-4)' }}>
        <AlertTriangle size={40} strokeWidth={1.5} style={{ color: "var(--hms-warning)" }} />
        <h2 style={{ fontSize: 'var(--hms-text-xl)', fontWeight: 600 }}>{t.setup.degradedMode}</h2>
        <p style={{ color: "var(--hms-text-muted)", textAlign: "center", maxWidth: 400 }}>
          {t.setup.degradedDesc}
        </p>
        <ul style={{ color: "var(--hms-text-muted)", fontSize: 'var(--hms-text-sm)', textAlign: "left" }}>
          {caps.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
        <button
          onClick={() => {
            try { localStorage.setItem(DISMISSED_KEY, "1"); } catch { /* ignore */ }
            setDismissed(true);
          }}
          style={{
            padding: "8px 20px",
            borderRadius: 8,
            border: "1px solid var(--hms-border)",
            background: "var(--hms-surface)",
            color: "var(--hms-text)",
            cursor: "pointer",
            fontSize: 'var(--hms-text-body)',
          }}
        >
          {t.setup.continueAnyway}
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
