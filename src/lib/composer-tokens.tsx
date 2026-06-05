import type { ReactNode } from "react";

export interface ComposerToken {
  kind: "slash" | "mention";
  /** Text after the / or @ (the autocomplete query). */
  query: string;
  /** Index of the / or @ char in the value. */
  start: number;
}

/** The `/command` or `@mention` token the cursor is currently inside (after a
 *  start-of-input or whitespace), or null. Enables autocomplete anywhere in the
 *  text (e.g. a second @mention), not just at the start. */
export function composerCurrentToken(value: string, cursor: number): ComposerToken | null {
  const before = value.slice(0, Math.max(0, cursor));
  const m = before.match(/(?:^|\s)([/@])(\S*)$/);
  if (!m) return null;
  const char = m[1];
  const query = m[2];
  return { kind: char === "/" ? "slash" : "mention", query, start: cursor - query.length - 1 };
}

// Highlight a leading `/command` (per line) and `@mention` tokens anywhere —
// used by the Composer's syntax-highlight backdrop (a div mirrored behind a
// transparent textarea). Returns interleaved plain strings + accent spans.
// A leading /command (per line) or an @mention that follows start-of-line or
// whitespace (so `email@host` isn't mistaken for a mention).
const TOKEN_RE = /(^[ \t]*\/[^\s]+)|((?<=^|\s)@[\w-]+)/gm;

export function highlightComposerTokens(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    out.push(
      <span key={key++} style={{ color: "var(--hms-accent)", fontWeight: 600 }}>
        {m[0]}
      </span>,
    );
    last = idx + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  // A trailing zero-width char keeps the backdrop's height in step with the
  // textarea when the value ends in a newline.
  out.push("​");
  return out;
}
