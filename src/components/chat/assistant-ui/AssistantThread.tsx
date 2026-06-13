import {
  ThreadPrimitive,
  MessagePrimitive,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ActionBarPrimitive,
  useAuiState,
  type ToolCallMessagePartProps,
} from "@assistant-ui/react";
import { ChevronLeft, ChevronRight, Pencil } from "lucide-react";
import { useI18n } from "@/i18n";
import ToolCallCard from "../ToolCallCard";
import {
  MarkdownText, ReasoningBlock, ApprovalNotice, PlatformNotice, StreamingActivity,
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
  const messageId = useAuiState((s) => s.message.id);
  const streaming = useAuiState(
    (s) => (s.message.metadata?.custom as { hms?: ChatMessage } | undefined)?.hms?.streaming,
  );
  if (!technical || !text) return null;
  return <ReasoningBlock text={text} streaming={streaming} timerKey={messageId} />;
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

/** Native inline edit composer — replaces a user bubble while editing. Send
 *  routes through the runtime's onEdit (in-session truncate + re-run); Cancel
 *  restores the bubble. The textarea initializes with the message text. */
function UserEditComposer() {
  const { t } = useI18n();
  return (
    <ComposerPrimitive.Root className="hms-edit-composer">
      <ComposerPrimitive.Input className="hms-edit-composer-input" />
      <div className="hms-edit-composer-actions">
        <ComposerPrimitive.Cancel className="hms-edit-composer-btn">
          {t.common.cancel}
        </ComposerPrimitive.Cancel>
        <ComposerPrimitive.Send className="hms-edit-composer-btn" data-variant="primary">
          {t.composer.send}
        </ComposerPrimitive.Send>
      </div>
    </ComposerPrimitive.Root>
  );
}

/** 1/2 branch navigation under a regenerated answer. The runtime drives it
 *  (switching calls back through setMessages → applyBranchVisibility); it
 *  renders nothing while the message has a single branch. */
function BranchPicker() {
  return (
    <BranchPickerPrimitive.Root hideWhenSingleBranch className="hms-branch-picker">
      <BranchPickerPrimitive.Previous className="hms-branch-picker-btn">
        <ChevronLeft size={12} />
      </BranchPickerPrimitive.Previous>
      <span className="hms-branch-picker-pos">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next className="hms-branch-picker-btn">
        <ChevronRight size={12} />
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
}

// ---- Message shell ----------------------------------------------------------

/** One transcript bubble. Mirrors ChatBubble's row/role/bubble structure (so the
 *  shared CSS + `data-msg-id` search-jump keep working) but renders the assistant
 *  body through assistant-ui's native parts pipeline. */
function HmsBubble() {
  const hms = useHms();
  if (!hms) return null;
  if (hms.kind === "platform_notice") {
    return <PlatformNotice content={hms.content} />;
  }
  const isUser = hms.role === "user";
  return (
    <MessagePrimitive.Root asChild>
      <div className="hms-chat-bubble-row" data-role={isUser ? "user" : "assistant"} data-msg-id={hms.id}>
        {!isUser && <div className="hms-chat-bubble-role">Assistant</div>}

        <div className="hms-chat-bubble" data-role={isUser ? "user" : "assistant"}>
          {isUser ? (
            <UserMessageContent msg={hms} />
          ) : (
            <>
              <MessagePrimitive.Parts components={PART_COMPONENTS} />
              {hms.streaming && <StreamingActivity />}
            </>
          )}
        </div>

        {!isUser && <BranchPicker />}

        {/* Visibility driven by CSS hover on .hms-chat-bubble-row. */}
        {!hms.streaming && (
          <MessageActions
            msg={hms}
            editSlot={
              isUser ? (
                <ActionBarPrimitive.Edit asChild>
                  <button title="Edit & resend" className="hms-chat-bubble-action hms-chat-bubble-action--edit">
                    <Pencil size={12} />
                  </button>
                </ActionBarPrimitive.Edit>
              ) : undefined
            }
          />
        )}
      </div>
    </MessagePrimitive.Root>
  );
}

const MESSAGE_COMPONENTS = { Message: HmsBubble, UserEditComposer } as const;

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
