/**
 * Provider card with health badge + Test button.
 *
 * Renders a single provider's slug, model count, source badge,
 * and a one-click connectivity test.
 */

import { useState } from "react";
import { CheckCircle, XCircle, Loader, Zap } from "lucide-react";
import type { ProviderInfo } from "@/hooks/useProviders";
import { useTestProvider } from "@/hooks/useProviders";

interface Props {
  provider: ProviderInfo;
  isCurrent: boolean;
  labels: {
    test: string;
    testing: string;
    models: string;
    current: string;
  };
}

export default function ProviderCard({ provider, isCurrent, labels }: Props) {
  const test = useTestProvider();
  const [result, setResult] = useState<{ ok: boolean; reason?: string } | null>(null);

  const handleTest = async () => {
    setResult(null);
    try {
      const r = await test.mutateAsync(provider.slug);
      setResult(r);
    } catch {
      setResult({ ok: false, reason: "request_failed" });
    }
  };

  const modelCount = provider.models?.length ?? provider.total_models ?? 0;

  return (
    <div
      style={{
        padding: "12px 14px",
        background: "var(--hms-surface)",
        border: `1px solid ${isCurrent ? "var(--hms-text)" : "var(--hms-border)"}`,
        borderRadius: 10,
        display: "flex",
        alignItems: "center",
        gap: 'var(--hms-space-3)',
      }}
    >
      {/* Provider info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-2)' }}>
          <span style={{ fontSize: 'var(--hms-text-sm)', fontWeight: 600 }}>{provider.name || provider.slug}</span>
          {isCurrent && (
            <span
              style={{
                fontSize: '0.5625rem',
                padding: "1px 5px",
                borderRadius: 4,
                background: "rgba(34,197,94,0.12)",
                color: "var(--hms-success-text)",
                fontWeight: 600,
              }}
            >
              {labels.current}
            </span>
          )}
          {provider.source && provider.source !== "built-in" && (
            <span
              style={{
                fontSize: '0.5625rem',
                padding: "1px 5px",
                borderRadius: 4,
                background: "var(--hms-border)",
                color: "var(--hms-text-muted)",
              }}
            >
              {provider.source}
            </span>
          )}
        </div>
        <div style={{ fontSize: 'var(--hms-text-xs)', color: "var(--hms-text-muted)", marginTop: 2 }}>
          {modelCount} {labels.models}
        </div>
      </div>

      {/* Test result indicator */}
      {result && (
        <div style={{ flexShrink: 0 }}>
          {result.ok ? (
            <CheckCircle size={16} style={{ color: "var(--hms-success)" }} />
          ) : (
            <XCircle size={16} style={{ color: "var(--hms-error)" }} />
          )}
        </div>
      )}

      {/* Test button */}
      <button
        onClick={handleTest}
        disabled={test.isPending}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 'var(--hms-space-1)',
          padding: "4px 10px",
          borderRadius: 6,
          border: "1px solid var(--hms-border)",
          background: "transparent",
          color: "var(--hms-text-muted)",
          fontSize: 'var(--hms-text-xs)',
          cursor: test.isPending ? "not-allowed" : "pointer",
          flexShrink: 0,
        }}
      >
        {test.isPending ? (
          <Loader size={12} className="hms-spin" />
        ) : (
          <Zap size={12} />
        )}
        {test.isPending ? labels.testing : labels.test}
      </button>
    </div>
  );
}
