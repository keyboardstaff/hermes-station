import { lazy, Suspense } from "react";
import type { ChatMessage } from "@/lib/hermes-types";

// Presentational transcript body shared by the live chat view (ChatStream)
// and the /sessions preview drawer. ChatBubble — and its
// heavy render stack (react-markdown + remark-gfm + highlight.js) — is
// `lazy()`-loaded here so it is code-split into its own chunk: opening the
// /sessions *table* no longer pulls markdown/highlight.js until a preview
// (or /chat) actually renders a bubble.
//
// This component owns only the scrollable container + the bubble list and the
// inline loading/error/empty placeholders. "Live" concerns — auto-scroll,
// streaming jank avoidance, the scroll-to-bottom affordance, session-switch
// animations — are layered on top by ChatStream, which passes `scrollRef`,
// `onScroll`, and a `footer` (its bottom sentinel).
const ChatBubble = lazy(() => import("./ChatBubble"));

export interface ChatThreadLabels {
  loading: string;
  empty: string;
  /** Rendered as ``{error}: {err.message}`` when an error is present. */
  error: string;
}

export function ChatThread({
  messages,
  loading = false,
  error = null,
  labels,
  scrollRef,
  onScroll,
  footer,
  style,
}: {
  messages: ChatMessage[];
  loading?: boolean;
  error?: Error | null;
  labels: ChatThreadLabels;
  scrollRef?: React.Ref<HTMLDivElement>;
  onScroll?: () => void;
  /** Rendered after the bubbles, inside the scroll container (e.g. a scroll sentinel). */
  footer?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      style={{ overflowY: "auto", display: "flex", flexDirection: "column", ...style }}
    >
      {loading ? (
        <div style={{ fontSize: 'var(--hms-text-caption)', color: "var(--hms-text-muted)" }}>
          {labels.loading}
        </div>
      ) : error ? (
        <div style={{
          fontSize: 'var(--hms-text-caption)', color: "var(--hms-error-dark)",
          padding: "8px 10px", borderRadius: 6,
          background: "var(--hms-error-bg)", border: "1px solid #ef4444",
        }}>
          {labels.error}: {error.message}
        </div>
      ) : messages.length === 0 ? (
        <div style={{ fontSize: 'var(--hms-text-caption)', color: "var(--hms-text-muted)" }}>
          {labels.empty}
        </div>
      ) : (
        <Suspense fallback={null}>
          {messages.map((msg) => (
            <ChatBubble key={msg.id} msg={msg} />
          ))}
        </Suspense>
      )}
      {footer}
    </div>
  );
}
