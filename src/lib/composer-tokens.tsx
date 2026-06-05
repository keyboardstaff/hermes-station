import type { ReactNode } from "react";

// Highlight a leading `/command` (per line) and `@mention` tokens anywhere —
// used by the Composer's syntax-highlight backdrop (a div mirrored behind a
// transparent textarea). Returns interleaved plain strings + accent spans.
const TOKEN_RE = /(^[ \t]*\/[^\s]+)|(@[\w-]+)/gm;

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
