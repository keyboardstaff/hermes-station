import { useEffect, useRef, useState, useCallback } from "react";
import AssistantThread from "./assistant-ui/AssistantThread";
import { Loader2, ArrowDown } from "lucide-react";
import type { ChatMessage } from "@/lib/hermes-types";
import { useChatStore } from "@/store/chat";
import HermesMark from "@/components/ui/HermesMark";

interface ChatStreamProps {
  messages: ChatMessage[];
  isLoadingHistory?: boolean;
  isTransitioningOut?: boolean;
}

// ChatStream owns its own full-height loading / empty / transition states (with
// spinner + session-switch animations); the bubble-present branch delegates to
// AssistantThread (assistant-ui runtime) for the transcript itself.

export default function ChatStream({ messages, isLoadingHistory, isTransitioningOut }: ChatStreamProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const pendingScrollMessageId = useChatStore((s) => s.pendingScrollMessageId);
  const setPendingScrollMessageId = useChatStore((s) => s.setPendingScrollMessageId);

  const isNearBottom = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  const handleScroll = useCallback(() => {
    const near = isNearBottom();
    setUserScrolledUp(!near);
    if (near) scrollStageRef.current = 0;
  }, [isNearBottom]);

  // Reset when a new history load begins (session switch).
  useEffect(() => {
    if (isLoadingHistory) setUserScrolledUp(false);
  }, [isLoadingHistory]);

  // Auto-scroll on new messages — skipped if user has scrolled up.
  //
  // During streaming, every token chunk would trigger a fresh smooth-scroll
  // animation and the browser ends up queueing 60+ overlapping animations
  // — visible as judder. Use behavior:"auto" (instant jump) while any
  // assistant message is still streaming, and only "smooth" once everything
  // has landed, so the final scroll-to-end is the pleasant one.
  useEffect(() => {
    if (userScrolledUp) return;
    if (pendingScrollMessageId != null) return; // a search jump is pending — don't fight it
    const isStreaming = messages.some((m) => m.streaming);
    bottomRef.current?.scrollIntoView({
      behavior: isStreaming ? "auto" : "smooth",
    });
  }, [messages, userScrolledUp, pendingScrollMessageId]);

  // Two-stage scroll: the first click jumps to the LAST turn's user message
  // (top of the latest exchange); a second click goes to the very bottom.
  // The stage resets whenever the view returns near the bottom.
  const scrollStageRef = useRef(0);
  const scrollToBottom = () => {
    const container = scrollContainerRef.current;
    if (scrollStageRef.current === 0 && container) {
      const users = container.querySelectorAll<HTMLElement>(
        '.hms-chat-bubble-row[data-role="user"]',
      );
      const lastUser = users.length > 0 ? users[users.length - 1] : null;
      if (lastUser) {
        const cTop = container.getBoundingClientRect().top;
        const uTop = lastUser.getBoundingClientRect().top;
        // Only worth a first stage when the latest turn starts below the
        // current viewport area; otherwise fall through to the bottom.
        if (uTop - cTop > container.clientHeight * 0.6) {
          setUserScrolledUp(true); // hold — don't let auto-scroll fight the anchor
          lastUser.scrollIntoView({ behavior: "smooth", block: "start" });
          scrollStageRef.current = 1;
          return;
        }
      }
    }
    scrollStageRef.current = 0;
    setUserScrolledUp(false);
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Search → jump to a specific message. ChatMessages carry a `data-msg-id` of
  // `hist-<rowId>` (user) or `hist-run-<firstRowId>` (an assistant run groups
  // several DB rows). The search hit's message_id may be ANY row id inside a
  // run, so we scroll to the message whose numeric id is the largest one ≤ the
  // hit — i.e. the message that contains (or immediately precedes) it. Retries
  // briefly while the session history is still loading into the DOM.
  useEffect(() => {
    if (pendingScrollMessageId == null) return;
    const id = pendingScrollMessageId;
    let tries = 0;
    let timer = 0;
    const attempt = () => {
      const container = scrollContainerRef.current;
      const nodes = container ? container.querySelectorAll<HTMLElement>("[data-msg-id^='hist']") : [];
      let best: HTMLElement | null = null;
      let bestNum = -1;
      nodes.forEach((el) => {
        const m = el.getAttribute("data-msg-id")?.match(/(\d+)$/);
        if (!m) return;
        const num = Number(m[1]);
        if (num <= id && num > bestNum) {
          bestNum = num;
          best = el;
        }
      });
      // Fall back to the earliest message when the hit predates everything loaded.
      if (!best && nodes.length > 0) best = nodes[0];
      if (best) {
        const el: HTMLElement = best;
        setUserScrolledUp(true); // hold position — don't let auto-scroll-to-bottom override
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("hms-msg-flash");
        window.setTimeout(() => el.classList.remove("hms-msg-flash"), 1600);
        setPendingScrollMessageId(null);
        return;
      }
      if (tries++ < 30) timer = window.setTimeout(attempt, 120);
      else setPendingScrollMessageId(null);
    };
    attempt();
    return () => window.clearTimeout(timer);
  }, [pendingScrollMessageId, messages, setPendingScrollMessageId]);

  const showLoading = Boolean(isLoadingHistory) || isTransitioningOut;
  const showEmpty = !showLoading && messages.length === 0;
  
  // Determine animation class based on transition state
  let containerClassName = "animate-contentUp";
  if (isTransitioningOut) {
    containerClassName = "animate-sessionFadeOut";
  } else if (!showLoading && messages.length > 0) {
    containerClassName = "animate-sessionFadeIn";
  }

  return (
    <div className={`hms-chat-stream ${containerClassName}`}>
      {showLoading ? (
        <div className="hms-chat-stream-loading">
          <Loader2 size={16} className="hms-tool-spin-icon" />
          Loading…
        </div>
      ) : showEmpty ? (
        <ChatIntro />
      ) : (
        <div className="hms-chat-stream-body">
          <AssistantThread
            scrollRef={scrollContainerRef}
            onScroll={handleScroll}
            footer={<div ref={bottomRef} />}
            style={{
              height: "100%",
              paddingTop: 16,
              paddingBottom: 16,
              paddingLeft: "max(20px, calc((100% - var(--hms-chat-max-w)) / 2 + 20px))",
              paddingRight: "max(20px, calc((100% - var(--hms-chat-max-w)) / 2 + 20px))",
              gap: 'var(--hms-space-2)',
            }}
          />

          {/* Scroll-to-bottom button — fades in/out via CSS transition */}
          <button
            onClick={scrollToBottom}
            title="Scroll to bottom"
            className="hms-chat-scroll-btn"
            data-visible={userScrolledUp ? "true" : undefined}
          >
            <ArrowDown size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

// /chat empty state — the Hermes mark + wordmark (the brand's home now that
// the sidebar header is a search box).
function ChatIntro() {
  return (
    <div className="hms-chat-intro">
      <HermesMark size={108} />
      <div className="hms-chat-intro-title">Hermes Station</div>
    </div>
  );
}
