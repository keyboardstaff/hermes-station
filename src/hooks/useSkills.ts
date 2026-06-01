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
  return useQuery<Skill[]>({
    queryKey: LIST_KEY,
    queryFn: async () => {
      const data = await api.get<SkillsPayload>("/api/skills");
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
  return useQuery<Toolset[]>({
    queryKey: ["toolsets"],
    queryFn: async () => {
      const data = await api.get<{ toolsets: Toolset[] }>("/api/toolsets");
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

export function useSkillContent(name: string | null) {
  return useQuery({
    queryKey: ["skill-content", name],
    queryFn: async () => {
      if (!name) return { content: "", exists: false };
      try {
        const res = await api.get<{ content: string; exists: boolean }>(
          `/api/dashboard/skills/${encodeURIComponent(name)}/content`,
        );
        // api.get can return undefined on 204 / non-JSON — treat as "no content"
        return res ?? { content: "", exists: false };
      } catch {
        return { content: "", exists: false };
      }
    },
    enabled: name !== null,
    staleTime: 5 * 60 * 1000,
  });
}
