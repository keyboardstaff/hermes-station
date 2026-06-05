import { useEffect, useRef, useState } from "react";
import { Users, Plus, X, Trash2 } from "lucide-react";
import { useI18n } from "@/i18n";
import { useAgentRoomStore } from "@/store/agentRoom";
import { useAgentRoomStream } from "@/hooks/useAgentRoomStream";
import { useProfiles } from "@/hooks/useProfiles";
import ChatStream from "@/components/chat/ChatStream";
import Composer from "@/components/chat/Composer";
import PageTopBar from "@/components/layout/PageTopBar";

/**
 * AgentsPanel — an ISOLATED, persisted multi-agent room.
 *
 * Fully decoupled from /chat: the conversation lives in `useAgentRoomStore`
 * (persisted to localStorage) and streams through `useAgentRoomStream` (each
 * turn is a real run under the routed member's profile, with the room's prior
 * turns sent as conversation_history). The input is the shared /chat Composer
 * (attach / mic / model / slash) wired to the room's send/stop + running state.
 * Members are profiles; route a turn with a leading `@member` mention or by
 * picking the active responder chip.
 *
 * Follow-ups (debt register): @member autocomplete + highlight, multiple named
 * rooms + invite codes, persisted-across-devices storage.
 */
export default function AgentsPanel() {
  const { t } = useI18n();
  const g = t.agents;
  const messages = useAgentRoomStore((s) => s.messages);
  const members = useAgentRoomStore((s) => s.members);
  const responder = useAgentRoomStore((s) => s.responder);
  const activeRunId = useAgentRoomStore((s) => s.activeRunId);
  const sessionIds = useAgentRoomStore((s) => s.sessionIds);
  const { addMember, removeMember, setResponder, clearConversation } = useAgentRoomStore();

  // Clearing the room also deletes its run sessions server-side, so they don't
  // resurface in /chat Recents once the local filter list is cleared.
  const handleClearRoom = () => {
    for (const sid of sessionIds) {
      void fetch(`/api/dashboard/sessions/${encodeURIComponent(sid)}`, {
        method: "DELETE",
        headers: { "X-HMS-CSRF": "1" },
      }).catch(() => { /* best-effort */ });
    }
    clearConversation();
  };
  const { send, stop } = useAgentRoomStream();
  const profilesQuery = useProfiles();
  const profileNames: string[] = (profilesQuery.data?.profiles ?? []).map((p) => p.name);
  const addable = profileNames.filter((n) => !members.includes(n));

  const [addOpen, setAddOpen] = useState(false);
  const addRef = useRef<HTMLDivElement>(null);

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

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, overflow: "hidden" }}>
      <PageTopBar
        title={t.nav.agents}
        subtitle={g.subtitle}
        actions={
          <>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={handleClearRoom}
                title={g.clearRoom}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 'var(--hms-space-1)',
                  padding: "4px 10px", borderRadius: 6,
                  border: "1px solid var(--hms-border)", background: "var(--hms-surface)",
                  color: "var(--hms-text-muted)", fontSize: 'var(--hms-text-caption)', cursor: "pointer",
                }}
              >
                <Trash2 size={13} /> {g.clearRoom}
              </button>
            )}
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
          </>
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
          <ChatStream messages={messages} />
          {/* Shared /chat Composer, wired to the room's send/stop + run state.
              @mention routes the turn (parsed on send); no session — the room
              owns its transcript. */}
          <Composer
            onSend={(text, attachments) => void send(text, attachments)}
            onStop={() => void stop()}
            running={running}
            sessionId={null}
            mentionNames={members}
          />
        </>
      )}
    </div>
  );
}
