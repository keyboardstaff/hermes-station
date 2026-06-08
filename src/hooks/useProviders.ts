/**
 * +16 — shared react-query hooks for providers, models, and keys.
 *
 * Composer.ModelPicker and ModelsPanel both consume these hooks so
 * the same query keys de-duplicate in-flight fetches across the app.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useProfileScope, effectiveScopeName, ALL_PROFILES } from "@/store/profile-scope";
import { useActiveProfile } from "@/hooks/useProfiles";

// ── Types ────────────────────────────────────────────────────────────

export interface ProviderInfo {
  slug: string;
  name: string;
  models: string[];
  is_current: boolean;
  is_user_defined?: boolean;
  source: string;
  total_models?: number;
}

export interface ModelsPayload {
  providers: ProviderInfo[];
  model_default: string | null;
  provider: string;
  model: string;
}

/** Rich per-key metadata returned by ``GET /api/models/keys``. */
export interface KeyEntry {
  name: string;
  masked: string;
  set: boolean;
  category: string;
  description: string;
  url: string | null;
  is_password: boolean;
  advanced: boolean;
}

export interface KeysPayload {
  keys: KeyEntry[];
  error?: string;
}

/** Single auxiliary slot from ``GET /api/models/auxiliary``. */
export interface AuxSlot {
  task: string;
  provider: string;
  model: string;
  base_url?: string;
}

export interface AuxiliaryPayload {
  tasks: AuxSlot[];
  main: { provider?: string; model?: string };
  error?: string;
}

/** Body shape for ``POST /api/models/assign``. */
export interface AssignBody {
  scope: "main" | "auxiliary";
  provider: string;
  model: string;
  /** Empty string with ``scope=auxiliary`` applies to all 9 slots.
   *  ``"__reset__"`` resets every slot. */
  task?: string;
}

// ── Provider list ────────────────────────────────────────────────────

export function useProviders(opts?: { enabled?: boolean }) {
  return useQuery<ModelsPayload>({
    queryKey: ["models"],
    queryFn: () => api.get<ModelsPayload>("/api/models"),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
    enabled: opts?.enabled ?? true,
  });
}

export function useRefreshProviders() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["models"] });
}

// ── Auxiliary slots ──────────────────────────────────────────────────

export function useAuxiliary() {
  return useQuery<AuxiliaryPayload>({
    queryKey: ["models-auxiliary"],
    queryFn: () => api.get<AuxiliaryPayload>("/api/models/auxiliary"),
    staleTime: 30_000,
    retry: 1,
  });
}

// ── Model assignment ─────────────────────────────────────────────────

export function useAssignModel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AssignBody) =>
      api.json<{ ok: boolean }>("/api/models/assign", "POST", body),
    onSuccess: () => {
      // Invalidate both lists so the UI reflects the new assignment.
      qc.invalidateQueries({ queryKey: ["models"] });
      qc.invalidateQueries({ queryKey: ["models-auxiliary"] });
    },
  });
}

// ── Keys ─────────────────────────────────────────────────────────────

// The Keys surface is profile-scoped end-to-end: the backend reads/writes the
// selected profile's .env in-process (profile_home_override). ALL-profiles and
// the default scope both resolve to undefined → the process/active home, since
// env vars aren't meaningfully aggregatable across profiles.
function useKeysProfile(): string | undefined {
  const scope = useProfileScope((s) => s.scope);
  const { data: active } = useActiveProfile();
  return scope === ALL_PROFILES
    ? undefined
    : (effectiveScopeName(scope, active?.current) ?? undefined);
}

function profileQuery(profile: string | undefined): string {
  return profile ? `?profile=${encodeURIComponent(profile)}` : "";
}

export function useKeys() {
  const profile = useKeysProfile();
  return useQuery<KeysPayload>({
    queryKey: ["models-keys", profile ?? null],
    queryFn: () => api.get<KeysPayload>(`/api/models/keys${profileQuery(profile)}`),
    staleTime: 15_000,
    retry: 1,
  });
}

export function useRevealKey() {
  const profile = useKeysProfile();
  return useMutation({
    mutationFn: (name: string) =>
      api.json<{ name: string; value: string }>(
        `/api/models/keys/reveal${profileQuery(profile)}`,
        "POST",
        { name },
      ),
  });
}

export function useSetKey() {
  const qc = useQueryClient();
  const profile = useKeysProfile();
  return useMutation({
    mutationFn: (body: { name: string; value: string }) =>
      api.json<{ ok: boolean }>(`/api/models/keys${profileQuery(profile)}`, "PUT", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["models-keys"] });
      qc.invalidateQueries({ queryKey: ["models"] });
    },
  });
}

export function useDeleteKey() {
  const qc = useQueryClient();
  const profile = useKeysProfile();
  return useMutation({
    mutationFn: (name: string) =>
      api.json<{ ok: boolean }>(`/api/models/keys${profileQuery(profile)}`, "DELETE", { name }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["models-keys"] });
      qc.invalidateQueries({ queryKey: ["models"] });
    },
  });
}

// ── Provider connectivity test ───────────────────────────────────────

export function useTestProvider() {
  return useMutation({
    mutationFn: (provider: string) =>
      api.json<{ ok: boolean; provider: string; reason?: string; models_count?: number }>(
        `/api/models/test/${encodeURIComponent(provider)}`,
        "POST",
      ),
  });
}
