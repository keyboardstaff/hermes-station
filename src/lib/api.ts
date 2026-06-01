/** Fetch wrapper — auto-adds CSRF header, JSON content-type, and throws ApiError on non-2xx. */

const CSRF_HEADER = "X-HMS-CSRF";

export class ApiError extends Error {
  status: number;
  detail?: unknown;
  constructor(status: number, message: string, detail?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

export class NetworkError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "NetworkError";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this as any).cause = cause;
  }
}

async function _request<T>(
  path: string,
  init: RequestInit,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err));
    throw new NetworkError(
      `Upload request failed: ${msg}`,
      err,
    );
  }
  if (!res.ok) {
    let detail: unknown;
    try { detail = await res.json(); } catch { /* swallow */ }
    const msg = (detail && typeof detail === "object" && "detail" in detail
      ? String((detail as { detail: unknown }).detail)
      : `HTTP ${res.status}`);
    throw new ApiError(res.status, msg, detail);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("Content-Type") || "";
  if (!ct.includes("application/json")) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get<T>(path: string): Promise<T> {
    return _request<T>(path, { method: "GET" });
  },

  json<T>(
    path: string,
    method: "POST" | "PUT" | "PATCH" | "DELETE",
    body?: unknown,
  ): Promise<T> {
    const init: RequestInit = {
      method,
      headers: {
        [CSRF_HEADER]: "1",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    };
    return _request<T>(path, init);
  },

  /** Multipart POST; Content-Type omitted so browser writes multipart boundary.
   *  Extra fields are prepended so they arrive BEFORE the file part on the wire. */
  upload<T>(path: string, file: File, extra?: Record<string, string>): Promise<T> {
    const fd = new FormData();
    if (extra) for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    fd.append("file", file, file.name);
    return _request<T>(path, {
      method: "POST",
      headers: { [CSRF_HEADER]: "1" },
      body: fd,
    });
  },
};
