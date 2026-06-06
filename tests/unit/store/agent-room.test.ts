import { describe, it, expect, beforeEach } from "vitest";
import { useAgentRoomStore } from "@/store/agentRoom";
import { parseMentions } from "@/hooks/useAgentRoomStream";

describe("useAgentRoomStore (agents room roster)", () => {
  beforeEach(() => {
    localStorage.clear();
    useAgentRoomStore.setState({
      members: [], responder: null, messages: [], activeRunId: null, activeTurnId: null, turnAgent: null,
    });
  });

  it("adds a member and makes the first one the responder", () => {
    useAgentRoomStore.getState().addMember("coder");
    expect(useAgentRoomStore.getState().members).toEqual(["coder"]);
    expect(useAgentRoomStore.getState().responder).toBe("coder");
  });

  it("dedupes repeated adds", () => {
    useAgentRoomStore.getState().addMember("coder");
    useAgentRoomStore.getState().addMember("coder");
    expect(useAgentRoomStore.getState().members).toEqual(["coder"]);
  });

  it("removing the active responder reassigns to the first remaining member", () => {
    const s = useAgentRoomStore.getState();
    s.addMember("coder");
    s.addMember("writer");
    useAgentRoomStore.getState().setResponder("writer");
    useAgentRoomStore.getState().removeMember("writer");
    expect(useAgentRoomStore.getState().members).toEqual(["coder"]);
    expect(useAgentRoomStore.getState().responder).toBe("coder");
  });

  it("persists members to localStorage", () => {
    useAgentRoomStore.getState().addMember("coder");
    expect(localStorage.getItem("hms_agent_room_members")).toContain("coder");
  });

  it("appendUser tags the message with the routed agent (isolated transcript)", () => {
    useAgentRoomStore.getState().appendUser("hi", "coder");
    const m = useAgentRoomStore.getState().messages.at(-1);
    expect(m?.role).toBe("user");
    expect(m?.agent).toBe("coder");
    expect(m?.content).toBe("hi");
  });

  it("appendDelta stamps the assistant bubble with the turn's agent", () => {
    const s = useAgentRoomStore.getState();
    s.beginTurn("run1", "writer");
    s.appendDelta("answer");
    const m = useAgentRoomStore.getState().messages.find((x) => x.role === "assistant");
    expect(m?.agent).toBe("writer");
  });

  it("clearConversation empties the room transcript", () => {
    const s = useAgentRoomStore.getState();
    s.appendUser("hi", "coder");
    useAgentRoomStore.getState().clearConversation();
    expect(useAgentRoomStore.getState().messages).toEqual([]);
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
