import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useBreakpoint, useIsMobile } from "@/hooks/useBreakpoint";

/**
 * `useBreakpoint` keys the desktop / mobile layout switch.
 * If this test regresses the entire mobile rendering path is dead, so
 * we hold it to behavioural guarantees rather than implementation
 * details.
 */

interface FakeMQ {
  matches: boolean;
  media: string;
  listeners: Set<(e: { matches: boolean }) => void>;
  addEventListener: (type: "change", l: (e: { matches: boolean }) => void) => void;
  removeEventListener: (type: "change", l: (e: { matches: boolean }) => void) => void;
}

let mockResult: Record<string, boolean> = {};

function fakeMatchMedia(query: string): FakeMQ {
  const mq: FakeMQ = {
    matches: !!mockResult[query],
    media: query,
    listeners: new Set(),
    addEventListener(_type, l) { this.listeners.add(l); },
    removeEventListener(_type, l) { this.listeners.delete(l); },
  };
  return mq;
}

beforeEach(() => {
  mockResult = {};
  // jsdom ships a no-op matchMedia by default — replace with a programmable one.
  Object.defineProperty(window, "matchMedia", {
    value: vi.fn(fakeMatchMedia),
    writable: true,
    configurable: true,
  });
});

describe("useBreakpoint", () => {
  it("returns 'desktop' when no media query matches", () => {
    mockResult = {};
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe("desktop");
  });

  it("returns 'mobile' when the mobile query matches", () => {
    mockResult = { "(max-width: 960px)": true };
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe("mobile");
  });

  it("returns 'tablet' for the intermediate band", () => {
    mockResult = {
      "(max-width: 960px)": false,
      "(min-width: 961px) and (max-width: 1024px)": true,
    };
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current).toBe("tablet");
  });
});

describe("useIsMobile", () => {
  it("is true iff useBreakpoint reports mobile", () => {
    mockResult = { "(max-width: 960px)": true };
    const { result: mobile } = renderHook(() => useIsMobile());
    expect(mobile.current).toBe(true);

    mockResult = {};
    const { result: desktop } = renderHook(() => useIsMobile());
    expect(desktop.current).toBe(false);
  });
});
