import { useState, useRef, useCallback, useMemo, useEffect, forwardRef, useImperativeHandle } from "react";
import { useQuery } from "@tanstack/react-query";
import { Paperclip, Mic, Send, Square, User, Settings as SettingsIcon } from "lucide-react";
import SlashMenu from "./SlashMenu";
import type { SlashCommand } from "@/lib/slash-commands";
import { useDiscoverSlashCommands } from "@/store/discovery";
import { useChatStore } from "@/store/chat";
import { useCapabilityStore } from "@/store/capabilities";
import { useProfiles, useActiveProfile } from "@/hooks/useProfiles";
import { useActiveSessionProfile } from "@/hooks/useActiveSessionProfile";
import { useProfileScope, effectiveScopeName, ALL_PROFILES } from "@/store/profile-scope";
import { useI18n } from "@/i18n";
import type { ComposerAttachment } from "@/lib/hermes-types";
import type { ProviderInfo } from "@/hooks/useProviders";
import { ContextMeter, estimateTokenCount } from "./composer/ContextMeter";
import { ModelPicker } from "./composer/ModelPicker";
import { PillSelect, ToolbarBtn, sendStyle } from "./composer/parts";
import { AttachmentChips } from "./composer/AttachmentChips";
import QueuePanel from "./composer/QueuePanel";
import { useVoiceInput } from "./composer/useVoiceInput";
import { useComposerAttachments } from "./composer/useComposerAttachments";
import { useOverlays } from "@/store/overlays";
import {
  useComposerQueue, queuedPromptsFor, shouldAutoDrainOnSettle, type QueuedPromptEntry,
} from "@/store/composer-queue";
import { highlightComposerTokens, composerCurrentToken, type ComposerToken } from "@/lib/composer-tokens";

interface ComposerProps {
  onSend: (text: string, attachments?: ComposerAttachment[]) => void | Promise<unknown>;
  onStop: () => void;
  disabled?: boolean;
  /** Forwarded to upload API so images can be recovered after refresh. */
  sessionId?: string | null;
  /** Override the running state (the /agents room tracks its own run, not the
   *  chat store's activeRunId). Defaults to the chat store's activeRunId. */
  running?: boolean;
  /** When set (the /agents room), a leading `@partial` autocompletes these
   *  member names; they also get syntax-highlighted in the input. */
  mentionNames?: string[];
}

export interface ComposerHandle {
  addFiles: (files: File[]) => void;
}

const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  { onSend, onStop, disabled, sessionId, running, mentionNames }: ComposerProps,
  ref,
) {
  const [value, setValue] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  // The `/command` / `@mention` token the cursor is in (autocomplete anywhere).
  const [token, setToken] = useState<ComposerToken | null>(null);

  const { caps } = useCapabilityStore();
  const { t } = useI18n();
  const openProfile = useOverlays((s) => s.openProfile);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeRunId = useChatStore((s) => s.activeRunId);
  const {
    selectedModel, setSelectedModel,
    selectedProvider, setSelectedProvider,
    reasoningEffort: reasoning, setReasoningEffort: setReasoning,
  } = useChatStore();
  // Per-session cumulative usage (persisted) → the ring survives refresh.
  const sessionUsage = useChatStore((s) =>
    sessionId ? s.usageBySession[sessionId] ?? null : null,
  );
  const isRunning = running ?? !!activeRunId;

  // Attachment state + every ingest path (picker / paste / drag / imperative).
  // All files uploaded via POST /api/upload (persisted across refreshes); cap from caps.limits.
  const HARD_MAX_BYTES = caps?.limits?.max_upload_bytes ?? 50 * 1024 * 1024;
  const {
    attachments, uploadError, setUploadError, dragOver,
    ingestFiles, onFileChange, onPaste, onDragOver, onDragLeave, onDrop,
    removeAttachment, clear: clearAttachments,
  } = useComposerAttachments({ sessionId, maxBytes: HARD_MAX_BYTES, selectedModel });

  // Voice dictation appends recognised text to the textarea.
  const voice = useVoiceInput((transcript) =>
    setValue((v) => (v ? v.replace(/\s*$/, "") + " " : "") + transcript),
  );

  useImperativeHandle(ref, () => ({
    addFiles(files: File[]) { ingestFiles(files); },
  }), [ingestFiles]);

  // The profile pill is the view-scope picker (the "current profile"):
  // picking a profile scopes reads + runs to it (no sticky write, no restart),
  // unified with the sidebar scope selector. The sticky active is now only the
  // gateway's *background* home (managed in the Profile panel).
  const profilesQuery = useProfiles();
  const profileNames: string[] = useMemo(
    () => (profilesQuery.data?.profiles ?? []).map((p) => p.name),
    [profilesQuery.data],
  );
  const activeProfileQuery = useActiveProfile();
  const scope = useProfileScope((s) => s.scope);
  const setScope = useProfileScope((s) => s.setScope);
  const sessionProfile = useActiveSessionProfile();
  // The concrete profile in view: a chosen scope, else — while browsing "All
  // profiles" — the open session's own profile (so the pill shows which profile
  // this chat runs in), else the running profile.
  const activeProfileName = activeProfileQuery.data?.current ?? activeProfileQuery.data?.sticky ?? "default";
  const currentProfileName = scope === ALL_PROFILES
    ? (sessionProfile ?? activeProfileName)
    : (effectiveScopeName(scope, activeProfileName) ?? activeProfileName);
  const profileChoices = profileNames.length > 0 ? profileNames : [currentProfileName];
  const handleProfileChange = useCallback((next: string) => {
    if (next !== currentProfileName || scope === ALL_PROFILES) setScope(next);
  }, [currentProfileName, scope, setScope]);

  const { data: modelsResp } = useQuery<{
    models: string[];
    model_default: string | null;
    providers: ProviderInfo[];
  }>({
    queryKey: ["fs-models"],
    queryFn: () => fetch("/api/models").then((r) => r.ok ? r.json() : { models: [], model_default: null, providers: [] }),
    retry: false,
    staleTime: 60_000,
  });
  const models: string[] = modelsResp?.models ?? [];
  const modelDefault = modelsResp?.model_default ?? null;
  const providers: ProviderInfo[] = modelsResp?.providers ?? [];
  const firstModel = models[0] ?? null;

  // Context-window length (models.dev) for the active model → context ring.
  // The lookup needs a provider; fall back to the provider that lists this model.
  const ctxModel = selectedModel ?? modelDefault;
  const ctxProvider =
    selectedProvider ??
    providers.find((p) => Array.isArray(p.models) && ctxModel != null && p.models.includes(ctxModel))?.slug ??
    providers.find((p) => p.is_current)?.slug ??
    "";
  const { data: ctxResp } = useQuery<{ context_length: number | null }>({
    queryKey: ["model-context", ctxModel, ctxProvider],
    queryFn: () =>
      ctxModel
        ? fetch(`/api/models/context?model=${encodeURIComponent(ctxModel)}&provider=${encodeURIComponent(ctxProvider)}`)
            .then((r) => (r.ok ? r.json() : { context_length: null }))
        : Promise.resolve({ context_length: null }),
    enabled: !!ctxModel,
    staleTime: 5 * 60_000,
  });
  const contextLength = ctxResp?.context_length ?? null;

  // Pre-fill from an edit / branch handoff. Reactive (not mount-only), so it
  // also works when /chat is already open.
  const composerDraft = useChatStore((s) => s.composerDraft);
  useEffect(() => {
    if (composerDraft != null) {
      setValue(composerDraft);
      useChatStore.getState().setComposerDraft(null);
      requestAnimationFrame(() => textRef.current?.focus());
    }
  }, [composerDraft]);

  useEffect(() => {
    if (!selectedModel && (modelDefault || firstModel)) {
      setSelectedModel(modelDefault ?? firstModel);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelDefault, firstModel]);

  // Autocomplete keys off the token the cursor is in (anywhere, not just the
  // line start), so a second @mention or a mid-text /command also completes.
  const slashQuery = token?.kind === "slash" ? token.query : "";
  const mentionQuery = token?.kind === "mention" ? token.query.toLowerCase() : "";
  const { data: discoveredSlash } = useDiscoverSlashCommands();
  const filteredCmds = useMemo<SlashCommand[]>(() => {
    if (token?.kind !== "slash") return [];
    const all: SlashCommand[] = (discoveredSlash?.commands ?? []).map((c) => ({
      name: c.name,
      description: c.description,
    }));
    return all.filter((c) => c.name.startsWith(slashQuery));
  }, [discoveredSlash, slashQuery, token]);

  // @member autocomplete (the /agents room passes its roster as mentionNames).
  const filteredMentions = useMemo<SlashCommand[]>(() => {
    if (token?.kind !== "mention") return [];
    return (mentionNames ?? [])
      .filter((n) => n.toLowerCase().startsWith(mentionQuery))
      .map((n) => ({ name: n, description: "" }));
  }, [mentionNames, mentionQuery, token]);

  const showSlash = token?.kind === "slash" && filteredCmds.length > 0;
  const showMention = token?.kind === "mention" && filteredMentions.length > 0;

  // ── Composer queue (desktop parity) ────────────────────────────────
  // While a run streams, sends queue per session (persisted); the queue
  // auto-drains head-first whenever the session settles (finish OR interrupt).
  const queuesBySession = useComposerQueue((s) => s.queuesBySession);
  const enqueueQueued = useComposerQueue((s) => s.enqueue);
  const removeQueued = useComposerQueue((s) => s.remove);
  const promoteQueued = useComposerQueue((s) => s.promote);
  const updateQueuedText = useComposerQueue((s) => s.updateText);
  const queued = useMemo(
    () => queuedPromptsFor(queuesBySession, sessionId),
    [queuesBySession, sessionId],
  );
  const [queueEditId, setQueueEditId] = useState<string | null>(null);
  const queueEditIdRef = useRef(queueEditId);
  queueEditIdRef.current = queueEditId;
  const drainingRef = useRef(false);
  const prevBusyRef = useRef(isRunning);

  // Session switch / entry deleted while editing → drop the edit flag (the
  // composer keeps whatever text is in it).
  useEffect(() => { setQueueEditId(null); }, [sessionId]);
  useEffect(() => {
    if (queueEditId && !queued.some((e) => e.id === queueEditId)) setQueueEditId(null);
  }, [queued, queueEditId]);

  const clearComposer = useCallback(() => {
    setValue("");
    clearAttachments();
    setToken(null);
    setSlashIndex(0);
  }, [clearAttachments]);

  // One shared send-then-remove drain path (head or by-id); a lock keeps the
  // settle effect, Enter-drain and Send-now from double-sending.
  const drainNext = useCallback(async (pickId?: string) => {
    if (drainingRef.current || !sessionId) return;
    const list = queuedPromptsFor(useComposerQueue.getState().queuesBySession, sessionId);
    const entry = pickId
      ? list.find((e) => e.id === pickId)
      : list.find((e) => e.id !== queueEditIdRef.current);
    if (!entry) return;
    drainingRef.current = true;
    try {
      await Promise.resolve(
        onSend(entry.text, entry.attachments.length > 0 ? entry.attachments : undefined),
      );
      removeQueued(sessionId, entry.id);
    } finally {
      drainingRef.current = false;
    }
  }, [sessionId, onSend, removeQueued]);

  // Auto-drain on busy → false (turn settled) — natural finish or interrupt.
  useEffect(() => {
    const wasBusy = prevBusyRef.current;
    prevBusyRef.current = isRunning;
    if (shouldAutoDrainOnSettle({ wasBusy, isBusy: isRunning, queueLength: queued.length })) {
      void drainNext();
    }
  }, [isRunning, queued.length, drainNext]);

  const sendQueuedNow = useCallback((id: string) => {
    if (id === queueEditIdRef.current) return;
    if (isRunning) {
      // Promote to the head, then interrupt — the settle auto-drain sends it.
      promoteQueued(sessionId, id);
      onStop();
      return;
    }
    void drainNext(id);
  }, [isRunning, promoteQueued, sessionId, onStop, drainNext]);

  const beginQueueEdit = useCallback((entry: QueuedPromptEntry) => {
    setQueueEditId(entry.id);
    setValue(entry.text);
    requestAnimationFrame(() => textRef.current?.focus());
  }, []);

  const send = useCallback(() => {
    const trimmed = value.trim();
    const hasPayload = !!trimmed || attachments.length > 0;
    if (disabled) return;

    // Saving a queued entry being edited — Enter writes it back in place.
    if (queueEditId) {
      if (trimmed) updateQueuedText(sessionId, queueEditId, trimmed);
      setQueueEditId(null);
      clearComposer();
      return;
    }

    if (isRunning) {
      // Busy: a payload queues instead of sending.
      if (hasPayload && sessionId) {
        enqueueQueued(sessionId, {
          text: trimmed,
          attachments: attachments.length > 0 ? attachments : undefined,
        });
        clearComposer();
      }
      return;
    }

    // Idle + empty composer + queued turns → Enter drains the next one.
    if (!hasPayload) {
      if (queued.length > 0) void drainNext();
      return;
    }

    onSend(trimmed, attachments.length > 0 ? attachments : undefined);
    clearComposer();
  }, [
    value, attachments, isRunning, disabled, onSend, clearComposer,
    queueEditId, updateQueuedText, sessionId, enqueueQueued, queued.length, drainNext,
  ]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // IME composition: React drops isComposing; nativeEvent has it (keyCode 229 fallback).
    const native = e.nativeEvent as KeyboardEvent;
    const composing = native.isComposing || native.keyCode === 229;
    if (showSlash) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((i) => Math.min(i + 1, filteredCmds.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" && !composing && filteredCmds[slashIndex]) {
        e.preventDefault();
        onSlashSelect(filteredCmds[slashIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setToken(null);
        return;
      }
    }
    if (showMention && filteredMentions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => Math.min(i + 1, filteredMentions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" && !composing && filteredMentions[mentionIndex]) {
        e.preventDefault();
        onMentionSelect(filteredMentions[mentionIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setToken(null);
        return;
      }
    }
    if (e.key === "Escape" && queueEditId) {
      // Cancel a queued-entry edit without saving.
      e.preventDefault();
      setQueueEditId(null);
      setValue("");
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !composing) {
      e.preventDefault();
      send();
    }
  };

  /** Recompute the cursor token (drives both autocomplete menus). */
  const syncToken = (v: string, cursor: number | null) => {
    const next = composerCurrentToken(v, cursor ?? v.length);
    setToken(next);
    if (next) { setSlashIndex(0); setMentionIndex(0); }
  };

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setValue(v);
    syncToken(v, e.target.selectionStart);
  };

  // Replace just the cursor's `/`/`@` token with the picked completion + a
  // trailing space (so multiple @mentions / mid-text completions work), then
  // restore the caret right after it.
  const replaceToken = (char: "/" | "@", name: string) => {
    const insert = char + name + " ";
    setValue((prev) => {
      if (!token) return insert;
      const before = prev.slice(0, token.start);
      const after = prev.slice(token.start + 1 + token.query.length);
      const caret = before.length + insert.length;
      requestAnimationFrame(() => {
        const el = textRef.current;
        if (el) { el.focus(); el.setSelectionRange(caret, caret); }
      });
      return before + insert + after;
    });
    setToken(null);
  };

  const onSlashSelect = (cmd: SlashCommand) => replaceToken("/", cmd.name);
  const onMentionSelect = (cmd: SlashCommand) => replaceToken("@", cmd.name);

  const autoResize = () => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  };

  return (
    <div
      style={{
        padding: "12px 16px 16px",
        flexShrink: 0,
        width: "100%",
        // Match ChatStream's reading column (slightly wider for the controls).
        maxWidth: "calc(var(--hms-chat-max-w) + 80px)",
        margin: "0 auto",
        boxSizing: "border-box",
      }}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,audio/*,video/*,text/*,.pdf,.epub,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.md,.json,.csv,.ts,.tsx,.js,.jsx,.py,.sh,.yaml,.yml,.toml,.txt,.svg,.xml,.ini,.env"
        style={{ display: "none" }}
        onChange={onFileChange}
      />

      {/* Queued prompts — collapsed count header above the input */}
      <QueuePanel
        busy={isRunning}
        editingId={queueEditId}
        entries={queued}
        onDelete={(id) => removeQueued(sessionId, id)}
        onEdit={beginQueueEdit}
        onSendNow={sendQueuedNow}
      />

      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        style={{
          position: "relative",
          borderRadius: 16,
          border: dragOver ? "2px solid var(--hms-accent)" : "1px solid var(--hms-border)",
          background: dragOver ? "color-mix(in srgb, var(--hms-accent) 6%, var(--hms-surface))" : "var(--hms-surface)",
          boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
          transition: "border-color 120ms, background 120ms",
        }}
      >
        {dragOver && (
          <div style={{
            position: "absolute", inset: 0, zIndex: 10,
            display: "flex", alignItems: "center", justifyContent: "center",
            borderRadius: 16,
            pointerEvents: "none",
            fontSize: 'var(--hms-text-sm)', color: "var(--hms-accent)", fontWeight: 500,
          }}>
            Drop files here
          </div>
        )}
        {/* Slash command menu */}
        {showSlash && (
          <div style={{ position: "relative" }}>
            <SlashMenu
              query={slashQuery}
              selectedIndex={slashIndex}
              onSelect={onSlashSelect}
              onClose={() => setToken(null)}
              commands={filteredCmds}
            />
          </div>
        )}
        {/* @member mention menu (the /agents room) */}
        {showMention && filteredMentions.length > 0 && (
          <div style={{ position: "relative" }}>
            <SlashMenu
              query={mentionQuery}
              selectedIndex={mentionIndex}
              onSelect={onMentionSelect}
              onClose={() => setToken(null)}
              commands={filteredMentions}
              prefix="@"
            />
          </div>
        )}

        {uploadError && (
          <div
            role="alert"
            style={{
              margin: "6px 12px 0",
              padding: "6px 10px",
              borderRadius: 6,
              background: "color-mix(in srgb, var(--hms-error, #dc2626) 12%, transparent)",
              border: "1px solid var(--hms-error, #dc2626)",
              color: "var(--hms-error, #dc2626)",
              fontSize: 'var(--hms-text-caption)',
            }}
            onClick={() => setUploadError(null)}
          >
            {uploadError}
          </div>
        )}

        {/* Attachment chips */}
        <AttachmentChips attachments={attachments} onRemove={removeAttachment} />

        {/* Text area + a syntax-highlight backdrop (mirrors the text behind a
            transparent textarea so /commands and @mentions are coloured). */}
        <div style={{ position: "relative" }}>
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              padding: "12px 14px 4px",
              fontSize: 'var(--hms-text-body)',
              lineHeight: 1.6,
              fontFamily: "inherit",
              whiteSpace: "pre-wrap",
              overflowWrap: "break-word",
              wordBreak: "break-word",
              color: "var(--hms-text)",
              pointerEvents: "none",
              overflow: "hidden",
              minHeight: 44,
              boxSizing: "border-box",
            }}
          >
            {highlightComposerTokens(value)}
          </div>
          <textarea
            ref={textRef}
            value={value}
            onChange={(e) => { onChange(e); autoResize(); }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder="Message… (/ for commands, Shift+Enter for newline)"
            disabled={disabled}
            rows={1}
            style={{
              position: "relative",
              width: "100%",
              resize: "none",
              border: "none",
              background: "transparent",
              padding: "12px 14px 4px",
              fontSize: 'var(--hms-text-body)',
              lineHeight: 1.6,
              // Transparent text reveals the highlighted backdrop while typing;
              // keep it opaque when empty so the placeholder stays visible.
              color: value ? "transparent" : "var(--hms-text)",
              caretColor: "var(--hms-text)",
              outline: "none",
              fontFamily: "inherit",
              boxSizing: "border-box",
              minHeight: 44,
            }}
          />
        </div>

        {/* Toolbar: [attach][voice] | [profile][model+thinking] | [~tok] | [■/▶] */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "6px 10px",
            gap: 'var(--hms-space-1)',
            flexWrap: "nowrap",
            overflow: "hidden",
          }}
        >
          {/* Attach */}
          <ToolbarBtn title="Attach file" onClick={() => fileInputRef.current?.click()}>
            <Paperclip size={16} />
          </ToolbarBtn>

          {/* Mic — Web Speech API */}
          <ToolbarBtn
            title={voice.supported ? (voice.listening ? "Stop listening" : "Voice input") : "Voice input not supported in this browser"}
            onClick={voice.toggle}
          >
            <Mic
              size={16}
              style={{
                color: voice.listening ? "var(--hms-error)" : "currentColor",
                animation: voice.listening ? "blink 1s infinite" : "none",
              }}
            />
          </ToolbarBtn>

          {/* Profile pill = the view-scope picker: scopes reads + runs to the
              chosen profile (no sticky write / restart), unified with the sidebar. */}
          <PillSelect
            icon={<User size={12} />}
            value={currentProfileName}
            options={profileChoices}
            onChange={handleProfileChange}
            footerAction={{ label: t.composer.manageProfiles, icon: <SettingsIcon size={11} />, onClick: openProfile }}
          />

          {/* Separator */}
          <div style={{ width: 1, height: 16, background: "var(--hms-border)", margin: "0 2px" }} />

          {/* Selectors */}
          <ModelPicker
            value={selectedModel}
            providers={providers}
            modelDefault={modelDefault}
            onChange={(model, providerKey) => {
              // Per-run override only — sendMessage() passes `model` + `provider`
              // in the POST /api/runs body. Storing both lets the backend route
              // to the correct provider even when it differs from config.yaml default.
              setSelectedModel(model);
              setSelectedProvider(providerKey);
            }}
            reasoningValue={reasoning}
            onReasoningChange={setReasoning}
          />

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Context ring — current window occupancy vs the model's window */}
          <ContextMeter
            draftTokens={value.trim() ? estimateTokenCount(value) : 0}
            contextLength={contextLength}
            usage={sessionUsage}
          />

          {/* Stop / Send — while running, a payload can be queued (Enter does
              the same); Stop stays one click away. */}
          {isRunning ? (
            <>
              {(value.trim().length > 0 || attachments.length > 0) && !queueEditId && (
                <button
                  onClick={send}
                  title={t.composer.queueSend}
                  style={sendStyle({})}
                >
                  <Send size={14} />
                </button>
              )}
              <button
                onClick={onStop}
                title="Stop"
                style={sendStyle({ danger: true })}
              >
                <Square size={14} fill="currentColor" />
              </button>
            </>
          ) : (
            <button
              onClick={send}
              disabled={(!value.trim() && attachments.length === 0) || !!disabled}
              title={queueEditId ? t.composer.saveQueued : "Send (Enter)"}
              style={sendStyle({ disabled: (!value.trim() && attachments.length === 0) || !!disabled })}
            >
              <Send size={14} />
            </button>
          )}
        </div>
      </div>

    </div>
  );
});

export default Composer;
