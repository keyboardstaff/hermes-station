import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useElapsedSeconds, formatElapsed } from "@/hooks/useElapsedSeconds";

// The keyed registry must survive unmount/remount (a tool row scrolling out
// and back, a branch switch re-rendering the turn) — that is the whole point
// of porting desktop's activity timer.

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("formatElapsed", () => {
  it("renders seconds, then m:ss past a minute", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(59)).toBe("59s");
    expect(formatElapsed(60)).toBe("1:00");
    expect(formatElapsed(159)).toBe("2:39");
  });
});

describe("useElapsedSeconds", () => {
  it("ticks once per second while active", () => {
    const { result } = renderHook(() => useElapsedSeconds(true, "k1"));
    expect(result.current).toBe(0);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current).toBe(3);
  });

  it("keyed timers survive unmount/remount (registry start wins)", () => {
    const first = renderHook(() => useElapsedSeconds(true, "k2"));
    act(() => { vi.advanceTimersByTime(5000); });
    expect(first.result.current).toBe(5);
    first.unmount();

    // Remount later under the same key: elapsed continues, not restarts.
    act(() => { vi.advanceTimersByTime(4000); });
    const second = renderHook(() => useElapsedSeconds(true, "k2"));
    expect(second.result.current).toBe(9);
    second.unmount();
  });

  it("an explicit start (server started_at) overrides the registry", () => {
    const start = Date.now() - 42_000;
    const { result } = renderHook(() => useElapsedSeconds(true, "k3", start));
    expect(result.current).toBe(42);
  });

  it("does not tick when inactive", () => {
    const { result } = renderHook(() => useElapsedSeconds(false, "k4"));
    act(() => { vi.advanceTimersByTime(5000); });
    expect(result.current).toBe(0);
  });
});
