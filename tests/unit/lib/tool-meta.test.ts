import { describe, it, expect } from "vitest";
import { toolMeta, previewFromArgs } from "@/lib/tool-meta";
import { Globe, Terminal, Wrench } from "lucide-react";

describe("toolMeta", () => {
  it("returns the known mapping with done/pending titles", () => {
    const m = toolMeta("terminal");
    expect(m.done).toBe("Ran command");
    expect(m.pending).toBe("Running command");
    expect(m.icon).toBe(Terminal);
  });

  it("falls back to Browser/Web prefixed titles with the globe icon", () => {
    const m = toolMeta("browser_scroll_down");
    expect(m.done).toBe("Browser Scroll Down");
    expect(m.pending).toBe("Running browser scroll down");
    expect(m.icon).toBe(Globe);
  });

  it("humanizes unknown snake_case tools with the wrench fallback", () => {
    const m = toolMeta("kanban_move_card");
    expect(m.done).toBe("Kanban Move Card");
    expect(m.pending).toBe("Running kanban move card");
    expect(m.icon).toBe(Wrench);
  });
});

describe("previewFromArgs", () => {
  it("extracts the primary argument by key priority", () => {
    expect(previewFromArgs('{"query": "us stocks", "limit": 5}')).toBe("us stocks");
    expect(previewFromArgs({ command: "ls -la" })).toBe("ls -la");
  });

  it("joins string lists (e.g. web_extract urls) instead of dumping a repr", () => {
    expect(previewFromArgs('{"urls": ["https://a.com", "https://b.com"]}'))
      .toBe("https://a.com, https://b.com");
  });

  it("falls back to any string value, then the JSON dump", () => {
    expect(previewFromArgs('{"weird_key": "value"}')).toBe("value");
    expect(previewFromArgs('{"n": 42}')).toBe('{"n":42}');
    expect(previewFromArgs("plain text args")).toBe("plain text args");
    expect(previewFromArgs("")).toBe("");
  });
});
