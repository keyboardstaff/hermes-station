import { useEffect, useRef, useState } from "react";
import { Users, Plus, X, Trash2, MessageSquare } from "lucide-react";
import { useI18n } from "@/i18n";
import { useAgentRoomStore, currentRoom } from "@/store/agentRoom";
import { useAgentRoomStream } from "@/hooks/useAgentRoomStream";
import { useProfiles } from "@/hooks/useProfiles";
import ChatStream from "@/components/chat/ChatStream";
import Composer from "@/components/chat/Composer";
import PageTopBar from "@/components/layout/PageTopBar";
import Button from "@/components/ui/Button";
import IconButton from "@/components/ui/IconButton";
import Card from "@/components/ui/Card";

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
              <Button type="button" size="sm" onClick={handleClearRoom} title={g.clearRoom}>
                <Trash2 size={13} /> {g.clearRoom}
              </Button>
            )}
            <div ref={addRef} style={{ position: "relative" }}>
              <Button
                type="button"
                size="sm"
                onClick={() => setAddOpen((o) => !o)}
                disabled={addable.length === 0}
              >
                <Plus size={13} /> {g.addAgent}
              </Button>
              {addOpen && addable.length > 0 && (
                <div
                  style={{
                    position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 9999,
                    minWidth: 160, padding: "4px 0", borderRadius: 8,
                    background: "var(--hms-surface)", border: "1px solid var(--hms-border)",
                    boxShadow: "var(--hms-shadow-popover)",
                  }}
                >
                  {addable.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => { addMember(name); setAddOpen(false); }}
                      className="hms-sidebar-row"
                      style={{
                        display: "flex", alignItems: "center", gap: 'var(--hms-space-2)', width: "100%",
                        padding: "7px 14px", border: "none", background: "none",
                        color: "var(--hms-text)", fontSize: 'var(--hms-text-sm)', cursor: "pointer", textAlign: "left",
                      }}
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

      <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden", padding: 'var(--hms-space-4)', gap: 'var(--hms-space-4)' }}>
        {/* Room list */}
        <Card
          padding={false}
          style={{
            width: 220,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            overflow: "hidden",
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
            <IconButton type="button" size="sm" onClick={() => createRoom()} title={g.newRoom} aria-label={g.newRoom}>
              <Plus size={14} />
            </IconButton>
          </div>
          <div style={{ flex: 1, overflowY: "auto", minHeight: 0, padding: "4px 0" }}>
            {rooms.map((r) => {
              const active = r.id === currentRoomId;
              return (
                <div
                  key={r.id}
                  onClick={() => selectRoom(r.id)}
                  onDoubleClick={() => handleRename(r.id, r.name)}
                  className="hms-sidebar-row"
                  data-active={active}
                  style={{
                    display: "flex", alignItems: "center", gap: 'var(--hms-space-2)',
                    padding: "7px 12px", cursor: "pointer",
                    color: active ? "var(--hms-text)" : "var(--hms-text-muted)",
                  }}
                >
                  <MessageSquare size={13} style={{ flexShrink: 0, color: active ? "var(--hms-accent)" : "var(--hms-text-muted)" }} />
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 'var(--hms-text-sm)' }}>
                    {r.name}
                  </span>
                  {r.activeRunId && (
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--hms-accent)", flexShrink: 0 }} />
                  )}
                  {rooms.length > 1 && (
                    <IconButton
                      type="button"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); deleteRoom(r.id); }}
                      title={g.deleteRoom}
                    >
                      <X size={12} />
                    </IconButton>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        {/* Current room */}
        <Card
          padding={false}
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 'var(--hms-space-3)',
              padding: "10px 16px",
              borderBottom: "1px solid var(--hms-border)",
              flexShrink: 0,
            }}
          >
            <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 'var(--hms-space-2)' }}>
              <MessageSquare size={14} style={{ color: "var(--hms-accent)", flexShrink: 0 }} />
              <div style={{ minWidth: 0, fontSize: 'var(--hms-text-sm)', fontWeight: 600, color: "var(--hms-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {room.name}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-2)', flexShrink: 0 }}>
              {target && (
                <span style={{ fontSize: 'var(--hms-text-xs)', color: "var(--hms-text-muted)", whiteSpace: "nowrap" }}>
                  {g.respondsLabel}: <span style={{ color: "var(--hms-text)" }}>@{target}</span>
                </span>
              )}
              {running && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--hms-accent)" }} />}
            </div>
          </div>

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
                      className="hms-agents-chip-button"
                    >
                      @{name}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeMember(name)}
                      title={g.remove}
                      className="hms-agents-chip-remove"
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
        </Card>
      </div>
    </div>
  );
}
