// Rich PDF export for session transcripts. The transcript is rendered the same
// way the chat renders it — Markdown (GFM), KaTeX math (as MathML, so no font
// dependency in the print window), and Mermaid diagrams — with tool-call cards
// stripped, then opened in a print window for the browser's "Save as PDF".
//
// The heavy renderers (react-dom/server, react-markdown, mermaid, plugins) are
// dynamically imported so they only load when an export actually runs.

import { api } from "@/lib/api";
import type { ChatMessage } from "@/lib/hermes-types";
import type { MessageRow } from "@/lib/session-messages";
import { historyToChatMessages } from "@/lib/session-messages";

// CJK-capable stack so Chinese/Japanese/Korean transcripts render in the PDF
// (the print engine may not fall back to a CJK face otherwise).
const FONT_STACK =
  `-apple-system, system-ui, "Segoe UI", "PingFang SC", "Hiragino Sans GB", ` +
  `"Microsoft YaHei", "Noto Sans CJK SC", "Noto Sans", sans-serif`;

const PRINT_CSS = `
  * { box-sizing: border-box; }
  body { font-family: ${FONT_STACK}; color: #111; background: #fff; margin: 24px; line-height: 1.6; font-size: 13px; }
  h1.doc { font-size: 18px; margin: 0 0 16px; }
  section { page-break-after: always; }
  section:last-child { page-break-after: auto; }
  h2.session { font-size: 12px; color: #555; border-bottom: 1px solid #ddd; padding-bottom: 4px; margin: 24px 0 12px; word-break: break-all; }
  .msg { margin: 14px 0; }
  .role { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #888; font-weight: 600; margin-bottom: 4px; }
  .content > :first-child { margin-top: 0; }
  .content h1, .content h2, .content h3, .content h4 { line-height: 1.3; margin: 12px 0 6px; }
  .content p { margin: 6px 0; }
  .content ul, .content ol { margin: 6px 0; padding-left: 22px; }
  .content pre { background: #f5f5f5; padding: 10px 12px; border-radius: 6px; overflow-x: auto; }
  .content code { font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
  .content table { border-collapse: collapse; margin: 8px 0; }
  .content th, .content td { border: 1px solid #ddd; padding: 4px 8px; text-align: left; }
  .content blockquote { margin: 8px 0; padding-left: 12px; border-left: 3px solid #ddd; color: #555; }
  .content img { max-width: 100%; }
  .content .mermaid { display: flex; justify-content: center; overflow-x: auto; margin: 10px 0; }
  .content .mermaid svg { max-width: 100%; height: auto; }
  @media print { body { margin: 0; } a { color: inherit; text-decoration: none; } }
`;

/** HTML-escape so role labels / session ids can't inject markup. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Text-only Markdown for one message — tool / approval segments are dropped so
 *  the export reads as a clean transcript (no tool cards). Returns "" for a
 *  message with no renderable text. */
export function messageToMarkdown(msg: ChatMessage): string {
  if (msg.role === "tool") return "";
  const text = msg.segments
    ? msg.segments.filter((s) => s.type === "text").map((s) => (s.type === "text" ? s.content : "")).join("\n\n")
    : msg.content;
  return (text ?? "").trim();
}

const MERMAID_RE = /```mermaid[^\n]*\n([\s\S]*?)```/g;
// No underscores → GFM intraword rules can't mangle the placeholder.
const PLACEHOLDER = "HMSMERMAIDPH";

/** Pull ```mermaid fences out of Markdown, leaving a paragraph placeholder per
 *  fence; returns the stripped Markdown and the diagram sources (index-aligned). */
export function extractMermaid(md: string): { md: string; fences: string[] } {
  const fences: string[] = [];
  const out = md.replace(MERMAID_RE, (_m, code) => {
    const i = fences.length;
    fences.push(String(code).trim());
    return `\n\n${PLACEHOLDER}${i}\n\n`;
  });
  return { md: out, fences };
}

/** Wrap rendered section HTML into a standalone printable document. */
export function buildPrintDoc(sectionsHtml: string, sessionCount: number): string {
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<title>Hermes Station — sessions export</title><style>${PRINT_CSS}</style></head>` +
    `<body><h1 class="doc">Hermes Station — ${sessionCount} session${sessionCount === 1 ? "" : "s"}</h1>` +
    `${sectionsHtml}</body></html>`
  );
}

/**
 * Fetch the given sessions, render each transcript (Markdown + math + Mermaid,
 * tool cards stripped), and open the print dialog. Returns false if the popup
 * was blocked. Single- or multi-session.
 */
export async function exportSessionsToPdf(ids: string[]): Promise<boolean> {
  if (ids.length === 0) return true;

  const [{ renderToStaticMarkup }, ReactMarkdown, remarkGfm, remarkMath, rehypeKatex, mermaid] =
    await Promise.all([
      import("react-dom/server"),
      import("react-markdown").then((m) => m.default),
      import("remark-gfm").then((m) => m.default),
      import("remark-math").then((m) => m.default),
      import("rehype-katex").then((m) => m.default),
      import("mermaid").then((m) => m.default),
    ]);

  // Light theme for print (white paper); MathML output avoids any KaTeX font
  // dependency in the detached print window.
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true, theme: "default" });

  const renderMarkdown = (md: string): string =>
    renderToStaticMarkup(
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { output: "mathml" }]]}
      >
        {md}
      </ReactMarkdown>,
    );

  const renderMermaid = async (code: string, uid: string): Promise<string> => {
    try {
      if (!(await mermaid.parse(code, { suppressErrors: true }))) return "";
      const { svg } = await mermaid.render(`hms-pdf-${uid}`, code);
      return svg;
    } catch {
      return "";
    }
  };

  const sessions = await Promise.all(
    ids.map(async (id) => {
      const d = await api
        .get<{ messages?: MessageRow[] }>(`/api/sessions/${encodeURIComponent(id)}/messages?limit=5000`)
        .catch(() => ({ messages: [] as MessageRow[] }));
      return { id, messages: d.messages ?? [] };
    }),
  );

  let uid = 0;
  const sections: string[] = [];
  for (const s of sessions) {
    const msgs: string[] = [];
    for (const msg of historyToChatMessages(s.messages)) {
      const text = messageToMarkdown(msg);
      if (!text) continue;
      const { md, fences } = extractMermaid(text);
      const svgs = await Promise.all(fences.map((c) => renderMermaid(c, `${uid++}`)));
      const html = renderMarkdown(md).replace(
        new RegExp(`<p>${PLACEHOLDER}(\\d+)</p>`, "g"),
        (_m, n: string) => (svgs[+n] ? `<div class="mermaid">${svgs[+n]}</div>` : ""),
      );
      const who = msg.role === "user" ? "You" : msg.role === "assistant" ? "Assistant" : msg.role;
      msgs.push(`<div class="msg ${escapeHtml(msg.role)}"><div class="role">${escapeHtml(who)}</div><div class="content">${html}</div></div>`);
    }
    sections.push(`<section><h2 class="session">Session ${escapeHtml(s.id)}</h2>${msgs.join("")}</section>`);
  }

  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(buildPrintDoc(sections.join(""), sessions.length));
  w.document.close();
  w.focus();
  setTimeout(() => { try { w.print(); } catch { /* user closed it */ } }, 400);
  return true;
}
