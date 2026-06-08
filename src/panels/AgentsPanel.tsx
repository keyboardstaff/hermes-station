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
    <div className="hms-agents-root">
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
            <div ref={addRef} className="hms-agents-addwrap">
              <Button
                type="button"
                size="sm"
                onClick={() => setAddOpen((o) => !o)}
                disabled={addable.length === 0}
              >
                <Plus size={13} /> {g.addAgent}
              </Button>
              {addOpen && addable.length > 0 && (
                <div className="hms-agents-addmenu">
                  {addable.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => { addMember(name); setAddOpen(false); }}
                      className="hms-sidebar-row hms-agents-additem"
                    >
                      <Users size={13} className="hms-agents-icon-accent" /> {name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        }
      />

      <div className="hms-agents-body">
        {/* Room list */}
        <Card padding={false} className="hms-agents-roomlist">
          <div className="hms-agents-roomlist-head">
            {g.rooms}
            <IconButton type="button" size="sm" onClick={() => createRoom()} title={g.newRoom} aria-label={g.newRoom}>
              <Plus size={14} />
            </IconButton>
          </div>
          <div className="hms-agents-roomlist-scroll">
            {rooms.map((r) => {
              const active = r.id === currentRoomId;
              return (
                <div
                  key={r.id}
                  onClick={() => selectRoom(r.id)}
                  onDoubleClick={() => handleRename(r.id, r.name)}
                  className="hms-sidebar-row hms-agents-room"
                  data-active={active}
                >
                  <MessageSquare size={13} className="hms-agents-room-icon" />
                  <span className="hms-agents-room-name">{r.name}</span>
                  {r.activeRunId && <span className="hms-agents-dot hms-agents-dot--sm" />}
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
        <Card padding={false} className="hms-agents-room-card">
          <div className="hms-agents-room-head">
            <div className="hms-agents-room-title-wrap">
              <MessageSquare size={14} className="hms-agents-icon-accent" />
              <div className="hms-agents-room-title">{room.name}</div>
            </div>
            <div className="hms-agents-room-meta">
              {target && (
                <span className="hms-agents-responds">
                  {g.respondsLabel}: <span className="hms-agents-responds-target">@{target}</span>
                </span>
              )}
              {running && <span className="hms-agents-dot" />}
            </div>
          </div>

          {/* Roster — members as chips; click to set the responder. */}
          {members.length > 0 && (
            <div className="hms-agents-roster">
              <span className="hms-agents-roster-label">{g.respondsLabel}:</span>
              {members.map((name) => {
                const isResp = target === name;
                return (
                  <span key={name} className="hms-agents-chip" data-resp={isResp || undefined}>
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
            <div className="hms-agents-empty">
              <Users size={36} className="hms-agents-icon-muted" />
              <div className="hms-agents-empty-title">{g.noMembers}</div>
              <div className="hms-agents-empty-hint">{g.noMembersHint}</div>
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
