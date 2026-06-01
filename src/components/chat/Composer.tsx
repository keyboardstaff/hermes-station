import { useState, useRef, useCallback, useMemo, useEffect, forwardRef, useImperativeHandle } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Paperclip, Mic, Send, Square, User, Settings as SettingsIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import SlashMenu from "./SlashMenu";
import type { SlashCommand } from "@/lib/slash-commands";
import { useDiscoverSlashCommands } from "@/store/discovery";
import { useChatStore } from "@/store/chat";
import { useCapabilityStore } from "@/store/capabilities";
import { useProfiles, useActiveProfile, useSetActiveProfile } from "@/hooks/useProfiles";
import { useI18n } from "@/i18n";
import type { ComposerAttachment } from "@/lib/hermes-types";
import type { ProviderInfo } from "@/hooks/useProviders";
import { ContextMeter, estimateTokenCount } from "./composer/ContextMeter";
import { ReasoningPicker } from "./composer/ReasoningPicker";
import { ModelPicker } from "./composer/ModelPicker";
import { PillSelect, ToolbarBtn, sendStyle } from "./composer/parts";
import { AttachmentChips } from "./composer/AttachmentChips";
import { useVoiceInput } from "./composer/useVoiceInput";
import { useComposerAttachments } from "./composer/useComposerAttachments";

interface ComposerProps {
  onSend: (text: string, attachments?: ComposerAttachment[]) => void;
  onStop: () => void;
  disabled?: boolean;
  /** Forwarded to upload API so images can be recovered after refresh. */
  sessionId?: string | null;
}

export interface ComposerHandle {
  addFiles: (files: File[]) => void;
}

const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  { onSend, onStop, disabled, sessionId }: ComposerProps,
  ref,
) {
  const [value, setValue] = useState("");
  const [showSlash, setShowSlash] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);

  const { caps } = useCapabilityStore();
  const { t } = useI18n();
  const navigate = useNavigate();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeRunId = useChatStore((s) => s.activeRunId);
  const {
    selectedModel, setSelectedModel,
    selectedProvider, setSelectedProvider,
    reasoningEffort: reasoning, setReasoningEffort: setReasoning,
    lastUsage, showTokens, setShowTokens,
  } = useChatStore();
  const isRunning = !!activeRunId;
  const queryClient = useQueryClient();

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

  // Active profile = sticky ~/.hermes/active_profile (server state, not chat-store).
  // Switching writes the sticky file; each profile is its own gateway.
  const profilesQuery = useProfiles();
  const profileNames: string[] = useMemo(
    () => (profilesQuery.data?.profiles ?? []).map((p) => p.name),
    [profilesQuery.data],
  );
  const activeProfileQuery = useActiveProfile();
  const setActiveProfile = useSetActiveProfile();
  const activeProfileName = activeProfileQuery.data?.sticky ?? "default";
  const profileSwitching = setActiveProfile.isPending;
  const profileChoices = profileNames.length > 0 ? profileNames : [activeProfileName];
  const handleProfileChange = useCallback(async (next: string) => {
    if (next === activeProfileName) return;
    try {
      // Each profile is its own gateway (upstream multi-gateway model) — set
      // the sticky default; no restart. If that profile's gateway isn't
      // running, the user starts it from /profile. Refresh profile-scoped caches.
      await setActiveProfile.mutateAsync(next);
      ["fs-models", "profile-active", "profiles", "skills", "sessions-table-all"].forEach((key) =>
        queryClient.invalidateQueries({ queryKey: [key] }),
      );
    } catch {
      /* mutation errors surface via react-query state. */
    }
  }, [activeProfileName, setActiveProfile, queryClient]);

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

  // Pre-fill from a forked message handoff.
  useEffect(() => {
    const forked = sessionStorage.getItem("hms_fork_input");
    if (forked) {
      setValue(forked);
      sessionStorage.removeItem("hms_fork_input");
    }
  }, []);

  useEffect(() => {
    if (!selectedModel && (modelDefault || firstModel)) {
      setSelectedModel(modelDefault ?? firstModel);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelDefault, firstModel]);

  const slashQuery = value.split("\n").at(-1) ?? "";
  const { data: discoveredSlash } = useDiscoverSlashCommands();
  const filteredCmds = useMemo<SlashCommand[]>(() => {
    const all: SlashCommand[] = (discoveredSlash?.commands ?? []).map((c) => ({
      name: c.name,
      description: c.description,
    }));
    const prefix = slashQuery.replace(/^\//, "");
    return all.filter((c) => c.name.startsWith(prefix));
  }, [discoveredSlash, slashQuery]);

  const send = useCallback(() => {
    const trimmed = value.trim();
    if ((!trimmed && attachments.length === 0) || isRunning || disabled) return;
    onSend(trimmed, attachments.length > 0 ? attachments : undefined);
    setValue("");
    clearAttachments();
    setShowSlash(false);
    setSlashIndex(0);
  }, [value, attachments, isRunning, disabled, onSend, clearAttachments]);

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
        setShowSlash(false);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !composing) {
      e.preventDefault();
      send();
    }
  };

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setValue(v);
    const lastLine = v.split("\n").at(-1) ?? "";
    const shouldShow = lastLine.startsWith("/") && !lastLine.includes(" ");
    setShowSlash(shouldShow);
    if (shouldShow) setSlashIndex(0);
  };

  const onSlashSelect = (cmd: SlashCommand) => {
    setValue("/" + cmd.name + (cmd.args ? " " : ""));
    setShowSlash(false);
    setSlashIndex(0);
    textRef.current?.focus();
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
        maxWidth: "calc(var(--hms-content-max-w) + 80px)",
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
              onClose={() => setShowSlash(false)}
              commands={filteredCmds}
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

        {/* Text area */}
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
            width: "100%",
            resize: "none",
            border: "none",
            background: "transparent",
            padding: "12px 14px 4px",
            fontSize: 'var(--hms-text-body)',
            lineHeight: 1.6,
            color: "var(--hms-text)",
            outline: "none",
            fontFamily: "inherit",
            boxSizing: "border-box",
            minHeight: 44,
          }}
        />

        {/* Toolbar: [attach][voice] | [profile][model][reasoning] | [~tok] | [■/▶] */}
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

          {/* Active-profile pill: changing it writes ~/.hermes/active_profile. */}
          <PillSelect
            icon={<User size={12} />}
            value={activeProfileName}
            options={profileChoices}
            onChange={handleProfileChange}
            disabledHint={profileSwitching ? "switching…" : undefined}
            footerAction={{ label: t.composer.manageProfiles, icon: <SettingsIcon size={11} />, onClick: () => navigate("/profile") }}
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
          />
          <ReasoningPicker value={reasoning} onChange={setReasoning} />

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Context ring — session tokens vs model context window */}
          {(() => {
            const used = lastUsage?.total_tokens ?? (value.trim() ? estimateTokenCount(value) : 0);
            if (used === 0 && !contextLength) return null;
            return (
              <ContextMeter
                used={used}
                contextLength={contextLength}
                usage={lastUsage}
                showTokens={showTokens}
                onToggleTokens={setShowTokens}
              />
            );
          })()}

          {/* Stop / Send */}
          {isRunning ? (
            <button
              onClick={onStop}
              title="Stop"
              style={sendStyle({ danger: true })}
            >
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={send}
              disabled={(!value.trim() && attachments.length === 0) || !!disabled}
              title="Send (Enter)"
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
