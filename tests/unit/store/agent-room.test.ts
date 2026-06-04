import { describe, it, expect, beforeEach } from "vitest";
import { useAgentRoomStore } from "@/store/agentRoom";

describe("useAgentRoomStore (agents room roster)", () => {
  beforeEach(() => {
    localStorage.clear();
    useAgentRoomStore.setState({ members: [], responder: null });
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
});
