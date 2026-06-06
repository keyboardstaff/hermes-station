import { describe, it, expect } from "vitest";
import { resolveFileTarget } from "@/lib/file-target";

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

  it("returns null for relative paths", () => {
    expect(resolveFileTarget("./docs/x.md", WS)).toBeNull();
  });

  it("returns null for an absolute path outside both roots", () => {
    expect(resolveFileTarget("/tmp/photo.jpg", WS)).toBeNull();
  });

  it("does not partial-match a sibling dir with a shared prefix", () => {
    expect(resolveFileTarget("/Users/me/DeployOther/x.md", WS)).toBeNull();
  });
});
