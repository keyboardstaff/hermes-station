/**
 * consolidated react-query hooks for the Analytics panel.
 *
 * Each hook wraps a single upstream endpoint; the panel composes them.
 * All queries share a `days` parameter so switching the time-range
 * selector invalidates everything at once via the query-key prefix.
 */

import { useQuery } from "@tanstack/react-query";

// ── Types ────────────────────────────────────────────────────────────

export interface DailyUsage {
  date: string;
  input_tokens: number;
  output_tokens: number;
  cache_tokens?: number;
  sessions?: number;
}

export interface UsageTotals {
  total_input: number;
  total_output: number;
  total_sessions: number;
  total_estimated_cost?: number;
  total_actual_cost?: number;
}

export interface ModelUsage {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost?: number;
}

export interface SkillUsage {
  name: string;
  calls: number;
}

export interface UsageResponse {
  totals: UsageTotals;
  daily?: DailyUsage[];
  by_model?: ModelUsage[];
  skills?: { top_skills?: SkillUsage[] };
}

export interface SourceEntry {
  source: string;
  sessions: number;
  total_tokens: number;
}

export interface SourcesResponse {
  sources: SourceEntry[];
  period_days: number;
  error?: string;
}

// ── Shared fetcher ───────────────────────────────────────────────────

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

// ── Upstream field normalisation ─────────────────────────────────────
// The upstream hermes-agent uses slightly different field names than the
// interfaces above.  We normalise once here so all components stay clean.

function normaliseUsageResponse(raw: Record<string, unknown>): UsageResponse {
  // daily: upstream uses "day" instead of "date", and "cache_read_tokens"
  // instead of "cache_tokens".
  const daily: DailyUsage[] = ((raw.daily as unknown[] | undefined) ?? []).map((item) => {
    const r = item as Record<string, unknown>;
    return {
      date: (r.date ?? r.day ?? "") as string,
      input_tokens: (r.input_tokens as number) ?? 0,
      output_tokens: (r.output_tokens as number) ?? 0,
      cache_tokens: (r.cache_tokens ?? r.cache_read_tokens) as number | undefined,
      sessions: r.sessions as number | undefined,
    };
  });

  // skills.top_skills: upstream uses "skill" + "total_count" instead of
  // "name" + "calls".
  const rawSkills = (raw.skills as Record<string, unknown> | undefined) ?? {};
  const topSkills: SkillUsage[] = ((rawSkills.top_skills as unknown[] | undefined) ?? []).map(
    (item) => {
      const r = item as Record<string, unknown>;
      return {
        name: (r.name ?? r.skill ?? "") as string,
        calls: ((r.calls ?? r.total_count ?? 0) as number),
      };
    }
  );

  return {
    totals: (raw.totals as UsageTotals) ?? { total_input: 0, total_output: 0, total_sessions: 0 },
    daily,
    by_model: raw.by_model as ModelUsage[] | undefined,
    skills: { top_skills: topSkills },
  };
}

// ── Hooks ────────────────────────────────────────────────────────────

/**
 * Token usage over time + totals + model distribution + top skills.
 * All come from a single upstream endpoint.
 */
export function useAnalyticsUsage(days: number) {
  return useQuery<UsageResponse>({
    queryKey: ["analytics-usage", days],
    queryFn: async () => {
      const raw = await fetchJson<Record<string, unknown>>(
        `/api/dashboard/analytics/usage?days=${days}`
      );
      return normaliseUsageResponse(raw);
    },
    refetchInterval: 60_000,
    retry: 1,
    staleTime: 30_000,
  });
}

/**
 * Platform-source distribution — station-owned endpoint that
 * queries state.db directly.
 */
export function useAnalyticsSources(days: number) {
  return useQuery<SourcesResponse>({
    queryKey: ["analytics-sources", days],
    queryFn: () => fetchJson(`/api/analytics/sources?days=${days}`),
    refetchInterval: 60_000,
    retry: 1,
    staleTime: 30_000,
  });
}
