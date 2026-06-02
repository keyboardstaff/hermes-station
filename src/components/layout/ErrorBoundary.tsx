import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";
import { RotateCw } from "lucide-react";

interface Props {
  children: ReactNode;
  /** Friendly label shown in the fallback card (e.g. the panel name). */
  label?: string;
}

interface State {
  error: Error | null;
  /** Bumped on Retry so children remount under a fresh key — discards any stale
   *  subtree state instead of re-rendering straight back into the same error. */
  resetKey: number;
}

/**
 * Per-panel error boundary — prevents a single panel's render error from
 * crashing the entire SPA.
 *
 * Desktop / MobileShell wrap every lazy-loaded Panel with this; the
 * Suspense fallback above it handles the loading state. On error the
 * panel area shows a small card with the message (DEV) or a generic hint
 * (prod) plus a Retry button that resets state and re-mounts children.
 *
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[hms] Panel render error:", error, info.componentStack);
  }

  reset = () => this.setState((s) => ({ error: null, resetKey: s.resetKey + 1 }));

  render() {
    const { error, resetKey } = this.state;
    if (!error) return <Fragment key={resetKey}>{this.props.children}</Fragment>;

    const isDev = import.meta.env.DEV;
    const label = this.props.label ?? "Panel";

    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "var(--hms-space-4)",
          padding: "var(--hms-space-8)",
          color: "var(--hms-text-muted)",
          height: "100%",
          textAlign: "center",
        }}
      >
        <p style={{ margin: 0, fontSize: "var(--hms-text-sm)", fontWeight: "var(--hms-fw-medium)" }}>
          {label} encountered an error.
        </p>
        {isDev && (
          <pre
            style={{
              margin: 0,
              fontSize: "var(--hms-text-xs)",
              color: "var(--hms-error-text)",
              background: "var(--hms-error-bg)",
              padding: "var(--hms-space-3)",
              borderRadius: "var(--hms-radius-md)",
              maxWidth: 480,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              textAlign: "left",
            }}
          >
            {error.message}
          </pre>
        )}
        <button
          type="button"
          onClick={this.reset}
          className="hms-btn hms-btn-sm"
          style={{ display: "inline-flex", alignItems: "center", gap: "var(--hms-btn-gap)" }}
        >
          <RotateCw size={12} />
          Retry
        </button>
      </div>
    );
  }
}
