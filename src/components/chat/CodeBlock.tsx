import { useState, useMemo, useEffect } from "react";
import { Copy, Check, ChevronRight, ChevronDown } from "lucide-react";
import hljs from "highlight.js";
import darkThemeUrl from "highlight.js/styles/github-dark.min.css?url";
import lightThemeUrl from "highlight.js/styles/github.min.css?url";
import { useThemeStore } from "@/store/app";

// Auto-collapse threshold (lines)
const COLLAPSE_THRESHOLD = 8;

interface CodeBlockProps {
  language: string;
  code: string;
}

export default function CodeBlock({ language, code }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);

  // Swap the hljs stylesheet when the theme changes. A single <link id="hljs-theme">
  // element in <head> is reused across all CodeBlock instances.
  useEffect(() => {
    const id = "hljs-theme";
    let link = document.getElementById(id) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    link.href = resolvedTheme === "dark" ? darkThemeUrl : lightThemeUrl;
  }, [resolvedTheme]);

  const lineCount = useMemo(() => code.split("\n").length, [code]);
  const showCollapseButton = lineCount > COLLAPSE_THRESHOLD;

  // Syntax highlight
  const highlighted = useMemo(() => {
    if (!code) return "";
    try {
      if (language && hljs.getLanguage(language)) {
        return hljs.highlight(code, { language, ignoreIllegals: true }).value;
      }
      return hljs.highlightAuto(code).value;
    } catch {
      // Fallback: escape HTML entities so raw code renders safely
      return code
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }
  }, [language, code]);

  const handleCopy = () => {
    navigator.clipboard.writeText(code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const langLabel = language || "text";

  return (
    <div
      style={{
        borderRadius: 10,
        // border: "1px solid var(--hms-border)",
        background: "color-mix(in srgb, var(--hms-surface) 80%, transparent)",
        overflow: "hidden",
        margin: "8px 0",
        fontSize: 'var(--hms-text-sm)',
      }}
    >
      {/* Header bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 10px",
          background: "color-mix(in srgb, var(--hms-surface) 80%, var(--hms-border) 20%)",
          // borderBottom: collapsed ? "none" : "1px solid var(--hms-border)",
          // borderBottom: "1px solid var(--hms-border)",
          gap: 'var(--hms-space-2)',
        }}
      >
        <span
          style={{
            fontSize: 'var(--hms-text-xs)',
            fontFamily: "monospace",
            color: "var(--hms-text-muted)",
            textTransform: "lowercase",
            userSelect: "none",
          }}
        >
          {langLabel}
        </span>

        <div style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-1)' }}>
          <button
            onClick={handleCopy}
            title="Copy code"
            style={{
              display: "flex",
              alignItems: "center",
              padding: "2px 4px",
              color: copied ? "var(--hms-accent)" : "var(--hms-text-muted)",
              background: "transparent",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
          {showCollapseButton && (
            <button
              onClick={() => setCollapsed((c) => !c)}
              title={collapsed ? "Expand" : "Collapse"}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "2px 4px",
                color: "var(--hms-text-muted)",
                background: "transparent",
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            </button>
          )}
        </div>
      </div>

      {/* Code body — grid-row transition for smooth collapse animation */}
      <div
        style={{
          display: "grid",
          gridTemplateRows: collapsed ? "0fr" : "1fr",
          transition: "grid-template-rows 0.2s ease",
        }}
      >
        <div style={{ overflow: "hidden" }}>
          <pre
            style={{
              margin: 0,
              padding: "12px 14px",
              overflowX: "auto",
              background: "transparent",
              lineHeight: 1.55,
            }}
          >
            <code
              className={`hljs language-${langLabel}`}
              // hljs output is escaped — safe to set as HTML
              dangerouslySetInnerHTML={{ __html: highlighted }}
              style={{ fontFamily: "'Fira Code', 'Cascadia Code', Consolas, monospace" }}
            />
          </pre>
        </div>
      </div>
    </div>
  );
}
