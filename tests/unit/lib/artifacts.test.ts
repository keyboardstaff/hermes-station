import { describe, it, expect } from "vitest";
import { extractArtifacts, classifyUrl } from "@/lib/artifacts";
import type { ChatMessage } from "@/lib/hermes-types";

const msg = (over: Partial<ChatMessage>): ChatMessage => ({
  id: "hist-1",
  role: "assistant",
  content: "",
  createdAt: 0,
  ...over,
});

describe("classifyUrl", () => {
  it("classifies images by extension", () => {
    expect(classifyUrl("https://x.com/a.png")).toBe("image");
    expect(classifyUrl("/api/upload/abc/photo.JPG")).toBe("image");
    expect(classifyUrl("data:image/png;base64,AAAA")).toBe("image");
  });
  it("classifies scheme URLs as links", () => {
    expect(classifyUrl("https://example.com/docs")).toBe("link");
    expect(classifyUrl("mailto:a@b.com")).toBe("link");
  });
  it("classifies bare paths as files", () => {
    expect(classifyUrl("./server/config.yaml")).toBe("file");
    expect(classifyUrl("/Users/me/notes.txt")).toBe("file");
  });
});

describe("extractArtifacts", () => {
  it("returns nothing for empty / plain text", () => {
    expect(extractArtifacts([msg({ content: "just some words" })])).toEqual([]);
  });

  it("extracts a markdown image with its alt as the label", () => {
    const a = extractArtifacts([msg({ content: "see ![a chart](https://x/chart.png)" })]);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ kind: "image", url: "https://x/chart.png", label: "a chart" });
  });

  it("classifies markdown links by URL (link vs local file)", () => {
    const a = extractArtifacts([
      msg({ content: "[docs](https://example.com/x) and [cfg](./a.yaml)" }),
    ]);
    expect(a.find((x) => x.url === "https://example.com/x")?.kind).toBe("link");
    expect(a.find((x) => x.url === "./a.yaml")?.kind).toBe("file");
  });

  it("extracts bare URLs and classifies image extensions", () => {
    const a = extractArtifacts([msg({ content: "raw https://x/y.gif and https://z/page" })]);
    expect(a.find((x) => x.url === "https://x/y.gif")?.kind).toBe("image");
    expect(a.find((x) => x.url === "https://z/page")?.kind).toBe("link");
  });

  it("does not let a bare-URL match swallow a trailing paren", () => {
    const a = extractArtifacts([msg({ content: "(see https://x/y.png)" })]);
    expect(a[0].url).toBe("https://x/y.png");
  });

  it("dedupes the same url across markdown-link and bare-url (md label wins)", () => {
    const a = extractArtifacts([
      msg({ content: "[Docs](https://example.com/d) then https://example.com/d again" }),
    ]);
    expect(a).toHaveLength(1);
    expect(a[0].label).toBe("Docs");
  });

  it("extracts image + file attachments, skipping empty placeholders", () => {
    const a = extractArtifacts([
      msg({
        role: "user",
        id: "hist-7",
        attachments: [
          { name: "shot.png", content: "/api/upload/abc/shot.png", isImage: true },
          { name: "report.pdf", content: "/api/upload/abc/report.pdf", isImage: false },
          { name: "ghost", content: "", isImage: true },
        ],
      }),
    ]);
    expect(a.map((x) => x.kind).sort()).toEqual(["file", "image"]);
    expect(a.every((x) => x.url !== "")).toBe(true);
  });

  it("extracts written paths from file-writing tool calls", () => {
    const a = extractArtifacts([
      msg({
        segments: [
          { type: "tool", tc: { id: "t1", toolName: "write_file", status: "done", preview: "src/app.ts" } },
          { type: "tool", tc: { id: "t2", toolName: "read_file", status: "done", preview: "src/other.ts" } },
        ],
      }),
    ]);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ kind: "file", url: "src/app.ts" });
  });

  it("carries the numeric row id for jump-to-chat (user + run ids)", () => {
    const a = extractArtifacts([
      msg({ id: "hist-12", role: "user", content: "look https://x/y.png" }),
      msg({ id: "hist-run-34", content: "[ref](https://z/page)" }),
    ]);
    expect(a.find((x) => x.url === "https://x/y.png")?.messageRowId).toBe(12);
    expect(a.find((x) => x.url === "https://z/page")?.messageRowId).toBe(34);
  });
});
