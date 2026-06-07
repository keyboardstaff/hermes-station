import { describe, it, expect, afterEach } from "vitest";
import {
  useProfileScope,
  ALL_PROFILES,
  effectiveScopeName,
  scopeProfileParam,
  filterSessionsByScope,
} from "@/store/profile-scope";

type Row = { session_id: string; profile?: string };
const rows: Row[] = [
  { session_id: "a", profile: "default" },
  { session_id: "b", profile: "creative" },
  { session_id: "c" }, // untagged → buckets as default
  { session_id: "d", profile: "creative" },
];

describe("profile-scope store", () => {
  afterEach(() => useProfileScope.setState({ scope: ALL_PROFILES }));

  it("setScope moves between a concrete profile, All, and follow-active", () => {
    useProfileScope.getState().setScope("creative");
    expect(useProfileScope.getState().scope).toBe("creative");
    useProfileScope.getState().setScope(ALL_PROFILES);
    expect(useProfileScope.getState().scope).toBe(ALL_PROFILES);
    useProfileScope.getState().setScope(null);
    expect(useProfileScope.getState().scope).toBeNull();
  });
});

describe("effectiveScopeName", () => {
  it("follows the active profile when scope is null", () => {
    expect(effectiveScopeName(null, "creative")).toBe("creative");
    expect(effectiveScopeName(null, null)).toBe("default");
    expect(effectiveScopeName(null, undefined)).toBe("default");
  });
  it("uses the concrete scope over the active profile", () => {
    expect(effectiveScopeName("work", "creative")).toBe("work");
    expect(effectiveScopeName("default", "creative")).toBe("default");
  });
  it("is null for ALL_PROFILES (no single profile)", () => {
    expect(effectiveScopeName(ALL_PROFILES, "creative")).toBeNull();
  });
});

describe("scopeProfileParam (?profile= value)", () => {
  it("omits the param for default / follow-active-default / all", () => {
    expect(scopeProfileParam(null, "default")).toBeUndefined();
    expect(scopeProfileParam("default", "creative")).toBeUndefined();
    expect(scopeProfileParam(ALL_PROFILES, "creative")).toBeUndefined();
    expect(scopeProfileParam(null, null)).toBeUndefined();
  });
  it("emits the concrete profile name otherwise", () => {
    expect(scopeProfileParam("creative", "default")).toBe("creative");
    expect(scopeProfileParam(null, "creative")).toBe("creative");
  });
});

describe("filterSessionsByScope", () => {
  it("returns everything for ALL_PROFILES", () => {
    expect(filterSessionsByScope(rows, ALL_PROFILES, "creative")).toHaveLength(4);
  });
  it("scopes to a concrete profile (untagged rows bucket as default)", () => {
    const def = filterSessionsByScope(rows, "default", "creative").map((r) => r.session_id);
    expect(def).toEqual(["a", "c"]);
    const creative = filterSessionsByScope(rows, "creative", "default").map((r) => r.session_id);
    expect(creative).toEqual(["b", "d"]);
  });
  it("follows the active profile when scope is null", () => {
    expect(filterSessionsByScope(rows, null, "creative").map((r) => r.session_id)).toEqual(["b", "d"]);
    expect(filterSessionsByScope(rows, null, "default").map((r) => r.session_id)).toEqual(["a", "c"]);
  });
});
