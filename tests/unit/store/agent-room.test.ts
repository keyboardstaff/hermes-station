import { describe, it, expect, beforeEach } from "vitest";
import { useAgentRoomStore, currentRoom, type Room } from "@/store/agentRoom";
import { parseMentions } from "@/hooks/useAgentRoomStream";

const room = (): Room => currentRoom(useAgentRoomStore.getState());

const freshRoom = (id: string): Room => ({
  id, name: "Room 1", members: [], responder: null, messages: [],
  sessionIds: [], activeRunId: null, activeTurnId: null, turnAgent: null,
});

function reset() {
  localStorage.clear();
  useAgentRoomStore.setState({ rooms: [freshRoom("r1")], currentRoomId: "r1", _streamRoomId: null });
}

describe("useAgentRoomStore (current-room roster + conversation)", () => {
  beforeEach(reset);

  it("adds a member and makes the first one the responder", () => {
    useAgentRoomStore.getState().addMember("coder");
    expect(room().members).toEqual(["coder"]);
    expect(room().responder).toBe("coder");
  });

  it("dedupes repeated adds", () => {
    useAgentRoomStore.getState().addMember("coder");
    useAgentRoomStore.getState().addMember("coder");
    expect(room().members).toEqual(["coder"]);
  });

  it("removing the active responder reassigns to the first remaining member", () => {
    const s = useAgentRoomStore.getState();
    s.addMember("coder");
    s.addMember("writer");
    s.setResponder("writer");
    s.removeMember("writer");
    expect(room().members).toEqual(["coder"]);
    expect(room().responder).toBe("coder");
  });

  it("persists rooms to localStorage", () => {
    useAgentRoomStore.getState().addMember("coder");
    expect(localStorage.getItem("hms_agent_rooms")).toContain("coder");
  });

  it("appendUser tags the message with the routed agent (isolated transcript)", () => {
    useAgentRoomStore.getState().appendUser("hi", "coder");
    const m = room().messages.at(-1);
    expect(m?.role).toBe("user");
    expect(m?.agent).toBe("coder");
    expect(m?.content).toBe("hi");
  });

  it("appendDelta stamps the assistant bubble with the turn's agent", () => {
    const s = useAgentRoomStore.getState();
    s.beginTurn("run1", "writer");
    s.appendDelta("answer");
    const m = room().messages.find((x) => x.role === "assistant");
    expect(m?.agent).toBe("writer");
  });

  it("clearConversation empties the room transcript", () => {
    const s = useAgentRoomStore.getState();
    s.appendUser("hi", "coder");
    s.clearConversation();
    expect(room().messages).toEqual([]);
  });
});

describe("useAgentRoomStore (multiple rooms)", () => {
  beforeEach(reset);

  it("createRoom adds + selects a new, empty, isolated room", () => {
    useAgentRoomStore.getState().addMember("coder"); // → r1
    useAgentRoomStore.getState().createRoom("Design");
    expect(useAgentRoomStore.getState().rooms).toHaveLength(2);
    expect(room().name).toBe("Design");
    expect(room().members).toEqual([]);
  });

  it("keeps each room's roster isolated", () => {
    const s = useAgentRoomStore.getState();
    s.addMember("coder"); // r1
    s.createRoom("B");
    const bId = useAgentRoomStore.getState().currentRoomId;
    s.addMember("writer"); // B
    s.selectRoom("r1");
    expect(room().members).toEqual(["coder"]);
    s.selectRoom(bId);
    expect(room().members).toEqual(["writer"]);
  });

  it("deleteRoom always leaves at least one room", () => {
    useAgentRoomStore.getState().deleteRoom("r1");
    expect(useAgentRoomStore.getState().rooms.length).toBeGreaterThanOrEqual(1);
  });

  it("renameRoom updates the name", () => {
    useAgentRoomStore.getState().renameRoom("r1", "Planning");
    expect(useAgentRoomStore.getState().rooms[0].name).toBe("Planning");
  });
});

describe("parseMentions (multi-@member routing)", () => {
  it("collects ALL mentioned members and strips them from the body", () => {
    expect(parseMentions("@coder @writer do X", ["coder", "writer"])).toEqual({
      agents: ["coder", "writer"],
      body: "do X",
    });
  });

  it("collects a single leading @member", () => {
    expect(parseMentions("@coder do X", ["coder", "writer"])).toEqual({ agents: ["coder"], body: "do X" });
  });

  it("ignores @mentions that aren't members", () => {
    expect(parseMentions("@ghost hi", ["coder"])).toEqual({ agents: [], body: "@ghost hi" });
  });

  it("no mention → empty agents + full body", () => {
    expect(parseMentions("hello there", ["coder"])).toEqual({ agents: [], body: "hello there" });
  });

  it("collects mentions found mid-text (not only the start)", () => {
    expect(parseMentions("ping @coder then @writer", ["coder", "writer"])).toEqual({
      agents: ["coder", "writer"],
      body: "ping then",
    });
  });

  it("dedupes repeated mentions of the same member", () => {
    expect(parseMentions("@coder @coder hi", ["coder"])).toEqual({ agents: ["coder"], body: "hi" });
  });
});
