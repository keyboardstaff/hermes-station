// useRunsStream — the chat run lifecycle orchestrator (POST /api/runs →
// WS subscribe → store reductions). The pure helpers live in run-events.ts;
// THIS exercises the wiring end-to-end against the real chat store, a stubbed
// WS store, and a routed fetch mock: send-body construction (truncate /
// regenerate semantics), the optimistic-bubble rules, and the
// delta → completed reduction path the UI depends on.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useRunsStream } from "@/hooks/useRunsStream";
import { useChatStore } from "@/store/chat";
import { useWSStore } from "@/store/ws";
import type { ChatMessage } from "@/lib/hermes-types";

type Handler = (msg: unknown) => void;
const wsHandlers = new Map<string, Handler>();

const fetchCalls: Array<{ url: string; body?: unknown }> = [];

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    json: async () => data,
  } as Response;
}

function installFetch() {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    fetchCalls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url === "/api/runs" && init?.method === "POST") {
      return jsonResponse({ run_id: "run-x", session_id: "run-x", status: "queued" }, 202);
    }
    if (url.includes("/transcript")) {
      return jsonResponse({ seq: 0, user_input: "", started_at: 1_750_000_000, partial: null });
    }
    if (url.includes("/messages")) {
      return jsonResponse({ messages: [], total: 0, offset: 0 });
    }
    return jsonResponse({ status: "running" });
  }));
}

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const user = (id: string): ChatMessage => ({ id, role: "user", content: id, createdAt: 0 });

beforeEach(() => {
  fetchCalls.length = 0;
  wsHandlers.clear();
  installFetch();
  useWSStore.setState({
    status: "open",
    connect: () => {},
    subscribe: () => {},
    unsubscribe: () => {},
    send: () => {},
    on: ((type: string, handler: Handler) => {
      wsHandlers.set(type, handler);
      return () => wsHandlers.delete(type);
    }) as never,
  });
  useChatStore.setState({
    messages: [],
    activeSessionId: null,
    activeRunId: null,
    activeTurnId: null,
    runningBySession: {},
    usageBySession: {},
    runStartedAt: {},
    pendingBranchGroup: null,
    selectedModel: null,
    selectedProvider: null,
    reasoningEffort: null,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendMessage", () => {
  it("posts the input, appends the optimistic user bubble, and attaches the run", async () => {
    const { result } = renderHook(() => useRunsStream(), { wrapper });
    await act(async () => { await result.current.sendMessage("hello there"); });

    const post = fetchCalls.find((c) => c.url === "/api/runs");
    expect(post?.body).toMatchObject({ input: "hello there" });
    const s = useChatStore.getState();
    expect(s.activeRunId).toBe("run-x");
    expect(s.runningBySession["run-x"]).toBe("run-x");
    expect(s.runStartedAt["run-x"]).toBeGreaterThan(0);
    // Optimistic bubble rebound to the turn-keyed id after the POST returned.
    expect(s.messages.some((m) => m.id === "turn-run-x-user" && m.content === "hello there")).toBe(true);
  });

  it("in-session regenerate: sends the truncate ordinal and reuses the kept user bubble", async () => {
    useChatStore.setState({
      activeSessionId: "sess-1",
      messages: [user("u0")],
      pendingBranchGroup: "g1",
    });
    const { result } = renderHook(() => useRunsStream(), { wrapper });
    await act(async () => {
      await result.current.sendMessage("u0", undefined, {
        truncateBeforeUserOrdinal: 0,
        reuseExistingUserBubble: true,
      });
    });

    const post = fetchCalls.find((c) => c.url === "/api/runs");
    expect(post?.body).toMatchObject({
      input: "u0",
      session_id: "sess-1",
      truncate_before_user_ordinal: 0,
    });
    const s = useChatStore.getState();
    // No duplicate optimistic bubble — supersedeTurn kept the original.
    expect(s.messages.filter((m) => m.role === "user")).toHaveLength(1);
    // The armed branch group survives so the re-run's answer joins it.
    expect(s.pendingBranchGroup).toBe("g1");
  });

  it("a normal send clears any stale branch group", async () => {
    useChatStore.setState({ activeSessionId: "sess-1", pendingBranchGroup: "stale" });
    const { result } = renderHook(() => useRunsStream(), { wrapper });
    await act(async () => { await result.current.sendMessage("fresh question"); });
    expect(useChatStore.getState().pendingBranchGroup).toBeNull();
  });
});

describe("run event reduction", () => {
  it("delta streams into the turn bubble; run.completed settles, stores usage and clears the run", async () => {
    const { result } = renderHook(() => useRunsStream(), { wrapper });
    await act(async () => { await result.current.sendMessage("question"); });

    const onRunEvent = wsHandlers.get("run.event");
    expect(onRunEvent).toBeDefined();

    act(() => {
      onRunEvent!({ type: "run.event", run_id: "run-x", event: "message.delta", delta: "partial ", seq: 1 });
      onRunEvent!({ type: "run.event", run_id: "run-x", event: "message.delta", delta: "answer", seq: 2 });
    });
    const live = useChatStore.getState().messages.find((m) => m.id === "turn-run-x-assistant");
    expect(live?.segments?.[0]).toEqual({ type: "text", content: "partial answer" });
    expect(live?.streaming).toBe(true);

    act(() => {
      onRunEvent!({
        type: "run.event", run_id: "run-x", event: "run.completed", seq: 3,
        output: "final answer", session_id: "run-x",
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      });
    });
    const s = useChatStore.getState();
    const settled = s.messages.find((m) => m.id === "turn-run-x-assistant");
    expect(settled?.streaming).toBe(false);
    expect(settled?.segments?.at(-1)).toEqual({ type: "text", content: "final answer" });
    expect(s.activeRunId).toBeNull();
    expect(s.runningBySession["run-x"]).toBeUndefined();
    expect(s.usageBySession["run-x"]).toEqual({ input_tokens: 10, output_tokens: 5, total_tokens: 15 });
  });

  it("drops replayed frames (seq dedup) so reconnects don't double text", async () => {
    const { result } = renderHook(() => useRunsStream(), { wrapper });
    await act(async () => { await result.current.sendMessage("q"); });
    const onRunEvent = wsHandlers.get("run.event")!;
    act(() => {
      onRunEvent({ type: "run.event", run_id: "run-x", event: "message.delta", delta: "once", seq: 1 });
      onRunEvent({ type: "run.event", run_id: "run-x", event: "message.delta", delta: "once", seq: 1 });
    });
    const live = useChatStore.getState().messages.find((m) => m.id === "turn-run-x-assistant");
    expect(live?.segments?.[0]).toEqual({ type: "text", content: "once" });
  });
});
