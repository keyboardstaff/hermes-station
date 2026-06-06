/**
 * Artifacts projection — derive a session's images / files / links purely from
 * its messages. No new storage: a read-only projection over the same
 * `ChatMessage[]` the chat renders (mirrors Station's "chat store is a
 * projection" model). Used by `ArtifactsPanel`.
 *
 * Sources, per message:
 *   • attachments        — uploaded images (→ image) / docs·audio·video (→ file)
 *   • markdown images    — `![alt](url)`                       (→ image)
 *   • markdown links     — `[text](url)`        classified by url
 *   • bare URLs          — `https://…`          classified by url
 *   • file-writing tools — write_file / edit_file / …          (→ file, path)
 *
 * Pure + deterministic so it can be unit-tested without the DOM or network.
 */

import type { ChatMessage } from "@/lib/hermes-types";

export type ArtifactKind = "image" | "file" | "link";

export interface SessionArtifact {
  /** Dedup + React key — `${kind}:${url}`. */
  key: string;
  kind: ArtifactKind;
  /** href / src / file path. */
  url: string;
  /** Display text (alt / link text / filename). */
  label: string;
  /** The ChatMessage this came from (for jump-to-chat). */
  messageId: string;
  /** Numeric DB row id parsed from `messageId` (`hist-12` / `hist-run-12` → 12),
   *  or null — feeds `pendingScrollMessageId` for the chat scroll-to. */
  messageRowId: number | null;
  role: ChatMessage["role"];
  createdAt: number;
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico|heic)(?:[?#].*)?$/i;
// File-writing tool names (case-insensitive partial match) — their `preview`
// carries the written path. Mirrors useSessionArtifacts' FILE_OP_RE.
const FILE_OP_RE = /write_file|edit_file|create_file|str_replace|apply_patch|patch_file|delete_file|move_file|save_file/i;

// `![alt](url "title")` — capture alt + url (drop any title / angle brackets).
const MD_IMAGE_RE = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?[^)]*\)/g;
// `[text](url)` — NOT preceded by `!` (that's an image).
const MD_LINK_RE = /(?<!!)\[([^\]]+)\]\(\s*<?([^)\s>]+)>?[^)]*\)/g;
// Bare http(s) URL — stop before whitespace / closing punctuation / quotes.
const BARE_URL_RE = /\bhttps?:\/\/[^\s<>()[\]"'`]+/gi;

/** Filename (last path segment, query/hash stripped) for a label fallback. */
function basename(u: string): string {
  const clean = u.split(/[?#]/)[0].replace(/\/+$/, "");
  const seg = clean.slice(clean.lastIndexOf("/") + 1);
  return seg || u;
}

function parseRowId(id: string): number | null {
  const m = id.match(/(\d+)$/);
  return m ? Number(m[1]) : null;
}

/** image (by data-URL or extension) · link (has a scheme) · file (a bare path). */
export function classifyUrl(url: string): ArtifactKind {
  if (url.startsWith("data:image/") || IMAGE_EXT_RE.test(url)) return "image";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) || url.startsWith("mailto:") || url.startsWith("//")) {
    return "link";
  }
  return "file";
}

export function extractArtifacts(messages: ChatMessage[]): SessionArtifact[] {
  const out: SessionArtifact[] = [];
  const seen = new Set<string>();

  const push = (
    kind: ArtifactKind,
    url: string,
    label: string,
    msg: ChatMessage,
  ) => {
    if (!url) return;
    const key = `${kind}:${url}`;
    if (seen.has(key)) return; // first occurrence wins (earliest message)
    seen.add(key);
    out.push({
      key,
      kind,
      url,
      label: label.trim() || basename(url),
      messageId: msg.id,
      messageRowId: parseRowId(msg.id),
      role: msg.role,
      createdAt: msg.createdAt ?? 0,
    });
  };

  for (const msg of messages) {
    // 1. Attachments (uploaded images / docs / audio / video). Empty content =
    //    an unrecoverable placeholder ghost — skip.
    for (const att of msg.attachments ?? []) {
      if (!att.content) continue;
      push(att.isImage ? "image" : "file", att.content, att.name, msg);
    }

    // 2. Markdown + bare URLs in the text content.
    const text = msg.content ?? "";
    if (text) {
      for (const m of text.matchAll(MD_IMAGE_RE)) {
        push("image", m[2], m[1] || basename(m[2]), msg);
      }
      for (const m of text.matchAll(MD_LINK_RE)) {
        const url = m[2];
        push(classifyUrl(url), url, m[1] || basename(url), msg);
      }
      for (const m of text.matchAll(BARE_URL_RE)) {
        const url = m[0];
        push(classifyUrl(url), url, basename(url), msg);
      }
    }

    // 3. File-writing tool calls — the written path lives in `preview`.
    const segs = msg.segments ?? msg.toolCalls?.map((tc) => ({ type: "tool" as const, tc })) ?? [];
    for (const seg of segs) {
      if (seg.type !== "tool") continue;
      const { tc } = seg;
      if (!FILE_OP_RE.test(tc.toolName) || !tc.preview) continue;
      push("file", tc.preview, tc.preview, msg);
    }
  }

  return out;
}
