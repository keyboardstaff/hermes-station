// Session mutations go through Station's profile-aware `/api/sessions/{id}`
// route (NOT the default-home dashboard proxy). The `?profile=` is the FIRST
// query param, so it must be `?`-prefixed; `default`/undefined omit it.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { json } = vi.hoisted(() => ({ json: vi.fn((..._args: unknown[]) => Promise.resolve({ ok: true })) }));
vi.mock("@/lib/api", () => ({ api: { json } }));

import { setSessionArchived, deleteSession, renameSession } from "@/lib/session-mutations";

beforeEach(() => json.mockClear());

describe("setSessionArchived", () => {
  it("PATCHes Station's route with {archived} and no profile param for default", () => {
    void setSessionArchived("run_a", true);
    expect(json).toHaveBeenCalledWith("/api/sessions/run_a", "PATCH", { archived: true });
  });

  it("omits the profile param for the literal 'default'", () => {
    void setSessionArchived("run_a", false, "default");
    expect(json).toHaveBeenCalledWith("/api/sessions/run_a", "PATCH", { archived: false });
  });

  it("adds `?profile=` (first param ⇒ `?`, not `&`) for a non-default profile", () => {
    void setSessionArchived("run_b", true, "creative");
    expect(json).toHaveBeenCalledWith("/api/sessions/run_b?profile=creative", "PATCH", { archived: true });
  });
});

describe("deleteSession", () => {
  it("DELETEs the profile-scoped Station route", () => {
    void deleteSession("run_c", "writer");
    expect(json).toHaveBeenCalledWith("/api/sessions/run_c?profile=writer", "DELETE");
  });

  it("encodes the session id and profile", () => {
    void deleteSession("run d", "a b");
    expect(json).toHaveBeenCalledWith("/api/sessions/run%20d?profile=a%20b", "DELETE");
  });
});

describe("renameSession", () => {
  it("PATCHes {title} with the profile param", () => {
    void renameSession("run_e", "New Title", "coder");
    expect(json).toHaveBeenCalledWith("/api/sessions/run_e?profile=coder", "PATCH", { title: "New Title" });
  });
});
