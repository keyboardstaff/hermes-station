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
  /** Prior turns to seed a *branched* run (edit / regenerate / branch-from-a-
   *  message). The run starts a fresh session, but the agent sees these as its
   *  context. Shape matches upstream `get_messages_as_conversation`. */
  conversation_history?: Array<{ role: string; content: string }>;
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
  /** reasoning.available trace; not persisted, only populated during the live session. */
  reasoning?: string;
  /** Synthesized non-user message (e.g. approval follow-up rendered as system notice). */
  kind?: "approval_notice";
  approvalCommand?: string;
  approvalChoice?: string;
  /** Agents room: the profile-agent this turn was routed to (@mention). */
  agent?: string;
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
  input_tokens?: number;
  output_tokens?: number;
  started_at?: number;
  updated_at?: number;
}
