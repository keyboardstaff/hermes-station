import { useEffect, useRef, useState } from "react";
import { useThemeStore } from "@/store/app";
import { naturalSizeSvg } from "@/lib/mermaid-util";
import CodeBlock from "./CodeBlock";

// Per-render unique id for mermaid.render (must be a valid DOM id).
let _seq = 0;

// How long the code must stay unchanged-and-unrenderable before we treat it as
// genuinely malformed (vs. a still-streaming partial) and reveal the source.
const SETTLE_MS = 1000;

/**
 * Renders a ```mermaid fenced block as a diagram. The heavy `mermaid` library
 * is **dynamically imported** here so it lands in its own chunk, loaded only
 * when a diagram actually appears — the base/chat bundle stays lean.
 *
 * While loading, or while a still-streaming diagram isn't yet valid, we show a
 * compact placeholder — NOT the raw source — so a valid diagram never flashes
 * its code first. Only after the code stays invalid for `SETTLE_MS` (i.e.
 * streaming finished and it genuinely won't parse) do we reveal the source.
 * `securityLevel:"strict"` sanitizes the (untrusted, agent-authored) diagram.
 */
export default function MermaidDiagram({ code }: { code: string }) {
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  const [svg, setSvg] = useState<string | null>(null);
  const [settledInvalid, setSettledInvalid] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    // New code revision → re-evaluate; don't show "source" until it settles.
    setSettledInvalid(false);
    if (timerRef.current) clearTimeout(timerRef.current);

    const markInvalidSoon = () => {
      timerRef.current = setTimeout(() => { if (!cancelled) setSettledInvalid(true); }, SETTLE_MS);
    };

    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        if (cancelled) return;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          // Don't inject the "Syntax error" bomb graphic into the DOM on a
          // failed/partial parse (it piled up at the page bottom mid-stream);
          // render() throws instead and our catch handles it.
          suppressErrorRendering: true,
          theme: resolvedTheme === "dark" ? "dark" : "default",
        });
        const ok = await mermaid.parse(code, { suppressErrors: true });
        if (cancelled) return;
        if (!ok) { markInvalidSoon(); return; } // partial (streaming) or malformed
        const rendered = await mermaid.render(`hms-mermaid-${_seq++}`, code);
        if (!cancelled) setSvg(naturalSizeSvg(rendered.svg));
      } catch {
        if (!cancelled) markInvalidSoon();
      }
    })();

    return () => { cancelled = true; if (timerRef.current) clearTimeout(timerRef.current); };
  }, [code, resolvedTheme]);

  if (svg) {
    return (
      <div
        className="hms-mermaid"
        style={{ display: "flex", justifyContent: "center", padding: "8px 0", overflowX: "auto" }}
        // mermaid renders with securityLevel:"strict" (DOMPurify-sanitized SVG).
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    );
  }

  // Genuinely unrenderable (settled) → show the source so nothing is lost.
  if (settledInvalid) {
    return (
      <div>
        <div style={{ fontSize: "var(--hms-text-caption)", color: "var(--hms-text-muted)", marginBottom: 4 }}>
          Couldn't render Mermaid diagram — showing source.
        </div>
        <CodeBlock language="mermaid" code={code} />
      </div>
    );
  }

  // Loading / still-streaming → compact placeholder (never the raw code).
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 'var(--hms-space-2)',
        padding: "12px 14px",
        margin: "4px 0",
        borderRadius: 8,
        border: "1px solid var(--hms-border)",
        background: "color-mix(in srgb, var(--hms-border) 30%, transparent)",
        color: "var(--hms-text-muted)",
        fontSize: 'var(--hms-text-caption)',
      }}
    >
      <span className="hms-spin" style={{ display: "inline-flex" }}>◐</span>
      Rendering diagram…
    </div>
  );
}
