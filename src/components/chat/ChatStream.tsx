import { useEffect, useRef, useState, useCallback } from "react";
import AssistantThread from "./assistant-ui/AssistantThread";
import { Loader2, ArrowDown } from "lucide-react";
import type { ChatMessage } from "@/lib/hermes-types";
import { useChatStore } from "@/store/chat";
import { useI18n } from "@/i18n";
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
    setUserScrolledUp(!isNearBottom());
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

  const scrollToBottom = () => {
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
    <div
      className={containerClassName}
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {showLoading ? (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--hms-text-muted)",
            fontSize: 'var(--hms-text-body)',
            gap: 'var(--hms-space-2)',
          }}
        >
          <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} />
          Loading…
        </div>
      ) : showEmpty ? (
        <ChatIntro />
      ) : (
        <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
          <AssistantThread
            scrollRef={scrollContainerRef}
            onScroll={handleScroll}
            footer={<div ref={bottomRef} />}
            style={{
              height: "100%",
              paddingTop: 16,
              paddingBottom: 16,
              paddingLeft: "max(20px, calc((100% - var(--hms-content-max-w)) / 2 + 20px))",
              paddingRight: "max(20px, calc((100% - var(--hms-content-max-w)) / 2 + 20px))",
              gap: 'var(--hms-space-2)',
            }}
          />

          {/* Scroll-to-bottom button — fades in/out via CSS transition */}
          <button
            onClick={scrollToBottom}
            title="Scroll to bottom"
            style={{
              position: "absolute",
              bottom: 12,
              left: "50%",
              width: 32,
              height: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "50%",
              border: "1px solid var(--hms-border)",
              background: "var(--hms-surface)",
              color: "var(--hms-text-muted)",
              cursor: userScrolledUp ? "pointer" : "default",
              boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
              // Smooth appear / disappear
              opacity: userScrolledUp ? 0.72 : 0,
              transform: userScrolledUp ? "translateX(-50%) scale(1)" : "translateX(-50%) scale(0.9)",
              pointerEvents: userScrolledUp ? "auto" : "none",
              transition: "opacity 0.18s ease, transform 0.18s ease",
            }}
          >
            <ArrowDown size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

// /chat empty state — the Hermes mark + a short intro (the logo's home now
// that the sidebar header is a search box).
function ChatIntro() {
  const { t } = useI18n();
  return (
    <div className="hms-chat-intro">
      <HermesMark size={44} />
      <div className="hms-chat-intro-headline">{t.composer.introHeadline}</div>
      <div className="hms-chat-intro-body">{t.composer.introBody}</div>
    </div>
  );
}
