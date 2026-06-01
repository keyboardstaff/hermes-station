import { describe, it, expect } from "vitest";
import type {
  RunInput,
  ContentPart,
  ComposerAttachment,
  ChatMessage,
  ToolCall,
} from "@/lib/hermes-types";

describe("RunInput", () => {
  it("accepts string input", () => {
    const input: RunInput = { input: "hello" };
    expect(typeof input.input).toBe("string");
  });

  it("accepts ContentPart[] input for multimodal", () => {
    const parts: ContentPart[] = [
      { type: "text", text: "what is in this image?" },
      { type: "image_url", image_url: { url: "data:image/png;base64,abc" } },
    ];
    const input: RunInput = { input: parts };
    expect(Array.isArray(input.input)).toBe(true);
  });

  it("accepts optional provider and model", () => {
    const input: RunInput = { input: "hi", provider: "anthropic", model: "gpt-4" };
    expect(input.provider).toBe("anthropic");
    expect(input.model).toBe("gpt-4");
  });
});

describe("ComposerAttachment", () => {
  it("image attachment has isImage=true", () => {
    const att: ComposerAttachment = {
      id: "1",
      name: "photo.png",
      mimeType: "image/png",
      content: "data:image/png;base64,abc",
      isImage: true,
    };
    expect(att.isImage).toBe(true);
  });

  it("text attachment has isImage=false", () => {
    const att: ComposerAttachment = {
      id: "2",
      name: "notes.txt",
      mimeType: "text/plain",
      content: "some text content",
      isImage: false,
    };
    expect(att.isImage).toBe(false);
  });
});

describe("ChatMessage", () => {
  it("user message shape", () => {
    const msg: ChatMessage = { id: "1", role: "user", content: "hi", createdAt: 123 };
    expect(msg.role).toBe("user");
    expect(msg.streaming).toBeUndefined();
  });

  it("assistant message with toolCalls", () => {
    const tc: ToolCall = { id: "tc1", toolName: "bash", status: "done", result: "ok" };
    const msg: ChatMessage = {
      id: "2", role: "assistant", content: "", createdAt: 0, toolCalls: [tc],
    };
    expect(msg.toolCalls?.[0].toolName).toBe("bash");
  });
});
