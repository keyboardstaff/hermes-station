// Client-side WSStore reconnect contract: on GOING_AWAY the SPA must
// reconnect with exponential backoff and replay subscriptions on the fresh socket.
// Server-side counterpart: tests/unit/test_ws_reconnect.py.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

class MockSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static instances: MockSocket[] = [];
  readyState: number = MockSocket.CONNECTING;
  sent: string[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3; // CLOSED
    this.onclose?.();
  }

  simulateOpen(): void {
    this.readyState = MockSocket.OPEN;
    this.onopen?.();
  }

  simulateServerClose(): void {
    this.readyState = 3;
    this.onclose?.();
  }
}

beforeEach(() => {
  MockSocket.instances = [];
  // @ts-expect-error — overriding the global WebSocket for the test
  globalThis.WebSocket = MockSocket;
  // Reset module state by re-importing — Zustand store keeps refs to
  // module-level ``socket`` / ``subscriptions`` between tests otherwise.
  vi.resetModules();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("WSStore reconnect", () => {
  it("replays subscriptions after server-initiated close", async () => {
    const { useWSStore } = await import("@/store/ws");
    const store = useWSStore.getState();

    store.connect();
    expect(MockSocket.instances).toHaveLength(1);
    const first = MockSocket.instances[0];
    first.simulateOpen();
    expect(useWSStore.getState().status).toBe("open");

    store.subscribe("run:abc");
    store.subscribe("approval");
    const subscribeFrames = first.sent.filter((s) => JSON.parse(s).type === "ws.subscribe");
    expect(subscribeFrames).toHaveLength(2);

    first.simulateServerClose();
    expect(useWSStore.getState().status).toBe("closed");

    // First backoff slot = 500ms.
    vi.advanceTimersByTime(600);
    expect(MockSocket.instances).toHaveLength(2);
    const second = MockSocket.instances[1];
    second.simulateOpen();

    const replayed = second.sent
      .map((s) => JSON.parse(s))
      .filter((m) => m.type === "ws.subscribe")
      .map((m) => m.channel)
      .sort();
    expect(replayed).toEqual(["approval", "run:abc"]);
    expect(useWSStore.getState().status).toBe("open");
    expect(useWSStore.getState().attempt).toBe(0);
  });

  it("does NOT reconnect after a manual disconnect", async () => {
    const { useWSStore } = await import("@/store/ws");
    const store = useWSStore.getState();

    store.connect();
    MockSocket.instances[0].simulateOpen();
    store.disconnect();

    // No reconnect even after the longest backoff — disconnect() is intentional.
    vi.advanceTimersByTime(20_000);
    expect(MockSocket.instances).toHaveLength(1);
    expect(useWSStore.getState().status).toBe("closed");
  });

  it("uses exponential backoff across repeated failures", async () => {
    const { useWSStore } = await import("@/store/ws");
    const store = useWSStore.getState();
    store.connect();

    MockSocket.instances[0].simulateServerClose();
    vi.advanceTimersByTime(499);
    expect(MockSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(MockSocket.instances).toHaveLength(2);

    // Next slot = 1000ms.
    MockSocket.instances[1].simulateServerClose();
    vi.advanceTimersByTime(999);
    expect(MockSocket.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(MockSocket.instances).toHaveLength(3);
  });
});
