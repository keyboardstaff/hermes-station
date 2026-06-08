import { lazy, Suspense } from "react";
import { ThreadPrimitive, useAuiState } from "@assistant-ui/react";
import type { ChatMessage } from "@/lib/hermes-types";

// Reuse Station's mature bubble renderer (markdown + highlight.js + mermaid +
// katex + reasoning + tool cards + attachments). It is `lazy()`-loaded so the
// heavy markdown stack stays code-split, matching the old ChatThread.
const ChatBubble = lazy(() => import("../ChatBubble"));

/** Renders one assistant-ui message by handing the original Station
 *  ChatMessage (carried on `metadata.custom.hms`) back to ChatBubble. */
function HmsMessage() {
  const hms = useAuiState(
    (s) => (s.message.metadata?.custom as { hms?: ChatMessage } | undefined)?.hms,
  );
  if (!hms) return null;
  return <ChatBubble msg={hms} />;
}

const MESSAGE_COMPONENTS = { Message: HmsMessage } as const;

interface AssistantThreadProps {
  scrollRef?: React.Ref<HTMLDivElement>;
  onScroll?: () => void;
  /** Rendered after the messages, inside the scroll container (scroll sentinel). */
  footer?: React.ReactNode;
  style?: React.CSSProperties;
}

/**
 * The live chat transcript, driven by the assistant-ui runtime. Shares
 * ChatStream's scroll container contract (scrollRef / onScroll / footer /
 * style) so auto-scroll, the scroll-to-bottom affordance and search-jump
 * (which keys off `data-msg-id`) keep working unchanged. Must be rendered
 * inside an <AssistantRuntimeProvider>.
 */
export default function AssistantThread({ scrollRef, onScroll, footer, style }: AssistantThreadProps) {
  return (
    <ThreadPrimitive.Root asChild>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        style={{ overflowY: "auto", display: "flex", flexDirection: "column", ...style }}
      >
        <Suspense fallback={null}>
          <ThreadPrimitive.Messages components={MESSAGE_COMPONENTS} />
        </Suspense>
        {footer}
      </div>
    </ThreadPrimitive.Root>
  );
}
