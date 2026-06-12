/**
 * react-query hooks for cron jobs.
 *
 * All cron data lives upstream in ``~/.hermes/cron/jobs.json`` and is
 * served by the Dashboard. The station proxies via
 * ``/api/dashboard/cron/*`` (transparent passthrough).
 *
 * Upstream realities (verified against ``hermes_cli/web_server.py``):
 *   • ``deliver`` is a single string (not an array)
 *   • No ``?q=`` search — filter client-side
 *   • No execution-history endpoint — only ``last_run_at`` per job
 *   • No watchdog endpoint — gateway health surfaces via /api/status
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useProfileScope, effectiveScopeName, ALL_PROFILES } from "@/store/profile-scope";
import { useActiveProfile } from "@/hooks/useProfiles";

// The upstream cron endpoints (proxied verbatim, query forwarded) all take a
// `?profile=` param — "all" for every profile, else a concrete profile's home.
// So cron is profile-scoped end-to-end by just threading the view-scope through.
function useCronScope() {
  const scope = useProfileScope((s) => s.scope);
  const { data: active } = useActiveProfile();
  const concrete = scope === ALL_PROFILES ? undefined : (effectiveScopeName(scope, active?.current) ?? undefined);
  return {
    // List: a concrete profile's jobs, or every profile's ("all").
    list: concrete ?? "all",
    // Create: a concrete profile (ALL scope → undefined → upstream "default").
    write: concrete,
  };
}

// ── Types ────────────────────────────────────────────────────────────

export type CronScheduleKind = "once" | "interval" | "cron";

export interface CronSchedule {
  kind: CronScheduleKind;
  /** ISO 8601 timestamp — only for ``kind: "once"``. */
  run_at?: string;
  /** Recurring interval — only for ``kind: "interval"``. */
  minutes?: number;
  /** 5-field cron expression — only for ``kind: "cron"``. */
  expr?: string;
  /** Human-readable display string set by upstream. */
  display?: string;
}

export interface CronJob {
  id: string;
  name: string;
  prompt: string;
  skills?: string[];
  skill?: string;
  model?: string | null;
  provider?: string | null;
  base_url?: string | null;
  script?: string | null;
  no_agent?: boolean;
  context_from?: string | string[] | null;

  schedule: CronSchedule;
  schedule_display?: string;
  repeat?: { times: number | null; completed: number };

  enabled: boolean;
  state: "scheduled" | "paused" | "completed" | "error" | string;
  paused_at?: string | null;
  paused_reason?: string | null;
  created_at?: string;
  next_run_at?: string | null;

  last_run_at?: string | null;
  last_status?: "ok" | "error" | null;
  last_error?: string | null;
  last_delivery_error?: string | null;

  /** Single string: "origin" | "local" | "<platform>". */
  deliver: string;
  origin?: string | null;
  enabled_toolsets?: string[] | null;
  workdir?: string | null;
}

/** Body for ``POST /api/dashboard/cron/jobs``. */
export interface CronCreateBody {
  prompt: string;
  schedule: string;     // upstream parses "every 30m" / "0 9 * * *" / "in 30m" etc.
  name?: string;
  deliver?: string;
}

/** Body for ``PUT /api/dashboard/cron/jobs/{id}``. */
export interface CronUpdateBody {
  updates: Partial<CronJob> & { schedule?: string | CronSchedule };
}

// ── Hooks ────────────────────────────────────────────────────────────

const LIST_KEY = ["cron-jobs"] as const;

export function useCronJobs() {
  const { list } = useCronScope();
  return useQuery<CronJob[]>({
    queryKey: [...LIST_KEY, list],
    queryFn: () => api.get<CronJob[]>(`/api/dashboard/cron/jobs?profile=${encodeURIComponent(list)}`),
    refetchInterval: 15_000,
    staleTime: 5_000,
    retry: 1,
  });
}

export function useCreateJob() {
  const qc = useQueryClient();
  const { write } = useCronScope();
  return useMutation({
    mutationFn: (body: CronCreateBody) =>
      api.json<CronJob>(
        `/api/dashboard/cron/jobs${write ? `?profile=${encodeURIComponent(write)}` : ""}`, "POST", body,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

export function useUpdateJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: CronUpdateBody }) =>
      api.json<CronJob>(`/api/dashboard/cron/jobs/${id}`, "PUT", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

export function usePauseJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.json<CronJob>(`/api/dashboard/cron/jobs/${id}/pause`, "POST"),
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

export function useResumeJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.json<CronJob>(`/api/dashboard/cron/jobs/${id}/resume`, "POST"),
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

export function useTriggerJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.json<CronJob>(`/api/dashboard/cron/jobs/${id}/trigger`, "POST"),
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

export function useDeleteJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.json<{ ok: boolean }>(`/api/dashboard/cron/jobs/${id}`, "DELETE"),
    onSuccess: () => qc.invalidateQueries({ queryKey: LIST_KEY }),
  });
}
