// PDF export for session transcripts — pure HTML builder (testable) plus a thin
// open-and-print launcher. No PDF library: we open a print window and let the
// browser's "Save as PDF" do the rendering (zero-dependency, full fidelity).

import type { MessageRow } from "@/lib/session-messages";

export interface SessionExport {
  id: string;
  messages: MessageRow[];
}

/** HTML-escape so message content can't inject markup into the print window. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** MessageRow.content is string | array (multimodal) | null — coerce to text. */
function contentToText(content: MessageRow["content"]): string {
  if (typeof content === "string") return content;
  if (content == null) return "";
  return JSON.stringify(content);
}

const PRINT_CSS = `
  * { box-sizing: border-box; }
  body { font-family: -apple-system, system-ui, "Segoe UI", sans-serif; color: #111; margin: 24px; line-height: 1.5; }
  h1 { font-size: 18px; margin: 0 0 16px; }
  section { page-break-after: always; }
  section:last-child { page-break-after: auto; }
  h2 { font-size: 12px; color: #555; border-bottom: 1px solid #ddd; padding-bottom: 4px; margin: 24px 0 8px; word-break: break-all; }
  .msg { margin: 10px 0; }
  .role { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #888; font-weight: 600; margin-bottom: 2px; }
  .content { white-space: pre-wrap; word-break: break-word; font-size: 13px; }
  .msg.tool .content { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; background: #f5f5f5; padding: 6px 8px; border-radius: 4px; }
  @media print { body { margin: 0; } }
`;

/** Build a standalone, printable HTML document for the given sessions —
 *  every role (user / assistant / tool) is included so the export is a full,
 *  auditable transcript. */
export function buildSessionsPrintHtml(sessions: SessionExport[]): string {
  const body = sessions
    .map(
      ({ id, messages }) =>
        `<section><h2>Session ${escapeHtml(id)}</h2>` +
        messages
          .map(
            (m: MessageRow) =>
              `<div class="msg ${escapeHtml(m.role)}">` +
              `<div class="role">${escapeHtml(m.role)}</div>` +
              `<div class="content">${escapeHtml(contentToText(m.content))}</div></div>`,
          )
          .join("") +
        `</section>`,
    )
    .join("");
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<title>Hermes Station — sessions export</title><style>${PRINT_CSS}</style></head>` +
    `<body><h1>Hermes Station — ${sessions.length} session${sessions.length === 1 ? "" : "s"}</h1>${body}</body></html>`
  );
}

/** Open the print dialog for the built document. Returns false if the popup was
 *  blocked (the caller can surface a hint). */
export function printSessionsPdf(sessions: SessionExport[]): boolean {
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.write(buildSessionsPrintHtml(sessions));
  w.document.close();
  w.focus();
  // Give the new document a tick to lay out before invoking print.
  setTimeout(() => { try { w.print(); } catch { /* user closed it */ } }, 300);
  return true;
}
