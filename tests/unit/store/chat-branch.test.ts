import { describe, it, expect, beforeEach } from "vitest";
import { useChatStore } from "@/store/chat";
import type { ChatMessage } from "@/lib/hermes-types";

const user = (id: string): ChatMessage => ({ id, role: "user", content: id, createdAt: 0 });
const asst = (id: string, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id, role: "assistant", content: id, createdAt: 0, ...over,
});

beforeEach(() => {
  useChatStore.setState({
    messages: [],
    activeTurnId: null,
    pendingBranchGroup: null,
    agentByRun: {},
  });
});

describe("supersedeTurn", () => {
  it("hides the turn's answers under a branch group and drops later turns", () => {
    useChatStore.setState({
      messages: [user("u0"), asst("a0"), user("u1"), asst("a1")],
    });
    useChatStore.getState().supersedeTurn(0);

    const s = useChatStore.getState();
    // Later turns dropped (the backend truncate removed them from state.db).
    expect(s.messages.map((m) => m.id)).toEqual(["u0", "a0"]);
    const a0 = s.messages[1];
    expect(a0.hidden).toBe(true);
    expect(a0.branchGroupId).toBe("branch-u0");
    // The next streaming bubble joins the same group.
    expect(s.pendingBranchGroup).toBe("branch-u0");
  });

  it("reuses an existing branch group on re-regenerate", () => {
    useChatStore.setState({
      messages: [user("u0"), asst("old", { branchGroupId: "g", hidden: true }), asst("new", { branchGroupId: "g" })],
    });
    useChatStore.getState().supersedeTurn(0);

    const s = useChatStore.getState();
    expect(s.pendingBranchGroup).toBe("g");
    expect(s.messages.filter((m) => m.role === "assistant").every((m) => m.hidden)).toBe(true);
  });

  it("no-ops when the index is not a user message", () => {
    useChatStore.setState({ messages: [user("u0"), asst("a0")] });
    useChatStore.getState().supersedeTurn(1);
    expect(useChatStore.getState().messages[1].hidden).toBeUndefined();
  });
});

describe("streaming bubble joins the armed branch group", () => {
  it("appendDelta tags the new assistant bubble with pendingBranchGroup", () => {
    useChatStore.setState({
      messages: [user("u0"), asst("old", { branchGroupId: "g", hidden: true })],
      pendingBranchGroup: "g",
      activeTurnId: "run1",
    });
    useChatStore.getState().appendDelta("hello");

    const created = useChatStore.getState().messages.at(-1)!;
    expect(created.id).toBe("turn-run1-assistant");
    expect(created.branchGroupId).toBe("g");
    expect(created.hidden).toBeUndefined();
  });
});

describe("applyBranchVisibility", () => {
  it("flips hidden so only the active path's group member is visible", () => {
    useChatStore.setState({
      messages: [
        user("u0"),
        asst("old", { branchGroupId: "g", hidden: true }),
        asst("new", { branchGroupId: "g" }),
      ],
    });
    // Switch to the old branch: the runtime's active path contains u0 + old.
    useChatStore.getState().applyBranchVisibility(["u0", "old"]);

    const s = useChatStore.getState();
    expect(s.messages.find((m) => m.id === "old")!.hidden).toBe(false);
    expect(s.messages.find((m) => m.id === "new")!.hidden).toBe(true);
  });

  it("never touches messages outside a branch group", () => {
    const msgs = [user("u0"), asst("a0")];
    useChatStore.setState({ messages: msgs });
    useChatStore.getState().applyBranchVisibility([]);
    // Same object references — nothing changed.
    expect(useChatStore.getState().messages[0]).toBe(msgs[0]);
    expect(useChatStore.getState().messages[1]).toBe(msgs[1]);
  });
});
