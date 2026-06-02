import { describe, it, expect } from "vitest";
import { escapeHtml, messageToMarkdown, extractMermaid, buildPrintDoc } from "@/lib/export-pdf";
import type { ChatMessage } from "@/lib/hermes-types";

describe("escapeHtml", () => {
  it("escapes the HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x">&</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  });
});

describe("messageToMarkdown (strips tool cards)", () => {
  it("keeps text segments and drops tool/approval segments", () => {
    const msg: ChatMessage = {
      id: "m1", role: "assistant", content: "", createdAt: 0,
      segments: [
        { type: "text", content: "Here is the answer." },
        { type: "tool", tc: { id: "t1", toolName: "bash", status: "done", result: "secret-output" } },
        { type: "text", content: "Done." },
      ],
    };
    const md = messageToMarkdown(msg);
    expect(md).toContain("Here is the answer.");
    expect(md).toContain("Done.");
    expect(md).not.toContain("secret-output");
    expect(md).not.toContain("bash");
  });

  it("falls back to content when there are no segments", () => {
    expect(messageToMarkdown({ id: "m", role: "user", content: "hi there", createdAt: 0 })).toBe("hi there");
  });

  it("returns empty for tool-role messages", () => {
    expect(messageToMarkdown({ id: "m", role: "tool", content: "tool blob", createdAt: 0 })).toBe("");
  });
});

describe("extractMermaid", () => {
  it("replaces a mermaid fence with a placeholder and extracts the source", () => {
    const { md, fences } = extractMermaid("before\n\n```mermaid\ngraph TD\nA-->B\n```\n\nafter");
    expect(fences).toEqual(["graph TD\nA-->B"]);
    expect(md).toContain("HMSMERMAIDPH0");
    expect(md).not.toContain("graph TD");
    expect(md).toContain("before");
    expect(md).toContain("after");
  });

  it("leaves non-mermaid markdown untouched", () => {
    const { md, fences } = extractMermaid("# title\n\n```js\nconst x = 1;\n```");
    expect(fences).toEqual([]);
    expect(md).toContain("```js");
  });
});

describe("buildPrintDoc", () => {
  it("wraps body in a standalone doc with a CJK-capable font + count", () => {
    const doc = buildPrintDoc("<section>x</section>", 1);
    expect(doc.startsWith("<!doctype html>")).toBe(true);
    expect(doc).toContain('<meta charset="utf-8">');
    expect(doc).toContain("PingFang SC"); // CJK fallback so Chinese renders
    expect(doc).toContain("1 session<");
    expect(doc).toContain("<section>x</section>");
  });

  it("pluralizes the session count", () => {
    expect(buildPrintDoc("", 3)).toContain("3 sessions");
  });
});
