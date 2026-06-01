import { describe, it, expect, beforeEach } from "vitest";
import { useChatStore } from "@/store/chat";

describe("chat store", () => {
  beforeEach(() => {
    useChatStore.setState({
      messages: [],
      activeRunId: null,
      activeTurnId: null,
      runningBySession: {},
      activeSessionId: null,
      pendingApproval: null,
      selectedModel: null,
    });
  });

  it("appendMessage adds a message", () => {
    const { appendMessage } = useChatStore.getState();
    appendMessage({ id: "1", role: "user", content: "hello", createdAt: 0 });
    expect(useChatStore.getState().messages).toHaveLength(1);
    expect(useChatStore.getState().messages[0].content).toBe("hello");
  });

  it("appendDelta creates assistant message on first delta", () => {
    const { appendDelta } = useChatStore.getState();
    appendDelta("Hi");
    const msgs = useChatStore.getState().messages;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("assistant");
    // Streaming text lives in segments[]; top-level content is legacy history rows.
    const seg = msgs[0].segments?.[0];
    expect(seg?.type).toBe("text");
    if (seg?.type === "text") expect(seg.content).toBe("Hi");
    expect(msgs[0].streaming).toBe(true);
  });

  it("appendDelta accumulates to existing streaming assistant message", () => {
    const { appendDelta } = useChatStore.getState();
    appendDelta("Hello");
    appendDelta(" world");
    const msgs = useChatStore.getState().messages;
    expect(msgs).toHaveLength(1);
    const seg = msgs[0].segments?.[0];
    expect(seg?.type).toBe("text");
    if (seg?.type === "text") expect(seg.content).toBe("Hello world");
  });

  it("clearMessages empties messages", () => {
    const { appendMessage, clearMessages } = useChatStore.getState();
    appendMessage({ id: "1", role: "user", content: "test", createdAt: 0 });
    clearMessages();
    expect(useChatStore.getState().messages).toHaveLength(0);
  });

  it("setActiveSession clears messages", () => {
    const { appendMessage, setActiveSession } = useChatStore.getState();
    appendMessage({ id: "1", role: "user", content: "test", createdAt: 0 });
    setActiveSession("new-session-id");
    expect(useChatStore.getState().messages).toHaveLength(0);
    expect(useChatStore.getState().activeSessionId).toBe("new-session-id");
  });

  it("appendToolCallPart inserts a tool segment, upsertToolCall patches it", () => {
    const { appendToolCallPart, upsertToolCall } = useChatStore.getState();
    appendToolCallPart({ id: "tc1", toolName: "bash", status: "running" });
    upsertToolCall({ id: "tc1", toolName: "bash", status: "done", result: "ok" });
    const msgs = useChatStore.getState().messages;
    const last = msgs[msgs.length - 1];
    const toolSeg = last.segments?.find((s) => s.type === "tool");
    expect(toolSeg?.type).toBe("tool");
    if (toolSeg?.type === "tool") {
      expect(toolSeg.tc.id).toBe("tc1");
      expect(toolSeg.tc.toolName).toBe("bash");
      expect(toolSeg.tc.status).toBe("done");
      expect(toolSeg.tc.result).toBe("ok");
    }
  });

  it("selectedModel can be set and read", () => {
    const { setSelectedModel } = useChatStore.getState();
    setSelectedModel("gpt-4");
    expect(useChatStore.getState().selectedModel).toBe("gpt-4");
  });

  it("appendApprovalNoticeSegment attaches to the last assistant message", () => {
    const { appendDelta, appendApprovalNoticeSegment } = useChatStore.getState();
    appendDelta("I will run the command.");
    appendApprovalNoticeSegment("once", "rm -rf /tmp/foo");
    const msgs = useChatStore.getState().messages;
    expect(msgs).toHaveLength(1);
    const noticeSegs = msgs[0].segments?.filter((s) => s.type === "approval_notice");
    expect(noticeSegs).toHaveLength(1);
    if (noticeSegs?.[0]?.type === "approval_notice") {
      expect(noticeSegs[0].choice).toBe("once");
      expect(noticeSegs[0].command).toBe("rm -rf /tmp/foo");
    }
    const textSegs = msgs[0].segments?.filter((s) => s.type === "text");
    expect(textSegs?.length).toBeGreaterThan(0);
  });

  it("clearStreamingContent removes text segments but preserves tool and approval_notice segments", () => {
    const { appendDelta, appendToolCallPart, appendApprovalNoticeSegment, clearStreamingContent } =
      useChatStore.getState();
    appendDelta("Let me fetch the data...");
    appendToolCallPart({ id: "tc1", toolName: "terminal", status: "running" });
    appendDelta(".../research");
    appendApprovalNoticeSegment("always", "curl https://api.example.com");

    clearStreamingContent();

    const msgs = useChatStore.getState().messages;
    const segs = msgs[msgs.length - 1].segments ?? [];
    expect(segs.filter((s) => s.type === "text")).toHaveLength(0);
    expect(segs.filter((s) => s.type === "tool")).toHaveLength(1);
    expect(segs.filter((s) => s.type === "approval_notice")).toHaveLength(1);
  });

  it("patchToolResultsById leaves approval_notice segments untouched", () => {
    const { appendDelta, appendToolCallPart, appendApprovalNoticeSegment, patchToolResultsById } =
      useChatStore.getState();
    appendDelta("Running the command.");
    appendToolCallPart({ id: "tc2", toolName: "bash", status: "running" });
    appendApprovalNoticeSegment("session", "npm install");

    patchToolResultsById({ tc2: "exit code 0" });

    const msgs = useChatStore.getState().messages;
    const segs = msgs[0].segments ?? [];
    const toolSeg = segs.find((s) => s.type === "tool");
    expect(toolSeg?.type).toBe("tool");
    if (toolSeg?.type === "tool") expect(toolSeg.tc.result).toBe("exit code 0");
    const noticeSeg = segs.find((s) => s.type === "approval_notice");
    expect(noticeSeg?.type).toBe("approval_notice");
    if (noticeSeg?.type === "approval_notice") {
      expect(noticeSeg.choice).toBe("session");
      expect(noticeSeg.command).toBe("npm install");
    }
  });

  it("setFinalContent replaces text segments with verified output", () => {
    const { appendDelta, appendToolCallPart, setFinalContent } = useChatStore.getState();
    appendDelta(".../research");
    appendToolCallPart({ id: "tc-final", toolName: "search", status: "running" });
    setFinalContent("The verified answer.");
    const msgs = useChatStore.getState().messages;
    const segs = msgs[msgs.length - 1].segments ?? [];
    const textSegs = segs.filter((s) => s.type === "text");
    const toolSegs = segs.filter((s) => s.type === "tool");
    expect(textSegs).toHaveLength(1);
    if (textSegs[0].type === "text") expect(textSegs[0].content).toBe("The verified answer.");
    expect(toolSegs).toHaveLength(1);
  });

  it("setFinalContent does nothing when text is empty", () => {
    const { appendDelta, setFinalContent } = useChatStore.getState();
    appendDelta("some text");
    setFinalContent("");
    const msgs = useChatStore.getState().messages;
    const segs = msgs[0].segments ?? [];
    const textSegs = segs.filter((s) => s.type === "text");
    expect(textSegs).toHaveLength(1);
    if (textSegs[0].type === "text") expect(textSegs[0].content).toBe("some text");
  });
});
