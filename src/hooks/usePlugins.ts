/**
 * react-query hooks for plugins.
 *
 * Pulls from upstream's plugin hub endpoint, which exposes the rich
 * metadata (source, runtime_status, can_remove, can_update_git, etc.)
 * needed for the Plugins panel.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

// ── Types ────────────────────────────────────────────────────────────

export interface Plugin {
  name: string;
  version: string;
  description: string;
  source: string;
  /** "enabled" | "disabled" | "inactive" */
  runtime_status: string;
  has_dashboard_manifest: boolean;
  dashboard_manifest: Record<string, unknown> | null;
  path: string;
  can_remove: boolean;
  can_update_git: boolean;
  auth_required: boolean;
  auth_command: string;
  user_hidden: boolean;
}

export interface ProviderOption {
  name: string;
  description: string;
}

export interface PluginsHubPayload {
  plugins: Plugin[];
  orphan_dashboard_plugins?: unknown[];
  providers?: {
    memory_provider?: string;
    memory_options?: ProviderOption[];
    context_engine?: string;
    context_options?: ProviderOption[];
  };
}

const LIST_KEY = ["plugins-hub"] as const;

// ── Hooks ────────────────────────────────────────────────────────────

export function usePlugins() {
  return useQuery<PluginsHubPayload>({
    queryKey: LIST_KEY,
    queryFn: () => api.get<PluginsHubPayload>("/api/dashboard/plugins/hub"),
    refetchInterval: 30_000,
    staleTime: 10_000,
    retry: 1,
  });
}

export function useEnablePlugin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api.json<{ ok: boolean; error?: string }>(
        `/api/dashboard/agent-plugins/${encodeURIComponent(name)}/enable`,
        "POST",
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

export function useDisablePlugin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api.json<{ ok: boolean; error?: string }>(
        `/api/dashboard/agent-plugins/${encodeURIComponent(name)}/disable`,
        "POST",
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

export function useUpdatePlugin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api.json<{ ok: boolean; error?: string }>(
        `/api/dashboard/agent-plugins/${encodeURIComponent(name)}/update`,
        "POST",
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

export function useSaveRuntimeProviders() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { memory_provider: string; context_engine: string }) =>
      api.json<{ ok: boolean }>("/api/plugins/runtime-providers", "PUT", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

export function useInstallPlugin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { identifier: string; force?: boolean; enable?: boolean }) =>
      api.json<{ ok: boolean; error?: string; name?: string }>(
        "/api/dashboard/agent-plugins/install",
        "POST",
        body,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

export function useUninstallPlugin() {
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
