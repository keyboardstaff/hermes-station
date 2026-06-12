// WebSocket protocol types — kept in sync with server/ws.py + server/runs.py.

export type WSStatus = "connecting" | "open" | "closing" | "closed";

export type RunEventKind =
  | "message.delta"
  | "stream.reset"
  | "reasoning.available"
  | "tool.started"
  | "tool.completed"
  | "run.completed"
  | "run.failed"
  | "run.cancelled";

export interface RunEventMessage {
  type: "run.event";
  run_id: string;
  /** Present on terminal events (completed/failed/cancelled) — lets the client
   *  reconcile/clean up without racing a store read of activeSessionId. */
  session_id?: string;
  /** Monotonic per-run frame counter. Drives reconnect replay (client sends
   *  the highest seq it saw as last_seq) and client-side dedup of replayed frames. */
  seq?: number;
  event: RunEventKind;
  timestamp?: number;
  delta?: string;
  text?: string;
  tool?: string;
  /** Per-call UUID — disambiguates concurrent invocations of the same tool name. */
  tool_call_id?: string;
  preview?: string;
  duration?: number;
  error?: boolean | string;
  status?: string;
  output?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    cache_read_tokens?: number;
    cache_write_tokens?: number;
    context_length?: number;
    auto_compress_at?: number;
    auto_compress_percent?: number;
    context_used_tokens?: number;
  };
}

export interface ApprovalRequestedMessage {
  type: "approval.requested";
  run_id: string;
  session_key: string;
  command: string;
  description: string;
  pattern_key: string;
  pattern_keys?: string[];
}

export interface CapabilitiesMessage {
  type: "capabilities";
  fsReadable: boolean;
  dashboardReachable: boolean;
  agentReady: boolean;
  mode: "ready" | "degraded";
  reasons: string[];
}

export interface LogLineMessage {
  type: "log.line";
  channel: string;
  text: string;
}

export interface AckMessage {
  type: "run.stop.ack" | "approval.ack" | "ws.pong";
  [key: string]: unknown;
}

/** Discovery resource changed on the backend; SPA invalidates react-query cache.
 *  Resource is a kebab-case string (URL segment) so new resources need no FE type bump. */
export interface DiscoveryChangedMessage {
  type: "discovery.changed";
  resource: string;
  timestamp?: number;
}

export type ServerMessage =
  | RunEventMessage
  | ApprovalRequestedMessage
  | CapabilitiesMessage
  | LogLineMessage
  | DiscoveryChangedMessage
  | AckMessage
  | PlatformNoticeMessage;

export type ClientMessage =
  | { type: "ws.subscribe"; channel: string; last_seq?: number }
  | { type: "ws.unsubscribe"; channel: string }
  | { type: "ws.ping" }
  | { type: "run.stop"; run_id: string }
  | {
      type: "approval.resolve";
      session_key?: string;
      run_id?: string;
      choice: "once" | "session" | "always" | "deny";
    };

/** Gateway-pushed platform message (StationAdapter.send → session channel):
 *  progress heartbeats, self-improvement notices, cron auto-deliver, shutdown
 *  warnings — the auxiliary surface telegram-style platforms render inline. */
export interface PlatformNoticeMessage {
  type: "platform.notice";
  session_id: string;
  content: string;
  metadata: Record<string, unknown>;
  timestamp: number;
}
