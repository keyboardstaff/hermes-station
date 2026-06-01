// Process-wide WebSocket singleton — reconnect with exponential backoff,
// per-type typed handlers, subscriptions replayed after disconnect.

import { create } from "zustand";
import type { ClientMessage, ServerMessage, WSStatus } from "@/lib/ws-types";

const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 16000];
const PING_INTERVAL_MS = 20_000;

type Handler<T = ServerMessage> = (msg: T) => void;

interface WSStore {
  status: WSStatus;
  attempt: number;
  lastMessage: ServerMessage | null;

  connect: () => void;
  disconnect: () => void;
  send: (msg: ClientMessage) => void;
  subscribe: (channel: string) => void;
  unsubscribe: (channel: string) => void;
  on: <T extends ServerMessage = ServerMessage>(type: T["type"], handler: Handler<T>) => () => void;
}

let socket: WebSocket | null = null;
let reconnectTimer: number | null = null;
let pingTimer: number | null = null;
let manuallyClosed = false;

// channel → highest run-frame seq seen on it. On reconnect we re-subscribe
// with this as last_seq so the server replays only the frames we missed.
const subscriptions = new Map<string, number>();
const handlers = new Map<string, Set<Handler<ServerMessage>>>();

function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

function clearTimers() {
  if (reconnectTimer !== null) { window.clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (pingTimer !== null)      { window.clearInterval(pingTimer);    pingTimer = null; }
}

function dispatch(msg: ServerMessage) {
  // Track the latest seq per run channel so a reconnect can ask for the gap.
  if (msg.type === "run.event") {
    const ev = msg as { run_id?: string; seq?: number };
    if (ev.run_id && typeof ev.seq === "number") {
      const ch = `run:${ev.run_id}`;
      const seen = subscriptions.get(ch);
      if (seen !== undefined && ev.seq > seen) subscriptions.set(ch, ev.seq);
    }
  }
  useWSStore.setState({ lastMessage: msg });
  const subs = handlers.get(msg.type);
  if (subs) {
    for (const h of subs) {
      try { h(msg); } catch (err) { console.error("[ws] handler threw:", err); }
    }
  }
}

function openSocket(state: WSStore) {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }
  manuallyClosed = false;
  useWSStore.setState({ status: "connecting" });

  const s = new WebSocket(wsUrl());
  socket = s;

  s.onopen = () => {
    useWSStore.setState({ status: "open", attempt: 0 });
    // Replay subscriptions with last_seq so the server resends frames missed
    // while the socket was down (server-side ring-buffer replay).
    for (const [ch, lastSeq] of subscriptions) {
      try {
        s.send(JSON.stringify({ type: "ws.subscribe", channel: ch, last_seq: lastSeq }));
      } catch { /* */ }
    }
    if (pingTimer !== null) window.clearInterval(pingTimer);
    pingTimer = window.setInterval(() => {
      if (s.readyState === WebSocket.OPEN) {
        try { s.send(JSON.stringify({ type: "ws.ping" })); } catch { /* */ }
      }
    }, PING_INTERVAL_MS);
  };

  s.onmessage = (ev) => {
    let parsed: ServerMessage;
    try { parsed = JSON.parse(ev.data); } catch { return; }
    if (parsed && typeof parsed === "object" && typeof (parsed as { type: unknown }).type === "string") {
      dispatch(parsed);
    }
  };

  s.onclose = () => {
    useWSStore.setState({ status: "closed" });
    socket = null;
    if (pingTimer !== null) { window.clearInterval(pingTimer); pingTimer = null; }
    if (manuallyClosed) return;
    const next = Math.min(state.attempt, RECONNECT_DELAYS_MS.length - 1);
    const delay = RECONNECT_DELAYS_MS[next];
    useWSStore.setState({ attempt: state.attempt + 1 });
    reconnectTimer = window.setTimeout(() => openSocket(useWSStore.getState()), delay);
  };

  s.onerror = () => {
    // close follows with the real reason — silent here avoids double-logging.
  };
}

export const useWSStore = create<WSStore>((set, get) => ({
  status: "closed",
  attempt: 0,
  lastMessage: null,

  connect: () => openSocket(get()),

  disconnect: () => {
    manuallyClosed = true;
    clearTimers();
    if (socket) {
      try { socket.close(); } catch { /* */ }
      socket = null;
    }
    set({ status: "closed", attempt: 0 });
  },

  send: (msg: ClientMessage) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      // Only subscribe survives disconnect (handled separately below).
      return;
    }
    try { socket.send(JSON.stringify(msg)); } catch { /* */ }
  },

  subscribe: (channel: string) => {
    // Preserve any seq already seen (re-subscribe after a transient drop);
    // default 0 for a fresh channel.
    const lastSeq = subscriptions.get(channel) ?? 0;
    subscriptions.set(channel, lastSeq);
    if (socket?.readyState === WebSocket.OPEN) {
      try { socket.send(JSON.stringify({ type: "ws.subscribe", channel, last_seq: lastSeq })); } catch { /* */ }
    }
  },

  unsubscribe: (channel: string) => {
    subscriptions.delete(channel);
    if (socket?.readyState === WebSocket.OPEN) {
      try { socket.send(JSON.stringify({ type: "ws.unsubscribe", channel })); } catch { /* */ }
    }
  },

  on: <T extends ServerMessage = ServerMessage>(type: T["type"], handler: Handler<T>) => {
    const set = handlers.get(type) ?? new Set<Handler<ServerMessage>>();
    handlers.set(type, set);
    set.add(handler as Handler<ServerMessage>);
    return () => { set.delete(handler as Handler<ServerMessage>); };
  },
}));
