import { useEffect } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { X, ExternalLink, FileText } from "lucide-react";
import { useFileRead } from "@/hooks/useFiles";
import type { FileTarget } from "@/lib/file-target";
import CodeBlock from "@/components/chat/CodeBlock";

/**
 * DocPreview — a modal that renders a text document with formatting, the way
 * the image lightbox previews an image. Markdown is rendered (GFM); any other
 * text file is shown as syntax-highlighted code. Binary files degrade to a
 * "can't preview" note with an "open in Files" escape hatch.
 *
 * Reads through the same whitelisted `/api/files/read` surface as the Files
 * page (`useFileRead`), so it can only reach the `hermes` / `workspace` roots.
 */

const MARKDOWN_EXT = /\.(md|markdown|mdx)$/i;

const EXT_LANG: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", mjs: "javascript",
  py: "python", rb: "ruby", go: "go", rs: "rust", java: "java", c: "c", h: "c",
  cpp: "cpp", cc: "cpp", hpp: "cpp", cs: "csharp", php: "php", swift: "swift", kt: "kotlin",
  sh: "bash", bash: "bash", zsh: "bash", ps1: "powershell",
  json: "json", yaml: "yaml", yml: "yaml", toml: "toml", ini: "ini",
  xml: "xml", html: "html", css: "css", scss: "scss", sql: "sql", graphql: "graphql",
};

function extOf(path: string): string {
  const m = path.split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : "";
}

// Route fenced code blocks to the shared highlighter, like the chat renderer.
const MD_COMPONENTS: import("react-markdown").Components = {
  code({ className, children, ...props }) {
    const text = String(children ?? "").replace(/\n$/, "");
    const lang = /language-(\w+)/.exec(className ?? "")?.[1];
    if (!lang && !text.includes("\n")) {
      return <code className={className} {...props}>{children}</code>;
    }
    return <CodeBlock language={lang ?? ""} code={text} />;
  },
};

export default function DocPreview({
  target, label, onClose, onOpenInFiles,
}: {
  target: FileTarget;
  label: string;
  onClose: () => void;
  onOpenInFiles: () => void;
}) {
  const read = useFileRead(target.root, target.path, true);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const isMarkdown = MARKDOWN_EXT.test(target.path);
  const data = read.data;
  const text = data && !data.binary ? data.content : "";

  let body: React.ReactNode;
  if (read.isLoading) {
    body = <div style={muted}>Loading…</div>;
  } else if (read.isError || !data) {
    body = <div style={muted}>Failed to read this file.</div>;
  } else if (data.binary) {
    body = <div style={muted}>Binary file — no text preview.</div>;
  } else if (isMarkdown) {
    body = (
      <div className="skill-md-content" style={{ maxWidth: "var(--hms-content-max-w, 72ch)", margin: "0 auto" }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>{text}</ReactMarkdown>
      </div>
    );
  } else {
    body = <CodeBlock language={EXT_LANG[extOf(target.path)] ?? ""} code={text} />;
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "var(--hms-dialog-backdrop)", padding: 'var(--hms-space-6)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: "flex", flexDirection: "column", width: "min(900px, 100%)", maxHeight: "100%",
          background: "var(--hms-surface)", border: "1px solid var(--hms-border)",
          borderRadius: 'var(--hms-radius-lg)', overflow: "hidden",
          boxShadow: "0 12px 48px rgba(0,0,0,0.3)",
        }}
      >
        <div
          style={{
            display: "flex", alignItems: "center", gap: 'var(--hms-space-2)',
            padding: "8px 12px", borderBottom: "1px solid var(--hms-border)", flexShrink: 0,
          }}
        >
          <FileText size={14} style={{ flexShrink: 0, color: "var(--hms-text-muted)" }} />
          <span title={target.path} style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 'var(--hms-text-sm)', fontWeight: 600, color: "var(--hms-text)" }}>
            {label}
          </span>
          <button type="button" onClick={onOpenInFiles} title="Open in Files" aria-label="Open in Files" style={iconBtn}>
            <ExternalLink size={15} />
          </button>
          <button type="button" onClick={onClose} aria-label="Close" style={iconBtn}>
            <X size={16} />
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 'var(--hms-space-4)' }}>
          {body}
        </div>
      </div>
    </div>,
    document.body,
  );
}

const muted: React.CSSProperties = {
  padding: 'var(--hms-space-6)', color: "var(--hms-text-muted)", fontSize: 'var(--hms-text-sm)', textAlign: "center",
};

const iconBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  width: 30, height: 30, flexShrink: 0, border: "none", borderRadius: 6,
  background: "transparent", color: "var(--hms-text-muted)", cursor: "pointer",
};
