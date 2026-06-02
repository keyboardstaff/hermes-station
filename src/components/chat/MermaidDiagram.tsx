import { useEffect, useState } from "react";
import { useThemeStore } from "@/store/app";
import CodeBlock from "./CodeBlock";

// Per-render unique id for mermaid.render (must be a valid DOM id).
let _seq = 0;

/**
 * Renders a ```mermaid fenced block as a diagram. The heavy `mermaid` library
 * is **dynamically imported** here so it lands in its own chunk, loaded only
 * when a diagram actually appears — the base/chat bundle stays lean.
 *
 * Mid-stream a diagram is often syntactically incomplete; we `parse` first
 * (suppressErrors) and fall back to the **source** until it's valid, so a
 * partial diagram degrades gracefully instead of throwing. `securityLevel:
 * "strict"` sanitizes the (untrusted, agent-authored) diagram before render.
 */
export default function MermaidDiagram({ code }: { code: string }) {
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        if (cancelled) return;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: resolvedTheme === "dark" ? "dark" : "default",
        });
        const ok = await mermaid.parse(code, { suppressErrors: true });
        if (cancelled) return;
        if (!ok) { setSvg(null); setFailed(false); return; } // incomplete → show source
        const rendered = await mermaid.render(`hms-mermaid-${_seq++}`, code);
        if (!cancelled) { setSvg(rendered.svg); setFailed(false); }
      } catch {
        if (!cancelled) { setSvg(null); setFailed(true); }
      }
    })();
    return () => { cancelled = true; };
  }, [code, resolvedTheme]);

  if (!svg) {
    return (
      <div>
        {failed && (
          <div style={{ fontSize: "var(--hms-text-caption)", color: "var(--hms-text-muted)", marginBottom: 4 }}>
            Couldn't render Mermaid diagram — showing source.
          </div>
        )}
        <CodeBlock language="mermaid" code={code} />
      </div>
    );
  }

  return (
    <div
      className="hms-mermaid"
      style={{ display: "flex", justifyContent: "center", padding: "8px 0", overflowX: "auto" }}
      // mermaid renders with securityLevel:"strict" (DOMPurify-sanitized SVG).
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
