import { api } from "@/lib/api";

/**
 * Profile-aware session mutations — all go through Station's own
 * `/api/sessions/{id}` route (NOT the `/api/dashboard/*` proxy). The proxy
 * targets only the default home's dashboard and its session PATCH rejects
 * `archived` (upstream allows just title/end_reason), so archive/delete of a
 * non-default-profile session there silently no-ops. Station's route is
 * profile-scoped via `?profile=` and supports archive.
 */

/** First (only) query param ⇒ a `?`-prefixed `profile`. `default`/empty omit it
 *  (the process/default home). */
function profileParam(profile?: string | null): string {
  return profile && profile !== "default" ? `?profile=${encodeURIComponent(profile)}` : "";
}

export function setSessionArchived(sessionId: string, archived: boolean, profile?: string | null): Promise<unknown> {
  return api.json(`/api/sessions/${encodeURIComponent(sessionId)}${profileParam(profile)}`, "PATCH", { archived });
}

export function deleteSession(sessionId: string, profile?: string | null): Promise<unknown> {
  return api.json(`/api/sessions/${encodeURIComponent(sessionId)}${profileParam(profile)}`, "DELETE");
}

export function renameSession(sessionId: string, title: string, profile?: string | null): Promise<unknown> {
  return api.json(`/api/sessions/${encodeURIComponent(sessionId)}${profileParam(profile)}`, "PATCH", { title });
}
