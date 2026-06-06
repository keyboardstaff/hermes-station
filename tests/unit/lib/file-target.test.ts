import { describe, it, expect } from "vitest";
import { resolveFileTarget, hasFileExtension } from "@/lib/file-target";

const WS = [{ path: "/Users/me/Deploy" }];

describe("resolveFileTarget", () => {
  it("maps a path under ~/.hermes to the hermes root (relative path)", () => {
    expect(resolveFileTarget("/Users/me/.hermes/skills/foo.md", WS)).toEqual({ root: "hermes", path: "skills/foo.md" });
  });

  it("maps the hermes home itself to root with an empty path", () => {
    expect(resolveFileTarget("/Users/me/.hermes", WS)).toEqual({ root: "hermes", path: "" });
  });

  it("maps a path under a registered workspace to the workspace root", () => {
    expect(resolveFileTarget("/Users/me/Deploy/docs/ARCHITECTURE.md", WS)).toEqual({ root: "workspace", path: "docs/ARCHITECTURE.md" });
  });

  it("maps the workspace dir itself to an empty path", () => {
    expect(resolveFileTarget("/Users/me/Deploy", WS)).toEqual({ root: "workspace", path: "" });
  });

  it("strips a file:// scheme before resolving", () => {
    expect(resolveFileTarget("file:///Users/me/Deploy/a%20b.md", WS)).toEqual({ root: "workspace", path: "a b.md" });
  });

  it("returns null for a relative path with no cwd", () => {
    expect(resolveFileTarget("./docs/x.md", WS)).toBeNull();
  });

  it("resolves a relative path against the session cwd", () => {
    expect(resolveFileTarget("./docs/x.md", WS, "/Users/me/Deploy/hermes")).toEqual({ root: "workspace", path: "hermes/docs/x.md" });
  });

  it("collapses ../ when resolving against cwd", () => {
    expect(resolveFileTarget("../README.md", WS, "/Users/me/Deploy/hermes")).toEqual({ root: "workspace", path: "README.md" });
  });

  it("returns null when the cwd is outside both roots", () => {
    expect(resolveFileTarget("./x.md", WS, "/Users/me/elsewhere")).toBeNull();
  });

  it("returns null for an absolute path outside both roots", () => {
    expect(resolveFileTarget("/tmp/photo.jpg", WS)).toBeNull();
  });

  it("does not partial-match a sibling dir with a shared prefix", () => {
    expect(resolveFileTarget("/Users/me/DeployOther/x.md", WS)).toBeNull();
  });
});

describe("hasFileExtension", () => {
  it("is true for a file with an extension", () => {
    expect(hasFileExtension("/Users/me/.hermes/skills/foo.md")).toBe(true);
    expect(hasFileExtension("docs/x.JSON")).toBe(true);
  });
  it("is false for a directory-like path (no extension)", () => {
    expect(hasFileExtension("/Users/me/.hermes/skills/yuanbao")).toBe(false);
    expect(hasFileExtension("/Users/me/Deploy/")).toBe(false);
  });
});
