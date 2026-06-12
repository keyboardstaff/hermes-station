/**
 * react-query hooks for skills.
 *
 * Single station-native surface ``GET /api/skills`` — mirrors upstream's
 * ``_find_all_skills`` + disabled set and attaches a correct ``source``
 * derived in-process (hub lock file → provenance, agent bundled set →
 * "bundled", else "user"). Replaces the old dashboard-skills × plugins-hub
 * merge that keyed on platform-plugin names and always yielded "unknown".
 *
 * Mutations still route through ``/api/dashboard/skills/toggle`` (toggle) and
 * ``/api/dashboard/agent-plugins/{name}`` (install/uninstall).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useScopeParam } from "@/hooks/useProfiles";

// ── Raw shape ────────────────────────────────────────────────────────

interface RawSkill {
  name: string;
  description: string;
  category: string | null;
  enabled: boolean;
  source: Skill["source"];
}

interface SkillsPayload {
  skills: RawSkill[];
}

// ── Public shape ─────────────────────────────────────────────────────

export type SkillSource = "bundled" | "user" | "community" | "hub" | "git" | "hf" | "unknown";

export interface Skill {
  name: string;
  description: string;
  category: string | null;
  enabled: boolean;
  source: SkillSource;
  /** Bundled skills are managed by sync and cannot be uninstalled. */
  can_remove: boolean;
}

const LIST_KEY = ["skills"] as const;

// ── List hook ────────────────────────────────────────────────────────

export function useSkills() {
  const profile = useScopeParam();
  return useQuery<Skill[]>({
    // Profile in the key so a view-scope switch refetches under that home.
    queryKey: [...LIST_KEY, profile ?? null],
    queryFn: async () => {
      const q = profile ? `?profile=${encodeURIComponent(profile)}` : "";
      const data = await api.get<SkillsPayload>(`/api/skills${q}`);
      const skills = data?.skills ?? [];
      return skills.map((s): Skill => ({
        name: s.name,
        description: s.description,
        category: s.category,
        enabled: s.enabled,
        source: s.source ?? "unknown",
        can_remove: s.source !== "bundled",
      }));
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
    retry: 1,
  });
}

// ── Toolsets ─────────────────────────────────────────────────────────

export interface Toolset {
  name: string;
  label: string;
  description: string;
  enabled: boolean;
  configured: boolean;
  tools: string[];
}

export function useToolsets() {
  const profile = useScopeParam();
  return useQuery<Toolset[]>({
    queryKey: ["toolsets", profile ?? null],
    queryFn: async () => {
      const q = profile ? `?profile=${encodeURIComponent(profile)}` : "";
      const data = await api.get<{ toolsets: Toolset[] }>(`/api/toolsets${q}`);
      return data?.toolsets ?? [];
    },
    staleTime: 30_000,
    retry: 1,
  });
}

// ── Mutations ────────────────────────────────────────────────────────

export function useToggleSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; enabled: boolean }) =>
      api.json<{ ok: boolean; name: string; enabled: boolean }>(
        "/api/dashboard/skills/toggle",
        "PUT",
        body,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

export function useInstallSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { identifier: string; force?: boolean; enable?: boolean }) =>
      api.json<{ ok: boolean; error?: string; name?: string; version?: string }>(
        "/api/dashboard/agent-plugins/install",
        "POST",
        body,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

export function useUninstallSkill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api.json<{ ok: boolean; error?: string }>(
        `/api/dashboard/agent-plugins/${encodeURIComponent(name)}`,
        "DELETE",
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

