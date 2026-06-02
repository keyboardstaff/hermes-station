import { describe, it, expect } from "vitest";
import { escapeHtml, buildSessionsPrintHtml } from "@/lib/export-pdf";
import type { MessageRow } from "@/lib/session-messages";

function row(role: string, content: MessageRow["content"]): MessageRow {
  return { id: 1, role, content, tool_calls: null, tool_name: null, tool_call_id: null, timestamp: 0 };
}

describe("escapeHtml", () => {
  it("escapes the HTML-significant characters", () => {
    expect(escapeHtml(`<script>"&"</script>`)).toBe("&lt;script&gt;&quot;&amp;&quot;&lt;/script&gt;");
  });
});

describe("buildSessionsPrintHtml", () => {
  it("renders one print section per session with role + content", () => {
    const html = buildSessionsPrintHtml([
      { id: "s1", messages: [row("user", "hi"), row("assistant", "hello")] },
    ]);
    expect(html).toContain("<section>");
    expect(html).toContain("Session s1");
    expect(html).toContain(">user<");
    expect(html).toContain("hi");
    expect(html).toContain("hello");
    expect(html.startsWith("<!doctype html>")).toBe(true);
  });

  it("escapes message content (no markup injection into the print window)", () => {
    const html = buildSessionsPrintHtml([
      { id: "s1", messages: [row("user", "<img src=x onerror=alert(1)>")] },
    ]);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("coerces non-string (multimodal array / null) content without throwing", () => {
    const html = buildSessionsPrintHtml([
      { id: "s1", messages: [row("user", [{ type: "text", text: "x" }]), row("assistant", null)] },
    ]);
    expect(html).toContain("Session s1");
    // array → JSON, null → empty; both escaped, neither throws.
    expect(html).toContain("type");
  });

  it("pluralizes the session count header", () => {
    expect(buildSessionsPrintHtml([{ id: "a", messages: [] }])).toContain("1 session<");
    expect(buildSessionsPrintHtml([
      { id: "a", messages: [] }, { id: "b", messages: [] },
    ])).toContain("2 sessions");
  });
});
