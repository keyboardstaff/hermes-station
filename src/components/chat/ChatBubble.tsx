import { useState } from "react";
import { Copy, Check, Brain, ChevronDown, ChevronRight, ShieldCheck, ShieldX, GitFork, ImageOff, Volume2, Square } from "lucide-react";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import ToolCallCard from "./ToolCallCard";
import CodeBlock from "./CodeBlock";
import MermaidDiagram from "./MermaidDiagram";
import ImageLightbox from "@/components/ui/ImageLightbox";
import { useI18n } from "@/i18n";
import { useChatStore } from "@/store/chat";
import { useTextToSpeech } from "@/hooks/useTextToSpeech";
import type { ChatMessage } from "@/lib/hermes-types";
import type { ReactNode } from "react";

/** Renders approval_notice as a slim system notice (not a user/assistant bubble).
 *  Frontend-synthetic — not stored in DB, disappears on refresh by design. */
function ApprovalNotice({ choice, command }: { choice: string; command: string }) {
  const { t } = useI18n();
  const isDeny = choice === "deny";

  const label =
    choice === "session" ? t.approval.noticeApprovedSession
    : choice === "always" ? t.approval.noticeApprovedAlways
    : isDeny ? t.approval.noticeDenied
    : t.approval.noticeApprovedOnce;

  return (
    <div
      style={{
        alignSelf: "flex-start",
        display: "flex",
        alignItems: "center",
        gap: 'var(--hms-space-2)',
        padding: "6px 10px",
        borderRadius: 10,
        background: isDeny
          ? "color-mix(in srgb, #ef4444 10%, transparent)"
          : "color-mix(in srgb, #22c55e 10%, transparent)",
        color: isDeny ? "var(--hms-error-dark)" : "#166534",
        fontSize: 'var(--hms-text-xs)',
        margin: "4px 0",
      }}
    >
      {isDeny ? <ShieldX size={11} /> : <ShieldCheck size={11} />}
      <span style={{ fontWeight: 600 }}>{label}</span>
      {command && (
        <code
          style={{
            fontFamily: "monospace",
            fontSize: '0.625rem',
            padding: "1px 6px",
            borderRadius: 4,
            color: "var(--hms-text)",
            maxWidth: 360,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {command}
        </code>
      )}
    </div>
  );
}

function ReasoningBlock({ text, streaming }: { text: string; streaming?: boolean }) {
  // Auto-open during streaming so user can watch; collapse after run.completed.
  const [open, setOpen] = useState(false);
  const isOpen = streaming || open;
  return (
    <div
      style={{
        marginBottom: 6,
        borderRadius: 8,
        background: "color-mix(in srgb, var(--hms-border) 80%, transparent)",
        fontSize: 'var(--hms-text-caption)',
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 'var(--hms-space-2)',
          padding: "5px 10px",
          background: "transparent",
          border: "none",
          color: "var(--hms-text-muted)",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <Brain size={12} />
        <span style={{ flex: 1 }}>Thinking{streaming ? "…" : ""}</span>
        {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
      </button>
      {isOpen && (
        <div
          style={{
            padding: "8px 10px",
            color: "var(--hms-text-muted)",
            whiteSpace: "pre-wrap",
            lineHeight: 1.55,
            maxHeight: 220,
            overflowY: "auto",
            fontSize: 'var(--hms-text-caption)',
          }}
        >
          {text}
        </div>
      )}
    </div>
  );
}

/** Extracts raw text from React children (for code block content). */
function extractText(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(extractText).join("");
  if (children && typeof children === "object" && "props" in (children as object)) {
    return extractText((children as { props: { children?: ReactNode } }).props.children);
  }
  return "";
}

/** Renders markdown text using react-markdown + GFM with full component styling.
 *  Components are defined at module level so the object reference is stable
 *  across re-renders, preventing CodeBlock from remounting during streaming. */
const MARKDOWN_COMPONENTS: import("react-markdown").Components = {
  pre: ({ children }) => {
    const codeEl = Array.isArray(children) ? children[0] : children;
    const codeProps = codeEl && typeof codeEl === "object" && "props" in (codeEl as object)
      ? (codeEl as { props: { className?: string; children?: ReactNode } }).props
      : null;
    const lang = (codeProps?.className ?? "").replace(/^language-/, "");
    const code = extractText(codeProps?.children ?? "").replace(/\n$/, "");
    // Mermaid fenced blocks render as diagrams (lazy); everything else is code.
    if (lang === "mermaid") return <MermaidDiagram code={code} />;
    return <CodeBlock language={lang} code={code} />;
  },
  code: ({ className: _className, children, ...props }) => {
    return (
      <code
        style={{
    background: "color-mix(in srgb, var(--hms-border) 80%, transparent)",
    borderRadius: 3,
    padding: "1px 5px",
    fontSize: "0.88em",
    fontFamily: "'Fira Code', Consolas, monospace",
        }}
        {...props}
      >
        {children}
      </code>
    );
  },
  h1: ({ children }) => (
    <h1 style={{ fontSize: "1.45em", fontWeight: 700, margin: "14px 0 6px", lineHeight: 1.3 }}>{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 style={{ fontSize: "1.25em", fontWeight: 700, margin: "12px 0 5px", lineHeight: 1.3 }}>{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 style={{ fontSize: "1.1em", fontWeight: 600, margin: "10px 0 4px", lineHeight: 1.3 }}>{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 style={{ fontSize: "1em", fontWeight: 600, margin: "8px 0 3px" }}>{children}</h4>
  ),
  h5: ({ children }) => (
    <h5 style={{ fontSize: "0.95em", fontWeight: 600, margin: "6px 0 2px" }}>{children}</h5>
  ),
  h6: ({ children }) => (
    <h6 style={{ fontSize: "0.9em", fontWeight: 600, margin: "6px 0 2px", color: "var(--hms-text-muted)" }}>{children}</h6>
  ),
  p: ({ children }) => (
    <p style={{ margin: "4px 0" }}>{children}</p>
  ),
  hr: () => (
    <hr style={{ border: "none", borderTop: "1px solid var(--hms-border)", margin: "10px 0" }} />
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      style={{ color: "var(--hms-accent)", textDecoration: "underline" }}
    >
      {children}
    </a>
  ),
  ul: ({ children }) => (
    <ul style={{ paddingLeft: "1.5em", margin: "4px 0", listStyleType: "disc" }}>{children}</ul>
  ),
  ol: ({ children }) => (
    <ol style={{ paddingLeft: "1.5em", margin: "4px 0", listStyleType: "decimal" }}>{children}</ol>
  ),
  li: ({ children }) => (
    <li style={{ margin: "2px 0", lineHeight: 1.6 }}>{children}</li>
  ),
  blockquote: ({ children }) => (
    <blockquote
      style={{
        borderLeft: "3px solid var(--hms-accent)",
        margin: "8px 0",
        paddingLeft: 12,
        color: "var(--hms-text-muted)",
        fontStyle: "italic",
      }}
    >
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div style={{ overflowX: "auto", margin: "8px 0" }}>
      <table
        style={{
    borderCollapse: "collapse",
    width: "100%",
    fontSize: "0.9em",
    border: "1px solid var(--hms-border)",
    borderRadius: 6,
        }}
      >
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead
      style={{
        background: "color-mix(in srgb, var(--hms-border) 60%, transparent)",
      }}
    >
      {children}
    </thead>
  ),
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => (
    <tr
      style={{
        borderBottom: "1px solid var(--hms-border)",
      }}
    >
      {children}
    </tr>
  ),
  th: ({ children }) => (
    <th
      style={{
        padding: "6px 10px",
        textAlign: "left",
        fontWeight: 600,
        borderBottom: "2px solid var(--hms-border)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td
      style={{
        padding: "5px 10px",
        verticalAlign: "top",
      }}
    >
      {children}
    </td>
  ),
};

function MarkdownText({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={MARKDOWN_COMPONENTS}
    >
      {content}
    </ReactMarkdown>
  );
}

/** Renders the text + image thumbnails for a user message, with lightbox support. */
function UserMessageContent({ msg }: { msg: ChatMessage }) {
  const images = (msg.attachments ?? []).filter((a) => a.isImage && a.content);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  return (
    <div>
      {msg.content && <div style={{ whiteSpace: "pre-wrap" }}>{msg.content}</div>}
      {msg.attachments && msg.attachments.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 'var(--hms-space-2)', marginTop: msg.content ? 8 : 0 }}>
          {msg.attachments.map((att, i) => {
            if (att.isImage) {
              return att.content ? (
                <img
                  key={i}
                  src={att.content}
                  alt={att.name}
                  title={att.name}
                  onClick={() => {
                    setLightboxIndex(images.findIndex((im) => im === att));
                    setLightboxOpen(true);
                  }}
                  style={{
                    width: 120, height: 120,
                    borderRadius: 8, objectFit: "cover",
                    border: "1px solid var(--hms-border)",
                    display: "block", cursor: "pointer", flexShrink: 0,
                  }}
                />
              ) : (
                <div
                  key={i}
                  title="Image not yet loaded"
                  style={{
                    width: 120, height: 120, borderRadius: 8, flexShrink: 0,
                    border: "1px dashed var(--hms-border)", background: "var(--hms-surface)",
                    display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "center",
                    gap: 'var(--hms-space-1)', color: "var(--hms-text-muted)", fontSize: 'var(--hms-text-xs)',
                  }}
                >
                  <ImageOff size={28} strokeWidth={1.5} />
                  <span>Image</span>
                </div>
              );
            }
            if (att.isAudio && att.content) {
              return (
                <audio key={i} controls src={att.content} title={att.name}
                  style={{ maxWidth: 280, flexShrink: 0 }} />
              );
            }
            if (att.isVideo && att.content) {
              return (
                <video key={i} controls src={att.content} title={att.name}
                  style={{ maxWidth: 320, maxHeight: 240, borderRadius: 8, flexShrink: 0 }} />
              );
            }
            return (
              <a
                key={i}
                href={att.content}
                target="_blank"
                rel="noopener noreferrer"
                title={`Open ${att.name}`}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 'var(--hms-space-1)',
                  padding: "3px 8px", borderRadius: 6,
                  border: "1px solid var(--hms-border)", background: "var(--hms-bg)",
                  fontSize: 'var(--hms-text-caption)', color: "var(--hms-text-muted)", textDecoration: "none",
                  maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  cursor: "pointer",
                }}
              >
                📄 {att.name}
              </a>
            );
          })}
        </div>
      )}
      {lightboxOpen && images.length > 0 && (
        <ImageLightbox
          images={images.map((im) => ({ src: im.content, alt: im.name }))}
          initialIndex={lightboxIndex}
          currentIndex={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </div>
  );
}

export default function ChatBubble({ msg }: { msg: ChatMessage }) {
  const [copied, setCopied] = useState(false);
  const [forked, setForked] = useState(false);
  const isUser = msg.role === "user";
  const navigate = useNavigate();
  const setActiveSession = useChatStore((s) => s.setActiveSession);
  const showReasoning = useChatStore((s) => s.showReasoning);
  const tts = useTextToSpeech();

  // Legacy kind=approval_notice from before the segment refactor.
  if (msg.kind === "approval_notice") {
    return <ApprovalNotice choice={msg.approvalChoice ?? "once"} command={msg.approvalCommand ?? ""} />;
  }

  const getMessageText = () =>
    msg.segments
      ? msg.segments
          .filter((s) => s.type === "text")
          .map((s) => (s as { type: "text"; content: string }).content)
          .join("\n")
      : msg.content;

  const copyContent = () => {
    navigator.clipboard.writeText(getMessageText()).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleFork = () => {
    sessionStorage.setItem("hms_fork_input", getMessageText());
    setActiveSession(null);
    navigate("/chat");
    setForked(true);
    setTimeout(() => setForked(false), 1500);
  };

  const actionBtnStyle: React.CSSProperties = {
    border: "none",
    background: "transparent",
    borderRadius: 4,
    padding: "2px 4px",
    cursor: "pointer",
    color: "var(--hms-text-muted)",
    display: "flex",
    alignItems: "center",
  };

  return (
    <div
      className="hms-msg-row"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        padding: "4px 0",
        gap: 'var(--hms-space-1)',
      }}
    >
      <div style={{ fontSize: 'var(--hms-text-xs)', color: "var(--hms-text-muted)", paddingInline: 4 }}>
        {isUser ? "You" : "Assistant"}
      </div>

      <div
        className="hms-msg-bubble"
        style={{
          maxWidth: isUser ? "80%" : "100%",
          background: isUser ? "var(--hms-border)" : "transparent",
          border: "none",
          borderRadius: isUser ? 12 : 0,
          padding: isUser ? "10px 14px" : "4px 0",
          fontSize: 'var(--hms-text-body)',
          lineHeight: 1.6,
          color: "var(--hms-text)",
        }}
      >
        {isUser ? (
          <UserMessageContent msg={msg} />
        ) : (
          /* Assistant: segments-based; content fallback for system notices. */
          <>
            {showReasoning && msg.reasoning && (
              <ReasoningBlock text={msg.reasoning} streaming={msg.streaming} />
            )}
            {msg.segments && msg.segments.length > 0
              ? msg.segments.map((seg, i) =>
                  seg.type === "text"
                    ? (seg.content ? <MarkdownText key={i} content={seg.content} /> : null)
                    : seg.type === "approval_notice"
                    ? <ApprovalNotice key={i} choice={seg.choice} command={seg.command} />
                    : <ToolCallCard key={seg.tc.id} tc={seg.tc} />
                )
              : (msg.content && <MarkdownText content={msg.content} />)
            }
            {msg.streaming && (
              <span
                style={{
                  display: "inline-block",
                  width: 2,
                  height: "1em",
                  background: "currentColor",
                  marginLeft: 2,
                  verticalAlign: "text-bottom",
                  animation: "blink 1s step-end infinite",
                }}
              />
            )}
          </>
        )}

      </div>

      {/* Visibility driven by CSS hover on .hms-msg-row. */}
      {!msg.streaming && (
        <div className="hms-msg-actions" style={{ display: "flex", gap: 'var(--hms-space-1)' }}>
          <button onClick={handleFork} title="Fork conversation" style={actionBtnStyle}>
            {forked ? <Check size={12} /> : <GitFork size={12} />}
          </button>
          <button onClick={copyContent} title="Copy" style={actionBtnStyle}>
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
          {tts.supported && (
            <button
              onClick={() => (tts.speaking ? tts.stop() : tts.speak(getMessageText()))}
              title={tts.speaking ? "Stop" : "Speak"}
              style={actionBtnStyle}
            >
              {tts.speaking ? <Square size={12} /> : <Volume2 size={12} />}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

