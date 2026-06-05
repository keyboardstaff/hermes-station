import { describe, it, expect, beforeEach } from "vitest";
import { useAgentRoomStore } from "@/store/agentRoom";
import { parseMention } from "@/hooks/useAgentRoomStream";

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

describe("parseMention (@member routing)", () => {
  it("routes a leading @member and strips it from the body", () => {
    expect(parseMention("@coder do X", ["coder", "writer"])).toEqual({ agent: "coder", body: "do X" });
  });

  it("ignores an @mention that isn't a member", () => {
    expect(parseMention("@ghost hi", ["coder"])).toEqual({ agent: null, body: "@ghost hi" });
  });

  it("no mention → null agent + full body", () => {
    expect(parseMention("hello there", ["coder"])).toEqual({ agent: null, body: "hello there" });
  });

  it("routes a mention found mid-text (not only at the start)", () => {
    expect(parseMention("do X @writer", ["coder", "writer"])).toEqual({ agent: "writer", body: "do X" });
  });

  it("skips a non-member @ and routes the first @member", () => {
    expect(parseMention("@ghost @coder hi", ["coder"])).toEqual({ agent: "coder", body: "@ghost hi" });
  });
});
