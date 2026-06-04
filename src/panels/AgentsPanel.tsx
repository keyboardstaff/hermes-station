import { useEffect, useRef, useState, useCallback } from "react";
import { Users, Plus, X, ArrowUp, Square } from "lucide-react";
import { useI18n } from "@/i18n";
import { useChatStore } from "@/store/chat";
import { useRunsStream } from "@/hooks/useRunsStream";
import { useAgentRoomStore } from "@/store/agentRoom";
import { useProfiles } from "@/hooks/useProfiles";
import ChatStream from "@/components/chat/ChatStream";
import PageTopBar from "@/components/layout/PageTopBar";
import { loadSessionMessages } from "@/lib/load-session";

/**
 * AgentsPanel — a multi-agent room (MVP).
 *
 * Members are profiles; the responder picks which one answers the next turn,
 * and the turn's run is routed under that profile's HERMES_HOME via the
 * per-run `profile` override. The conversation reuses the shared chat store +
 * ChatStream; user turns are tagged with the agent they were routed to.
 * Multiple named rooms / invite codes / per-message attribution badges are
 * follow-ups tracked in the debt register.
 */
export default function AgentsPanel() {
  const { t } = useI18n();
  const g = t.agents;
  const { messages, activeSessionId, isHistoryPending, reconcileSession, setHistoryPending } = useChatStore();
  const activeRunId = useChatStore((s) => s.activeRunId);
  const { sendMessage, stopRun } = useRunsStream();
  const { members, responder, addMember, removeMember, setResponder } = useAgentRoomStore();
  const profilesQuery = useProfiles();
  const profileNames: string[] = (profilesQuery.data?.profiles ?? []).map((p) => p.name);
  const addable = profileNames.filter((n) => !members.includes(n));

  const [draft, setDraft] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const addRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef<string | null>(null);

  // Adopt the active session's transcript (shared with /chat). Load only when
  // nothing is in the store yet (a direct landing on /agents).
  useEffect(() => {
    if (!activeSessionId) return;
    if (loadedRef.current === activeSessionId) return;
    if (useChatStore.getState().messages.length > 0) {
      loadedRef.current = activeSessionId;
      return;
    }
    loadedRef.current = activeSessionId;
    setHistoryPending(true);
    loadSessionMessages(activeSessionId)
      .then((msgs) => { if (loadedRef.current === activeSessionId) reconcileSession(msgs); })
      .catch(() => { /* best-effort */ })
      .finally(() => setHistoryPending(false));
  }, [activeSessionId, reconcileSession, setHistoryPending]);

  useEffect(() => {
    if (!addOpen) return;
    const onDown = (e: MouseEvent) => {
      if (addRef.current && !addRef.current.contains(e.target as Node)) setAddOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [addOpen]);

  const running = activeRunId != null;
  const target = responder ?? members[0] ?? null;

  const submit = useCallback(() => {
    const text = draft.trim();
    if (!text || running || !target) return;
    setDraft("");
    void sendMessage(text, undefined, { profileOverride: target });
  }, [draft, running, target, sendMessage]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, overflow: "hidden" }}>
      <PageTopBar
        title={t.nav.agents}
        subtitle={g.subtitle}
        actions={
          <div ref={addRef} style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => setAddOpen((o) => !o)}
              disabled={addable.length === 0}
              style={{
                display: "inline-flex", alignItems: "center", gap: 'var(--hms-space-1)',
                padding: "4px 10px", borderRadius: 6,
                border: "1px solid var(--hms-border)", background: "var(--hms-surface)",
                color: addable.length === 0 ? "var(--hms-text-muted)" : "var(--hms-text)",
                fontSize: 'var(--hms-text-caption)', cursor: addable.length === 0 ? "default" : "pointer",
              }}
            >
              <Plus size={13} /> {g.addAgent}
            </button>
            {addOpen && addable.length > 0 && (
              <div
                style={{
                  position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 9999,
                  minWidth: 160, padding: "4px 0", borderRadius: 8,
                  background: "var(--hms-surface)", border: "1px solid var(--hms-border)",
                  boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
                }}
              >
                {addable.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => { addMember(name); setAddOpen(false); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 'var(--hms-space-2)', width: "100%",
                      padding: "7px 14px", border: "none", background: "none",
                      color: "var(--hms-text)", fontSize: 'var(--hms-text-sm)', cursor: "pointer", textAlign: "left",
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--hms-hover-bg)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "none"; }}
                  >
                    <Users size={13} style={{ color: "var(--hms-accent)" }} /> {name}
                  </button>
                ))}
              </div>
            )}
          </div>
        }
      />

      {/* Roster — members as profile chips; click to make one the responder. */}
      {members.length > 0 && (
        <div
          style={{
            display: "flex", flexWrap: "wrap", alignItems: "center", gap: 'var(--hms-space-2)',
            padding: "8px 16px", borderBottom: "1px solid var(--hms-border)",
          }}
        >
          <span style={{ fontSize: 'var(--hms-text-xs)', color: "var(--hms-text-muted)", marginRight: 2 }}>
            {g.respondsLabel}:
          </span>
          {members.map((name) => {
            const active = target === name;
            return (
              <span
                key={name}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 'var(--hms-space-1)',
                  padding: "3px 6px 3px 10px", borderRadius: 999,
                  border: `1px solid ${active ? "var(--hms-accent)" : "var(--hms-border)"}`,
                  background: active ? "var(--hms-accent-weak)" : "var(--hms-surface)",
                  color: active ? "var(--hms-accent)" : "var(--hms-text)",
                  fontSize: 'var(--hms-text-caption)',
                }}
              >
                <button
                  type="button"
                  onClick={() => setResponder(name)}
                  style={{ border: "none", background: "none", cursor: "pointer", color: "inherit", padding: 0, fontSize: 'var(--hms-text-caption)' }}
                >
                  @{name}
                </button>
                <button
                  type="button"
                  onClick={() => removeMember(name)}
                  title={g.remove}
                  style={{ display: "inline-flex", border: "none", background: "none", cursor: "pointer", color: "var(--hms-text-muted)", padding: 0 }}
                >
                  <X size={11} />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {members.length === 0 ? (
        <div
          style={{
            flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            gap: 'var(--hms-space-3)', color: "var(--hms-text-muted)", padding: 'var(--hms-space-6)', textAlign: "center",
          }}
        >
          <Users size={36} style={{ color: "var(--hms-text-muted)" }} />
          <div style={{ fontWeight: 600, color: "var(--hms-text)", fontSize: 'var(--hms-text-body)' }}>{g.noMembers}</div>
          <div style={{ maxWidth: 420, fontSize: 'var(--hms-text-sm)' }}>{g.noMembersHint}</div>
        </div>
      ) : (
        <>
          <ChatStream messages={messages} isLoadingHistory={isHistoryPending} />

          {/* Room composer — routes the turn to @responder's profile. */}
          <div style={{ borderTop: "1px solid var(--hms-border)", padding: "10px 16px" }}>
            <div
              style={{
                display: "flex", alignItems: "flex-end", gap: 'var(--hms-space-2)',
                border: "1px solid var(--hms-border)", borderRadius: 12,
                padding: "8px 10px", background: "var(--hms-bg)",
              }}
            >
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
                }}
                placeholder={target ? `@${target} · ${g.placeholder}` : g.placeholder}
                rows={1}
                style={{
                  flex: 1, resize: "none", border: "none", outline: "none", background: "transparent",
                  color: "var(--hms-text)", fontSize: 'var(--hms-text-body)', fontFamily: "inherit",
                  maxHeight: 160, minHeight: 24,
                }}
              />
              {running ? (
                <button
                  type="button"
                  onClick={() => void stopRun()}
                  title="Stop"
                  style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    width: 30, height: 30, borderRadius: "50%", flexShrink: 0,
                    border: "none", background: "var(--hms-text)", color: "var(--hms-bg)", cursor: "pointer",
                  }}
                >
                  <Square size={13} style={{ fill: "currentColor" }} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={submit}
                  disabled={!draft.trim() || !target}
                  title="Send"
                  style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    width: 30, height: 30, borderRadius: "50%", flexShrink: 0,
                    border: "none", cursor: draft.trim() && target ? "pointer" : "default",
                    background: draft.trim() && target ? "var(--hms-text)" : "var(--hms-border)",
                    color: "var(--hms-bg)",
                  }}
                >
                  <ArrowUp size={15} />
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
