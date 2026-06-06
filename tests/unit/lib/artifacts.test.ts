import { describe, it, expect } from "vitest";
import {
  collectArtifactsForSession,
  artifactKind,
  artifactLabel,
  looksLikeArtifact,
  type ArtifactMessage,
  type ArtifactSession,
} from "@/lib/artifacts";

const SESSION: ArtifactSession = { id: "s1", title: "My Session", updated_at: 1000 };
const collect = (messages: ArtifactMessage[]) => collectArtifactsForSession(SESSION, messages);

describe("classification helpers", () => {
  it("artifactKind: images by extension / data-url, paths as files, else links", () => {
    expect(artifactKind("https://x/a.png")).toBe("image");
    expect(artifactKind("data:image/png;base64,AA")).toBe("image");
    expect(artifactKind("/Users/me/report.pdf")).toBe("file");
    expect(artifactKind("./notes.txt")).toBe("file");
    expect(artifactKind("https://example.com/docs")).toBe("link");
  });

  it("looksLikeArtifact gates on scheme / extension / absolute-dotted path", () => {
    expect(looksLikeArtifact("https://example.com/page")).toBe(true);
    expect(looksLikeArtifact("/tmp/out.json")).toBe(true);
    expect(looksLikeArtifact("just words")).toBe(false);
    expect(looksLikeArtifact("/tmp/dir")).toBe(false); // no dot
  });

  it("artifactLabel uses the last url/path segment", () => {
    expect(artifactLabel("https://x.com/a/b/chart.png")).toBe("chart.png");
    expect(artifactLabel("/Users/me/deep/report.pdf")).toBe("report.pdf");
  });
});

describe("collectArtifactsForSession", () => {
  it("ignores user messages (only assistant + tool)", () => {
    expect(collect([{ role: "user", content: "see https://x/a.png" }])).toEqual([]);
  });

  it("extracts a markdown image from an assistant message", () => {
    const a = collect([{ role: "assistant", content: "here ![chart](https://x/chart.png)" }]);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ kind: "image", value: "https://x/chart.png", label: "chart.png" });
  });

  it("classifies http URLs as links (scheme wins) but image-extension URLs as images", () => {
    const a = collect([{ role: "assistant", content: "[docs](https://example.com/x.pdf) and https://z/y.gif" }]);
    // A remote .pdf over http is a *link* (only local paths become files).
    expect(a.find((x) => x.value === "https://example.com/x.pdf")?.kind).toBe("link");
    expect(a.find((x) => x.value === "https://z/y.gif")?.kind).toBe("image");
  });

  it("collects any bare http URL as a link", () => {
    const a = collect([{ role: "assistant", content: "visit https://example.com/about" }]);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ kind: "link", value: "https://example.com/about" });
  });

  it("extracts absolute file paths from text", () => {
    const a = collect([{ role: "assistant", content: "wrote /tmp/out/result.json now" }]);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ kind: "file", value: "/tmp/out/result.json" });
  });

  it("pulls path/url values out of tool-call args under artifact-ish keys", () => {
    const a = collect([
      {
        role: "assistant",
        content: "",
        tool_calls: [{ function: { name: "write_file", arguments: { path: "/src/app.ts", note: "ignore me" } } }],
      },
    ]);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ kind: "file", value: "/src/app.ts" });
  });

  it("mines artifact-shaped strings from a tool-result JSON body", () => {
    const a = collect([
      { role: "tool", content: JSON.stringify({ output_path: "/out/render.png", count: 3 }) },
    ]);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ kind: "image", value: "/out/render.png" });
  });

  it("dedupes the same value within a session and carries session attribution", () => {
    const a = collect([
      { role: "assistant", content: "![a](https://x/a.png) and again https://x/a.png", timestamp: 2000 },
    ]);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ sessionId: "s1", sessionTitle: "My Session", timestamp: 2_000_000 });
  });

  it("falls back to the session timestamp (ms) when a message has none", () => {
    const a = collect([{ role: "assistant", content: "![a](https://x/a.png)" }]);
    expect(a[0].timestamp).toBe(1_000_000); // session.updated_at (1000s) → ms
  });

  it("carries the numeric message row id for jump-to-chat", () => {
    const a = collect([{ id: 42, role: "assistant", content: "![a](https://x/a.png)" }]);
    expect(a[0].messageRowId).toBe(42);
  });
});
