import { describe, it, expect } from "vitest";
import { resolveRunProfile } from "@/lib/run-profile";

describe("resolveRunProfile (Phase B — run follows the current profile)", () => {
  it("an explicit override wins (agents-room @mention)", () => {
    expect(resolveRunProfile("coder", "creative", "writer")).toBe("coder");
  });

  it("an existing session runs in its own profile, not the current scope", () => {
    // You're viewing 'writer' but continuing a 'creative' session → stays creative.
    expect(resolveRunProfile(undefined, "creative", "writer")).toBe("creative");
  });

  it("a new chat runs in the current scope profile", () => {
    expect(resolveRunProfile(undefined, undefined, "creative")).toBe("creative");
  });

  it("omits the default home (backend runs on the process HERMES_HOME)", () => {
    expect(resolveRunProfile(undefined, undefined, "default")).toBeUndefined();
    expect(resolveRunProfile(undefined, "default", "creative")).toBeUndefined();
    expect(resolveRunProfile(undefined, undefined, undefined)).toBeUndefined();
    expect(resolveRunProfile(undefined, undefined, null)).toBeUndefined();
  });

  it("falls through empties to the next source", () => {
    expect(resolveRunProfile("", "", "creative")).toBe("creative");
    expect(resolveRunProfile(null, null, "creative")).toBe("creative");
  });
});
