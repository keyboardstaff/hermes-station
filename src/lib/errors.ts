/** Error-shape helpers — narrow unknown to a human string in one line. */

import { ApiError } from "./api";

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  const s = typeof e === "string" ? e : (e == null ? "Unknown error" : String(e));
  return s.length > 200 ? s.slice(0, 200) + "…" : s;
}

/** Tries structured {error}/{detail} fields first, falls back to errorMessage. */
export function apiErrorDetail(e: unknown): string {
  if (e instanceof ApiError) {
    const detail = e.detail;
    if (detail && typeof detail === "object") {
      const obj = detail as Record<string, unknown>;
      const inner = obj.error ?? obj.detail;
      if (typeof inner === "string" && inner.trim()) return inner;
    }
    return e.message;
  }
  return errorMessage(e);
}

export function apiErrorStatus(e: unknown): number | null {
  return e instanceof ApiError ? e.status : null;
}
