import { useEffect, useRef, useState, useCallback } from "react";
import { ChatThread, type ChatThreadLabels } from "./ChatThread";
import { Loader2, ArrowDown } from "lucide-react";
import type { ChatMessage } from "@/lib/hermes-types";

interface ChatStreamProps {
  messages: ChatMessage[];
  isLoadingHistory?: boolean;
  isTransitioningOut?: boolean;
}

// ChatStream owns its own full-height loading / empty / transition states
// (with spinner + session-switch animations); these labels are passed to
// ChatThread only for completeness — the bubble-present branch is the one
// ChatStream delegates.
const THREAD_LABELS: ChatThreadLabels = {
  loading: "Loading…",
  empty: "Start a conversation…",
  error: "Could not load messages",
};

export default function ChatStream({ messages, isLoadingHistory, isTransitioningOut }: ChatStreamProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);

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
    const isStreaming = messages.some((m) => m.streaming);
    bottomRef.current?.scrollIntoView({
      behavior: isStreaming ? "auto" : "smooth",
    });
  }, [messages, userScrolledUp]);

  const scrollToBottom = () => {
    setUserScrolledUp(false);
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  };

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
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--hms-text-muted)",
            fontSize: 'var(--hms-text-body)',
          }}
        >
          Start a conversation…
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
          <ChatThread
            messages={messages}
            labels={THREAD_LABELS}
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
