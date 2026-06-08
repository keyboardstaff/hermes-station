import {
  ThreadPrimitive,
  MessagePrimitive,
  useAuiState,
  type ToolCallMessagePartProps,
} from "@assistant-ui/react";
import ToolCallCard from "../ToolCallCard";
import {
  MarkdownText, ReasoningBlock, ApprovalNotice, StreamingActivity,
  UserMessageContent, MessageActions,
} from "../render";
import { useToolViewStore } from "@/store/app";
import { APPROVAL_NOTICE_TOOL } from "@/lib/chat-runtime";
import type { ChatMessage, ToolCall } from "@/lib/hermes-types";

/** Pull the Station ChatMessage that rode along on the assistant-ui message. */
function useHms(): ChatMessage | undefined {
  return useAuiState(
    (s) => (s.message.metadata?.custom as { hms?: ChatMessage } | undefined)?.hms,
  );
}

// ---- Native content-part components (stable module-level identity) ----------

function TextPart({ text }: { text: string }) {
  return text ? <MarkdownText content={text} /> : null;
}

/** Reasoning folds into Tool Call Display: only shown in Technical mode. */
function ReasoningPart({ text }: { text: string }) {
  const technical = useToolViewStore((s) => s.toolView === "technical");
  const streaming = useAuiState(
    (s) => (s.message.metadata?.custom as { hms?: ChatMessage } | undefined)?.hms?.streaming,
  );
  if (!technical || !text) return null;
  return <ReasoningBlock text={text} streaming={streaming} />;
}

function ToolPart({ args }: ToolCallMessagePartProps) {
  return <ToolCallCard tc={args as unknown as ToolCall} />;
}

function ApprovalPart({ args }: ToolCallMessagePartProps) {
  const { choice, command } = args as { choice?: string; command?: string };
  return <ApprovalNotice choice={choice ?? "once"} command={command ?? ""} />;
}

const PART_COMPONENTS = {
  Empty: () => null,
  Text: TextPart,
  Reasoning: ReasoningPart,
  tools: {
    by_name: { [APPROVAL_NOTICE_TOOL]: ApprovalPart },
    Fallback: ToolPart,
  },
} as const;

// ---- Message shell ----------------------------------------------------------

/** One transcript bubble. Mirrors ChatBubble's row/role/bubble structure (so the
 *  shared CSS + `data-msg-id` search-jump keep working) but renders the assistant
 *  body through assistant-ui's native parts pipeline. */
function HmsBubble() {
  const hms = useHms();
  if (!hms) return null;
  const isUser = hms.role === "user";
  return (
    <MessagePrimitive.Root asChild>
      <div className="hms-chat-bubble-row" data-role={isUser ? "user" : "assistant"} data-msg-id={hms.id}>
        <div className="hms-chat-bubble-role">{isUser ? "You" : "Assistant"}</div>

        <div className="hms-chat-bubble" data-role={isUser ? "user" : "assistant"}>
          {hms.agent ? (
            <span
              className={`hms-chat-bubble-agent-note hms-chat-bubble-agent-note--${isUser ? "user" : "assistant"}`}
            >
              {isUser ? `→ @${hms.agent}` : `@${hms.agent}`}
            </span>
          ) : null}

          {isUser ? (
            <UserMessageContent msg={hms} />
          ) : (
            <>
              <MessagePrimitive.Parts components={PART_COMPONENTS} />
              {hms.streaming && <StreamingActivity />}
            </>
          )}
        </div>

        {/* Visibility driven by CSS hover on .hms-chat-bubble-row. */}
        {!hms.streaming && <MessageActions msg={hms} />}
      </div>
    </MessagePrimitive.Root>
  );
}

const MESSAGE_COMPONENTS = { Message: HmsBubble } as const;

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
        <ThreadPrimitive.Messages components={MESSAGE_COMPONENTS} />
        {footer}
      </div>
    </ThreadPrimitive.Root>
  );
}
