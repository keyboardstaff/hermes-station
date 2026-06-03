/**
 * react-query hooks for profile management — all endpoints in-process
 * under ``/api/profiles/*`` (station calls ``hermes_cli.profiles``
 * directly, no dashboard proxy hop).
 *
 * Active profile is the sticky ~/.hermes/active_profile file (upstream
 * ``{get,set}_active_profile``). Switching writes the sticky default;
 * it takes effect after the gateway restarts under the new HERMES_HOME,
 * which carries the station plugin with it.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

// ── Types ────────────────────────────────────────────────────────────

export interface ProfileInfo {
  name: string;
  path: string;
  is_default: boolean;
  gateway_running: boolean;
  model: string | null;
  provider: string | null;
  has_env: boolean;
  skill_count: number;
  alias_path: string | null;
  distribution_name: string | null;
  distribution_version: string | null;
  distribution_source: string | null;
  description: string;
}

export interface ProfilesPayload {
  profiles: ProfileInfo[];
}

export interface SoulPayload {
  content: string;
  exists: boolean;
}

export interface CreateProfileBody {
  name: string;
  clone_from?: string | null;
  no_skills?: boolean;
  model?: string | null;
  provider?: string | null;
}

const LIST_KEY = ["profiles"] as const;

// ── List / SOUL / CRUD ───────────────────────────────────────────────

export function useProfiles() {
  return useQuery<ProfilesPayload>({
    queryKey: LIST_KEY,
    queryFn: () => api.get<ProfilesPayload>("/api/profiles"),
    refetchInterval: 30_000,
    staleTime: 10_000,
    retry: 1,
  });
}

export function useProfileSoul(name: string | null) {
  return useQuery<SoulPayload>({
    queryKey: ["profile-soul", name],
    queryFn: () =>
      api.get<SoulPayload>(`/api/profiles/${encodeURIComponent(name!)}/soul`),
    enabled: !!name,
    staleTime: 5_000,
    retry: 1,
  });
}

export function useSetProfileSoul() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, content }: { name: string; content: string }) =>
      api.json<{ ok: boolean }>(
        `/api/profiles/${encodeURIComponent(name)}/soul`,
        "PUT",
        { content },
      ),
    onSuccess: (_data, vars) =>
      qc.invalidateQueries({ queryKey: ["profile-soul", vars.name] }),
  });
}

// ── Per-profile personality overlays (agent.personalities in config.yaml) ──
// Read-only: the defined overlays for a profile. The *active* overlay is a
// runtime, per-chat choice (the /personality picker), not a profile setting.

export interface Personality {
  name: string;
  description: string;
  prompt: string;
}

export function useProfilePersonalities(name: string | null) {
  return useQuery<{ personalities: Personality[] }>({
    queryKey: ["profile-personalities", name],
    queryFn: () =>
      api.get<{ personalities: Personality[] }>(
        `/api/profiles/${encodeURIComponent(name!)}/personalities`,
      ),
    enabled: !!name,
    staleTime: 10_000,
  });
}

// ── Per-profile memory docs (memories/MEMORY.md, memories/USER.md) ───
// Each profile is its own HERMES_HOME — these read/write that profile's
// own memory files, distinct from any other profile's.

export type ProfileMemoryTab = "memory" | "user";

export interface MemoryPayload {
  content: string;
  exists: boolean;
}

export function useProfileMemory(name: string | null, tab: ProfileMemoryTab) {
  return useQuery<MemoryPayload>({
    queryKey: ["profile-memory", name, tab],
    queryFn: () =>
      api.get<MemoryPayload>(
        `/api/profiles/${encodeURIComponent(name!)}/memory/${tab}`,
      ),
    enabled: !!name,
    staleTime: 5_000,
    retry: 1,
  });
}

export function useSetProfileMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, tab, content }: { name: string; tab: ProfileMemoryTab; content: string }) =>
      api.json<{ ok: boolean }>(
        `/api/profiles/${encodeURIComponent(name)}/memory/${tab}`,
        "PUT",
        { content },
      ),
    onSuccess: (_data, vars) =>
      qc.invalidateQueries({ queryKey: ["profile-memory", vars.name, vars.tab] }),
  });
}

// ── Per-profile gateway control (upstream multi-gateway model) ───────
// Each profile is a separate gateway service; start/stop shells out to
// `hermes -p <profile> gateway start|stop`. List refresh reflects status.

function useGatewayAction(action: "start" | "stop") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (profile: string) =>
      api.json<{ ok: boolean; reason?: string }>(
        `/api/lifecycle/gateway/${action}`,
        "POST",
        { profile },
      ),
    onSuccess: () => {
      // Status flips a moment after the detached process acts; refetch shortly.
      setTimeout(() => qc.invalidateQueries({ queryKey: LIST_KEY }), 2500);
    },
  });
}

export const useStartProfileGateway = () => useGatewayAction("start");
export const useStopProfileGateway = () => useGatewayAction("stop");

export function useCreateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProfileBody) =>
      api.json<{ ok: boolean; name: string; path: string }>(
        "/api/profiles",
        "POST",
        body,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

export function useRenameProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, new_name }: { name: string; new_name: string }) =>
      api.json<{ ok: boolean; name: string; path: string }>(
        `/api/profiles/${encodeURIComponent(name)}`,
        "PATCH",
        { new_name },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

export function useDeleteProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api.json<{ ok: boolean; path: string }>(
        `/api/profiles/${encodeURIComponent(name)}`,
        "DELETE",
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

// ── Active profile (sticky ~/.hermes/active_profile) ─────────────────

export interface ActiveProfilePayload {
  sticky: string;
  current: string;
  requires_restart: boolean;
}

const ACTIVE_KEY = ["profile-active"] as const;

export function useActiveProfile() {
  return useQuery<ActiveProfilePayload>({
    queryKey: ACTIVE_KEY,
    queryFn: () => api.get<ActiveProfilePayload>("/api/profiles/active"),
    staleTime: 30_000,
    retry: 1,
  });
}

/** Set the sticky active profile. The caller is responsible for triggering
 *  a gateway restart afterwards if ``requires_restart`` flips true. */
export function useSetActiveProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api.json<ActiveProfilePayload>("/api/profiles/active", "POST", { name }),
    onSuccess: (data) => qc.setQueryData(ACTIVE_KEY, data),
  });
}
