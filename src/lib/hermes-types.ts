// Hermes Runs API types (upstream: gateway/platforms/api_server.py)

export interface ComposerAttachment {
  id: string;
  name: string;
  mimeType: string;
  /** /api/upload/<id>/<name> returned by POST /api/upload. */
  content: string;
  isImage: boolean;
  isAudio?: boolean;
  isVideo?: boolean;
}

// OpenAI-compatible multimodal content parts.
export interface TextContentPart {
  type: "text";
  text: string;
}
export interface ImageContentPart {
  type: "image_url";
  image_url: { url: string };
}
export type ContentPart = TextContentPart | ImageContentPart;

export interface RunInput {
  input: string | ContentPart[];
  session_id?: string;
  model?: string;
  /** Required when selected model lives on a different provider than config default. */
  provider?: string;
  reasoning_effort?: string;
  /** Profile to run under. Re-scopes the in-process run to
   *  that profile's HERMES_HOME without a gateway restart. Omitted = default. */
  profile?: string;
  /** Prior turns seeding a fresh run's context (agents room: each member's
   *  turn sees the room's earlier replies). Shape matches upstream
   *  `get_messages_as_conversation`. */
  conversation_history?: Array<{ role: string; content: string }>;
  /** In-session regenerate / edit: truncate the persisted transcript before the
   *  Nth (0-based) user turn, then re-run from there. Requires `session_id`. */
  truncate_before_user_ordinal?: number;
  metadata?: Record<string, unknown>;
}

// Run lifecycle — status vocabulary and streaming events — is defined by the
// WebSocket frame contract in ws-types.ts (RunEventMessage / RunEventKind),
// NOT here. Station has no SSE endpoint; the earlier `GET /v1/runs/{id}/events`
// types and a `RunCreated` status union ("pending"/"stopped") that never
// occurred were dead code and have been removed.

export interface ToolCall {
  id: string;
  toolName: string;
  preview?: string;
  duration?: number;
  status: "running" | "done" | "error" | "approval_required" | "cancelled" | "timeout";
  /** Raw tool result JSON from DB role:tool message content. */
  result?: string;
}

/** Fallback path from tools/approval.py:1198 — returned to the LLM when no notify cb is registered. */
export interface ApprovalPayload {
  toolCallId: string;
  command: string;
  description: string;
  patternKey: string;
}

/** sessionId scopes the drawer so switching tabs hides the prompt instead of leaking it. */
export interface PendingApproval {
  payload: ApprovalPayload;
  sessionId: string;
}

export type MessageSegment =
  | { type: "text"; content: string }
  | { type: "tool"; tc: ToolCall }
  /** Thinking trace, interleaved in stream order (desktop-style) — streamed
   *  live via reasoning.available and restored from the DB rows' reasoning
   *  fields on history rebuild. */
  | { type: "reasoning"; content: string }
  | { type: "approval_notice"; choice: string; command: string };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  /** User text / assistant concatenated text for copy. Kept for back-compat. */
  content: string;
  attachments?: Array<{ name: string; content: string; isImage: boolean; isAudio?: boolean; isVideo?: boolean }>;
  /** When present, ChatBubble renders these in order instead of content/toolCalls. */
  segments?: MessageSegment[];
  /** @deprecated Use segments. */
  toolCalls?: ToolCall[];
  /** Synthesized non-user message (approval follow-up / gateway platform
   *  notice) rendered as a slim system notice instead of a bubble. */
  kind?: "approval_notice" | "platform_notice";
  approvalCommand?: string;
  approvalChoice?: string;
  /** Agents room: the profile-agent this turn was routed to (@mention). */
  agent?: string;
  /** In-memory branch grouping: assistant answers regenerated from the same user
   *  turn share a `branchGroupId` so the runtime presents them as branches
   *  (BranchPicker 1/2). Not persisted — a superseded answer survives only for
   *  the session view, like upstream desktop. */
  branchGroupId?: string;
  /** A superseded branch alternative — kept in the store (for the BranchPicker)
   *  but off the active path. Toggled when the user switches branches. */
  hidden?: boolean;
  createdAt: number;
  streaming?: boolean;
}

export interface SessionSummary {
  session_id: string;
  title?: string;
  source?: string;
  /** Which profile's state.db this session was read from (default / a named profile). */
  profile?: string;
  model?: string;
  /** The session's working directory (resolves relative file artifacts). */
  cwd?: string;
  input_tokens?: number;
  output_tokens?: number;
  started_at?: number;
  /** Last activity (upstream field). The `/api/sessions` rows carry this, not
   *  `updated_at` — use it for recency ordering / "most recent" selection. */
  last_active?: number;
  updated_at?: number;
}
