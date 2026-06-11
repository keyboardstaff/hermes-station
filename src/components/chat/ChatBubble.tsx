import ToolCallCard from "./ToolCallCard";
import {
  MarkdownText, ReasoningBlock, ApprovalNotice, StreamingActivity,
  UserMessageContent, MessageActions,
} from "./render";
import { useToolViewStore } from "@/store/app";
import type { ChatMessage } from "@/lib/hermes-types";

/**
 * Read-only transcript bubble used by the /sessions preview drawer. The live
 * /chat transcript renders through the assistant-ui runtime (AssistantThread)
 * using the same leaf renderers from ./render, so the two surfaces stay in
 * sync. Branch / regenerate actions resolve to no-ops here because the previewed
 * message isn't in the active chat store (MessageActions hides them).
 */
export default function ChatBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === "user";
  // Reasoning visibility folds into Tool Call Display: Technical shows the
  // chain-of-thought (and raw tool payloads), Product hides both for a clean read.
  const technical = useToolViewStore((s) => s.toolView === "technical");

  // Legacy kind=approval_notice from before the segment refactor.
  if (msg.kind === "approval_notice") {
    return <ApprovalNotice choice={msg.approvalChoice ?? "once"} command={msg.approvalCommand ?? ""} />;
  }

  return (
    <div className="hms-chat-bubble-row" data-role={isUser ? "user" : "assistant"} data-msg-id={msg.id}>
      <div className="hms-chat-bubble-role">{isUser ? "You" : "Assistant"}</div>

      <div className="hms-chat-bubble" data-role={isUser ? "user" : "assistant"}>
        {isUser ? (
          <>
            {msg.agent ? (
              <span className="hms-chat-bubble-agent-note hms-chat-bubble-agent-note--user">
                → @{msg.agent}
              </span>
            ) : null}
            <UserMessageContent msg={msg} />
          </>
        ) : (
          /* Assistant: segments-based; content fallback for system notices. */
          <>
            {msg.agent ? (
              <span className="hms-chat-bubble-agent-note hms-chat-bubble-agent-note--assistant">
                @{msg.agent}
              </span>
            ) : null}
            {msg.segments && msg.segments.length > 0
              ? msg.segments.map((seg, i) =>
                  seg.type === "text"
                    ? (seg.content ? <MarkdownText key={i} content={seg.content} /> : null)
                    : seg.type === "reasoning"
                    ? (technical
                        ? <ReasoningBlock key={i} text={seg.content} streaming={msg.streaming} timerKey={`${msg.id}:${i}`} />
                        : null)
                    : seg.type === "approval_notice"
                    ? <ApprovalNotice key={i} choice={seg.choice} command={seg.command} />
                    : <ToolCallCard key={seg.tc.id} tc={seg.tc} />
                )
              : (msg.content && <MarkdownText content={msg.content} />)
            }
            {msg.streaming && <StreamingActivity />}
          </>
        )}
      </div>

      {/* Visibility driven by CSS hover on .hms-chat-bubble-row. */}
      {!msg.streaming && <MessageActions msg={msg} />}
    </div>
  );
}
