import { useEffect, useRef, useState } from "react";
import { Users, Plus, X, Trash2, MessageSquare } from "lucide-react";
import { useI18n } from "@/i18n";
import { useAgentRoomStore, currentRoom } from "@/store/agentRoom";
import { useAgentRoomStream } from "@/hooks/useAgentRoomStream";
import { useProfiles } from "@/hooks/useProfiles";
import ChatStream from "@/components/chat/ChatStream";
import Composer from "@/components/chat/Composer";
import PageTopBar from "@/components/layout/PageTopBar";

/**
 * AgentsPanel — a list of ISOLATED, persisted multi-agent rooms.
 *
 * Left: the room list (create / select / rename / delete). Right: the current
 * room — its roster + transcript + the shared /chat Composer. Each room is fully
 * decoupled from /chat: its conversation lives in `useAgentRoomStore` (persisted)
 * and streams via `useAgentRoomStream` (each turn fans out to the @mentioned
 * members under their profiles, with the room's prior turns as
 * conversation_history). Route a turn with `@member` mentions or the responder.
 */
export default function AgentsPanel() {
  const { t } = useI18n();
  const g = t.agents;
  const rooms = useAgentRoomStore((s) => s.rooms);
  const currentRoomId = useAgentRoomStore((s) => s.currentRoomId);
  const room = useAgentRoomStore(currentRoom);
  const {
    addMember, removeMember, setResponder, clearConversation,
    createRoom, deleteRoom, renameRoom, selectRoom,
  } = useAgentRoomStore();
  const { send, stop } = useAgentRoomStream();
  const profilesQuery = useProfiles();
  const profileNames: string[] = (profilesQuery.data?.profiles ?? []).map((p) => p.name);

  const { members, responder, messages, activeRunId, sessionIds } = room;
  const addable = profileNames.filter((n) => !members.includes(n));
  const running = activeRunId != null;
  const target = responder ?? members[0] ?? null;

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

  const handleClearRoom = () => {
    for (const sid of sessionIds) {
      void fetch(`/api/dashboard/sessions/${encodeURIComponent(sid)}`, {
        method: "DELETE",
        headers: { "X-HMS-CSRF": "1" },
      }).catch(() => { /* best-effort */ });
    }
    clearConversation();
  };

  const handleRename = (id: string, name: string) => {
    const next = window.prompt(g.renameRoomPrompt, name);
    if (next != null && next.trim()) renameRoom(id, next.trim());
  };

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

      <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
        {/* Room list */}
        <div
          style={{
            width: 200, flexShrink: 0, borderRight: "1px solid var(--hms-border)",
            display: "flex", flexDirection: "column", minHeight: 0,
          }}
        >
          <div
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "8px 12px", borderBottom: "1px solid var(--hms-border)",
              fontSize: 'var(--hms-text-xs)', fontWeight: 600, letterSpacing: "0.04em",
              textTransform: "uppercase", color: "var(--hms-text-muted)",
            }}
          >
            {g.rooms}
            <button
              type="button"
              onClick={() => createRoom()}
              title={g.newRoom}
              style={{ display: "inline-flex", border: "none", background: "none", cursor: "pointer", color: "var(--hms-text-muted)", padding: 0 }}
            >
              <Plus size={14} />
            </button>
          </div>
          <div style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "4px 0" }}>
            {rooms.map((r) => {
              const active = r.id === currentRoomId;
              return (
                <div
                  key={r.id}
                  onClick={() => selectRoom(r.id)}
                  onDoubleClick={() => handleRename(r.id, r.name)}
                  className="hms-room-row"
                  style={{
                    display: "flex", alignItems: "center", gap: 'var(--hms-space-2)',
                    padding: "7px 12px", cursor: "pointer",
                    background: active ? "var(--hms-selected-bg)" : "transparent",
                    color: active ? "var(--hms-text)" : "var(--hms-text-muted)",
                  }}
                  onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = "var(--hms-hover-bg)"; }}
                  onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                >
                  <MessageSquare size={13} style={{ flexShrink: 0, color: active ? "var(--hms-accent)" : "var(--hms-text-muted)" }} />
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 'var(--hms-text-sm)' }}>
                    {r.name}
                  </span>
                  {r.activeRunId && (
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--hms-accent)", flexShrink: 0 }} />
                  )}
                  {rooms.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); deleteRoom(r.id); }}
                      title={g.deleteRoom}
                      className="hms-room-del"
                      style={{ display: "inline-flex", border: "none", background: "none", cursor: "pointer", color: "var(--hms-text-muted)", padding: 0 }}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Current room */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
          {/* Roster — members as chips; click to set the responder. */}
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
                const isResp = target === name;
                return (
                  <span
                    key={name}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 'var(--hms-space-1)',
                      padding: "3px 6px 3px 10px", borderRadius: 999,
                      border: `1px solid ${isResp ? "var(--hms-accent)" : "var(--hms-border)"}`,
                      background: isResp ? "var(--hms-accent-weak)" : "var(--hms-surface)",
                      color: isResp ? "var(--hms-accent)" : "var(--hms-text)",
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
      </div>
    </div>
  );
}
