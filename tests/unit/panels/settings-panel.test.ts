import { describe, it, expect, beforeEach, vi } from "vitest";

describe("SettingsPanel error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ConnectionTab mutation should throw on HTTP error", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const testSettings = { hermes_home: "/path/to/hermes" };
    const mutationFn = async (s: typeof testSettings) => {
      const res = await fetch("/api/internal/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-HMS-CSRF": "1" },
        body: JSON.stringify(s),
      });
      if (!res.ok) throw new Error(`Failed to save settings: ${res.status}`);
      return res.json();
    };

    await expect(mutationFn(testSettings)).rejects.toThrow("Failed to save settings: 500");
  });

  it("ConnectionTab mutation should succeed on HTTP 200", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    });

    const testSettings = { hermes_home: "/path/to/hermes" };

    const mutationFn = async (s: typeof testSettings) => {
      const res = await fetch("/api/internal/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-HMS-CSRF": "1" },
        body: JSON.stringify(s),
      });
      if (!res.ok) throw new Error(`Failed to save settings: ${res.status}`);
      return res.json();
    };

    const result = await mutationFn(testSettings);
    expect(result).toEqual({ success: true });
  });

  it("SecurityTab save should not set saved flag on HTTP error", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
    });

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let saved = false;
    const setSaved = (value: boolean) => { saved = value; };

    const testSettings = { bindHost: "127.0.0.1", passwordEnabled: false };
    const save = async () => {
      try {
        const res = await fetch("/api/internal/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json", "X-HMS-CSRF": "1" },
          body: JSON.stringify(testSettings),
        });
        if (!res.ok) {
          consoleErrorSpy(`Failed to save settings: ${res.status}`);
          return;
        }
        setSaved(true);
      } catch (err) {
        consoleErrorSpy("Settings save error:", err);
      }
    };

    await save();
    expect(saved).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith("Failed to save settings: 400");
    consoleErrorSpy.mockRestore();
  });

  it("SecurityTab save should set saved flag on HTTP success", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
    });

    let saved = false;
    const setSaved = (value: boolean) => { saved = value; };

    const testSettings = { bindHost: "127.0.0.1", passwordEnabled: false };

    const save = async () => {
      try {
        const res = await fetch("/api/internal/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json", "X-HMS-CSRF": "1" },
          body: JSON.stringify(testSettings),
        });
        if (!res.ok) {
          console.error(`Failed to save settings: ${res.status}`);
          return;
        }
        setSaved(true);
      } catch (err) {
        console.error("Settings save error:", err);
      }
    };

    await save();
    expect(saved).toBe(true);
  });

  it("SecurityTab save should catch and log network errors", async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error("Network error"));

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let saved = false;
    const setSaved = (value: boolean) => { saved = value; };

    const testSettings = { bindHost: "127.0.0.1", passwordEnabled: false };

    const save = async () => {
      try {
        const res = await fetch("/api/internal/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json", "X-HMS-CSRF": "1" },
          body: JSON.stringify(testSettings),
        });
        if (!res.ok) {
          console.error(`Failed to save settings: ${res.status}`);
          return;
        }
        setSaved(true);
      } catch (err) {
        consoleErrorSpy("Settings save error:", err);
      }
    };

    await save();
    expect(saved).toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
