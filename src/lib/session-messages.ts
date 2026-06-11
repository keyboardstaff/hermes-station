/** Rebuild ChatMessage[] from /api/sessions/<id>/messages rows.
 *  user rows → standalone; assistant+tool rows group into a single assistant
 *  message with segments[] interleaved in DB order. */
import type { ChatMessage, MessageSegment, ToolCall } from "@/lib/hermes-types";

/** Mirror of the server's heuristic (runs.py _on_tool_complete): infer error
 *  from the result head since DB tool rows carry no explicit status flag. */
function inferToolStatus(result: string): ToolCall["status"] {
  const head = result.trimStart().slice(0, 60).toLowerCase();
  return head.startsWith("error") || head.startsWith("traceback") ? "error" : "done";
}

export interface MessageRow {
  id: number;
  role: string;
  /** Multimodal user rows arrive as parsed JSON arrays; plain rows as strings. */
  content: string | unknown[] | null;
  /** Already-parsed by server/routes/chat.py; string form tolerated for legacy rows. */
  tool_calls:
    | Array<{ id?: string; function?: { name?: string }; name?: string }>
    | string
    | null;
  tool_name: string | null;
  tool_call_id: string | null;
  timestamp: number;
  /** Assistant rows persist the thinking trace; restored so a refresh keeps
   *  the Thinking disclosure (desktop reads the same fields, same order). */
  reasoning?: string | null;
  reasoning_content?: string | null;
  reasoning_details?: unknown;
}

/** The thinking trace of an assistant row, desktop's field preference. */
function rowReasoning(m: MessageRow): string {
  return (
    m.reasoning ||
    m.reasoning_content ||
    (typeof m.reasoning_details === "string" ? m.reasoning_details : "") ||
    ""
  );
}

/** Accepts plain string, JSON-serialised content array, or parsed array.
 *  `[screenshot]` placeholders yield isImage:true with empty content → ghost card. */
function parseUserContent(raw: string | unknown[] | null): {
  text: string;
  attachments?: Array<{ name: string; content: string; isImage: boolean }>;
} {
  if (raw == null || raw === "") return { text: "" };

  let parts: unknown = Array.isArray(raw) ? raw : null;
  // Forward-compat: string starting with [ may be unparsed JSON.
  if (parts === null && typeof raw === "string" && raw.trimStart().startsWith("[")) {
    try { parts = JSON.parse(raw); } catch { /* not JSON */ }
  }
  if (Array.isArray(parts)) {
    const textParts: string[] = [];
    const attachments: Array<{ name: string; content: string; isImage: boolean }> = [];

    for (const p of parts as Array<Record<string, unknown>>) {
      if (typeof p !== "object" || p === null) continue;

      if (p.type === "image_url") {
        const iu = p.image_url as Record<string, unknown> | undefined;
        const url = typeof iu?.url === "string" ? iu.url : "";
        if (url) {
          attachments.push({ name: "image", content: url, isImage: true });
        }
      } else if (p.type === "text") {
        // First text part = user input; subsequent ones are ```filename\n…``` attachments.
        const text = typeof p.text === "string" ? p.text : "";
        const isFirstText = textParts.length === 0;

        if (isFirstText) {
          textParts.push(text);
        } else {
          const m = text.match(/^```([^\n]+)\n([\s\S]*)$/);
          if (m) {
            attachments.push({ name: m[1].trim(), content: "", isImage: false });
          }
        }
      }
    }

    return {
      text: textParts.join(" "),
      attachments: attachments.length > 0 ? attachments : undefined,
    };
  }

  // From here on we need a plain string.
  if (typeof raw !== "string") return { text: "" };

  // Plain-text with [screenshot] placeholders (hermes trajectory storage format).
  // Each [screenshot] line becomes an attachment placeholder (content = "").
  const PLACEHOLDER_RE = /\[screenshot\]/gi;
  const count = (raw.match(PLACEHOLDER_RE) ?? []).length;
  if (count > 0) {
    const text = raw.replace(/\s*\[screenshot\]\s*/gi, "").trim();
    const attachments = Array.from({ length: count }, (_, i) => ({
      name: `screenshot ${i + 1}`,
      content: "",   // empty = not recoverable
      isImage: true,
    }));
    return { text, attachments };
  }

  return { text: raw };
}


export function historyToChatMessages(rows: MessageRow[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  let runSegments: MessageSegment[] = [];
  let runFirstId: number | null = null;
  let runTimestamp = 0;
  let runReasoning: string[] = [];

  const flushRun = () => {
    if (runSegments.length === 0 || runFirstId === null) return;
    const textContent = runSegments
      .filter((s): s is { type: "text"; content: string } => s.type === "text")
      .map((s) => s.content)
      .join("\n");
    const reasoning = runReasoning.join("\n\n");
    out.push({
      id: `hist-run-${runFirstId}`,
      role: "assistant",
      content: textContent,
      segments: runSegments,
      ...(reasoning ? { reasoning } : {}),
      createdAt: runTimestamp,
    });
    runSegments = [];
    runFirstId = null;
    runReasoning = [];
  };

  for (const m of rows) {
    if (m.role === "user") {
      flushRun();
      const { text, attachments } = parseUserContent(m.content);
      out.push({
        id: `hist-${m.id}`,
        role: "user",
        content: text,
        ...(attachments ? { attachments } : {}),
        createdAt: (m.timestamp ?? 0) * 1000,
      });
      continue;
    }

    if (runFirstId === null) {
      runFirstId = m.id;
      runTimestamp = (m.timestamp ?? 0) * 1000;
    }

    if (m.role === "assistant") {
      const reasoning = rowReasoning(m);
      if (reasoning) runReasoning.push(reasoning);
      if (typeof m.content === "string" && m.content) {
        runSegments.push({ type: "text", content: m.content });
      }
      if (Array.isArray(m.tool_calls)) {
        m.tool_calls.forEach((tc, i) => {
          runSegments.push({
            type: "tool",
            tc: {
              id: tc.id ?? `hist-tc-${m.id}-${i}`,
              toolName: tc.function?.name ?? tc.name ?? "unknown",
              // Provisional; corrected to error/done once the tool result row lands.
              status: "done",
            },
          });
        });
      }
    } else if (m.role === "tool" && m.tool_call_id && typeof m.content === "string" && m.content) {
      const idx = runSegments.findIndex(
        (s) => s.type === "tool" && s.tc.id === m.tool_call_id
      );
      if (idx !== -1) {
        const seg = runSegments[idx] as { type: "tool"; tc: ToolCall };
        runSegments[idx] = {
          type: "tool",
          tc: { ...seg.tc, result: m.content, status: inferToolStatus(m.content) },
        };
      }
    }
  }

  flushRun();
  return out;
}

/** Fill [screenshot] placeholders with real URLs from GET /api/upload/session/<id>.
 *  Server returns attachments by uploaded_at asc — matches transcript order. */
export interface SessionAttachment {
  name: string;
  url: string;
  mime: string;
  is_image: boolean;
  is_audio?: boolean;
  is_video?: boolean;
  uploaded_at: number;
}

export function enrichMessagesWithAttachments(
  messages: ChatMessage[],
  sessionAttachments: SessionAttachment[],
): ChatMessage[] {
  if (sessionAttachments.length === 0) return messages;

  // Refill image placeholders sequentially.
  const images = sessionAttachments.filter((a) => a.is_image);
  let imgIdx = 0;
  const withImages = images.length === 0 ? messages : messages.map((msg) => {
    if (msg.role !== "user" || !msg.attachments?.some((a) => a.isImage && !a.content)) {
      return msg;
    }
    const newAtts = msg.attachments.map((att) => {
      if (att.isImage && !att.content && imgIdx < images.length) {
        const img = images[imgIdx++];
        return { ...att, name: img.name, content: img.url };
      }
      return att;
    });
    return { ...msg, attachments: newAtts };
  });

  // Match A/V/document attachments by URL embedded in content.
  const nonImages = sessionAttachments.filter((a) => !a.is_image);
  if (nonImages.length === 0) return withImages;

  return withImages.map((msg) => {
    if (msg.role !== "user" || !msg.content) return msg;
    const toAdd = nonImages.filter(
      (a) =>
        msg.content!.includes(a.url) &&
        !msg.attachments?.some((existing) => existing.content === a.url),
    );
    if (toAdd.length === 0) return msg;
    return {
      ...msg,
      attachments: [
        ...(msg.attachments ?? []),
        ...toAdd.map((a) => ({
          name: a.name, content: a.url, isImage: false as const,
          isAudio: a.is_audio || a.mime.startsWith("audio/"),
          isVideo: a.is_video || a.mime.startsWith("video/"),
        })),
      ],
    };
  });
}
