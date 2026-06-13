import { useState, useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from "react";
import { useQuery } from "@tanstack/react-query";
import { Mic, Send, Square, User, Settings as SettingsIcon } from "lucide-react";
import AttachMenu from "./composer/AttachMenu";
import SlashMenu from "./SlashMenu";
import { useChatStore } from "@/store/chat";
import { useCapabilityStore } from "@/store/capabilities";
import { useI18n } from "@/i18n";
import type { ComposerAttachment } from "@/lib/hermes-types";
import { useProviders, type ProviderInfo } from "@/hooks/useProviders";
import { ContextMeter, estimateTokenCount } from "./composer/ContextMeter";
import { ModelPicker } from "./composer/ModelPicker";
import { PillSelect, ToolbarBtn, sendStyle } from "./composer/parts";
import { AttachmentChips } from "./composer/AttachmentChips";
import QueuePanel from "./composer/QueuePanel";
import { useVoiceInput } from "./composer/useVoiceInput";
import { useComposerAttachments } from "./composer/useComposerAttachments";
import { useComposerAutocomplete } from "./composer/useComposerAutocomplete";
import { useComposerDrain } from "./composer/useComposerDrain";
import { useComposerProfilePill } from "./composer/useComposerProfilePill";
import { useOverlays } from "@/store/overlays";
import { highlightComposerTokens } from "@/lib/composer-tokens";

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

  const { caps } = useCapabilityStore();
  const { t } = useI18n();
  const openProfile = useOverlays((s) => s.openProfile);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Browser folder picker — webkitdirectory isn't a typed attribute.
  useEffect(() => {
    folderInputRef.current?.setAttribute("webkitdirectory", "");
  }, []);
  const activeRunId = useChatStore((s) => s.activeRunId);
  const {
    selectedModel, setSelectedModel,
    selectedProvider, setSelectedProvider,
    reasoningEffort: reasoning, setReasoningEffort: setReasoning,
  } = useChatStore();
  const sessionUsage = useChatStore((s) =>
    sessionId ? s.usageBySession[sessionId] ?? null : null,
  );
  const isRunning = running ?? !!activeRunId;

  // ── Extracted hooks ─────────────────────────────────────────────────
  // Attachment state + all ingest paths (picker / paste / drag / imperative).
  const HARD_MAX_BYTES = caps?.limits?.max_upload_bytes ?? 50 * 1024 * 1024;
  const {
    attachments, uploadError, setUploadError, dragOver,
    ingestFiles, onFileChange, onPaste, onDragOver, onDragLeave, onDrop,
    removeAttachment, clear: clearAttachments,
  } = useComposerAttachments({ sessionId, maxBytes: HARD_MAX_BYTES, selectedModel });

  // Voice dictation appends recognised text.
  const voice = useVoiceInput((transcript) =>
    setValue((v) => (v ? v.replace(/\s*$/, "") + " " : "") + transcript),
  );

  // Profile pill (view-scope picker).
  const { currentProfileName, profileChoices, handleProfileChange } = useComposerProfilePill();

  // Slash / @mention autocomplete.
  const {
    showSlash, showMention,
    filteredCmds, filteredMentions,
    slashIndex, mentionIndex,
    slashQuery, mentionQuery,
    onSlashSelect, onMentionSelect,
    setToken,
    handleAutocompleteKey,
    onChange,
  } = useComposerAutocomplete({ setValue, textRef, mentionNames });

  // Queue drain (queued sends while busy, auto-drain on settle).
  const {
    queueEditId, setQueueEditId,
    queued, enqueueQueued, removeQueued, updateQueuedText,
    drainNext, sendQueuedNow, beginQueueEdit,
  } = useComposerDrain({ sessionId, isRunning, onSend, onStop, setValue, textRef });

  useImperativeHandle(ref, () => ({
    addFiles(files: File[]) { ingestFiles(files); },
  }), [ingestFiles]);

  // ── Model / context ring ────────────────────────────────────────────
  const { data: modelsResp } = useProviders();
  const modelDefault = modelsResp?.model_default ?? null;
  const providers: ProviderInfo[] = modelsResp?.providers ?? [];
  const firstModel = providers[0]?.models?.[0] ?? null;

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

  // ── Draft / model init effects ──────────────────────────────────────
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

  // ── Local helpers ───────────────────────────────────────────────────
  const clearComposer = useCallback(() => {
    setValue("");
    clearAttachments();
    setToken(null);
  }, [clearAttachments, setToken]);

  // Clipboard image → the same upload pipeline as a picked file.
  const pasteClipboardImage = useCallback(async () => {
    try {
      const items = await navigator.clipboard.read();
      const files: File[] = [];
      for (const item of items) {
        const mime = item.types.find((type) => type.startsWith("image/"));
        if (!mime) continue;
        const blob = await item.getType(mime);
        const ext = mime.split("/")[1]?.split("+")[0] || "png";
        files.push(new File([blob], `clipboard-${Date.now()}.${ext}`, { type: mime }));
      }
      if (files.length === 0) {
        setUploadError(t.composer.noClipboardImage);
        return;
      }
      ingestFiles(files);
    } catch {
      setUploadError(t.composer.noClipboardImage);
    }
  }, [ingestFiles, setUploadError, t.composer.noClipboardImage]);

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
    setQueueEditId,
  ]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Delegate autocomplete keyboard handling (slash/mention arrow/enter/esc).
    if (handleAutocompleteKey(e)) return;
    const native = e.nativeEvent as KeyboardEvent;
    const composing = native.isComposing || native.keyCode === 229;
    if (e.key === "Escape" && queueEditId) {
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
      {/* Hidden file inputs (files / folder / images) */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,audio/*,video/*,text/*,.pdf,.epub,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.md,.json,.csv,.ts,.tsx,.js,.jsx,.py,.sh,.yaml,.yml,.toml,.txt,.svg,.xml,.ini,.env"
        style={{ display: "none" }}
        onChange={onFileChange}
      />
      <input
        ref={folderInputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={onFileChange}
      />
      <input
        ref={imageInputRef}
        type="file"
        multiple
        accept="image/*"
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
            {t.composer.dropHere}
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
            placeholder={t.composer.placeholder}
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
          <AttachMenu
            onPickFiles={() => fileInputRef.current?.click()}
            onPickFolder={() => folderInputRef.current?.click()}
            onPickImages={() => imageInputRef.current?.click()}
            onPasteImage={() => void pasteClipboardImage()}
            onInsertText={(text) => {
              setValue((v) => (v && !v.endsWith("\n") && !v.endsWith(" ") ? v + "\n" : v) + text);
              requestAnimationFrame(() => textRef.current?.focus());
            }}
          />

          {/* Mic — Web Speech API */}
          <ToolbarBtn
            title={voice.supported ? (voice.listening ? t.composer.voiceStop : t.composer.voice) : t.composer.voiceUnsupported}
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
                title={t.composer.stop}
                style={sendStyle({ danger: true })}
              >
                <Square size={14} fill="currentColor" />
              </button>
            </>
          ) : (
            <button
              onClick={send}
              disabled={(!value.trim() && attachments.length === 0) || !!disabled}
              title={queueEditId ? t.composer.saveQueued : t.composer.sendTitle}
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
