import { useEffect } from "react";
import { create } from "zustand";
import { api } from "@/lib/api";

/** Upstream-shim capability flags — see ``server/lib/upstream_shim.py``.
 *
 *  Boolean snapshot of which hermes-agent features are reachable. The
 *  SPA uses these to grey out (rather than hide) UI that needs a
 *  missing upstream API — so the layout stays stable and the user gets
 *  a clear "v0.14+ required" hint instead of silent disappearance.
 *
 *  IMPORTANT: every field is optional because older backends won't ship
 *  the ``flags`` block at all. Default to ``false`` on read.
 */
export interface CapabilityFlags {
  // Foundation
  agent_importable?: boolean;
  approval_4_choice?: boolean;
  session_db?: boolean;
  gateway_lifecycle?: boolean;
  base_platform_adapter?: boolean;

  // v0.14+ features
  handoff_supported?: boolean;
  subgoal_supported?: boolean;
  vision_analyze_tool?: boolean;
  x_search_tool?: boolean;
  platform_circuit_breaker?: boolean;
  cron_deliver_all?: boolean;
  pareto_code_router?: boolean;
  plugin_ctx_llm?: boolean;
  skills_hf_tap?: boolean;

  // Environment
  upstream_version?: string | null;
  python_version?: string;
  os_name?: string;
}

export interface CapabilityLimits {
  max_upload_bytes?: number;
  max_concurrent_runs?: number;
  upload_retention_days?: number;
}

export interface CapabilityResult {
  /** ``~/.hermes/config.yaml`` is readable. */
  fsReadable: boolean;
  /** ``run_agent.AIAgent`` could be imported from the host venv. */
  agentReady: boolean;
  /** Station-supervised Dashboard at ``dashboardUrl`` answered ``/api/status``. */
  dashboardReachable: boolean;
  /** In-process gateway is alive (currently mirrors ``agentReady``). */
  gatewayReachable: boolean;
  mode: "ready" | "degraded";
  reasons: string[];
  probedAt: number;
  /**fine-grained upstream feature flags. Missing on legacy backends. */
  flags?: CapabilityFlags;
  /** Operator-tunable limits from /settings → Advanced. */
  limits?: CapabilityLimits;
}

interface CapabilityStore {
  caps: CapabilityResult | null;
  loading: boolean;
  fetch: () => Promise<void>;
  reprobe: () => Promise<void>;
}

export const useCapabilityStore = create<CapabilityStore>((set) => ({
  caps: null,
  loading: false,

  fetch: async () => {
    set({ loading: true });
    try {
      const caps = await api.get<CapabilityResult>("/api/capabilities");
      set({ caps });
    } catch {
      /* ignore — badge stays on its last known state */
    } finally {
      set({ loading: false });
    }
  },

  reprobe: async () => {
    set({ loading: true });
    try {
      const caps = await api.json<CapabilityResult>("/api/reprobe", "POST");
      set({ caps });
    } catch {
      /* ignore */
    } finally {
      set({ loading: false });
    }
  },
}));

/**
 * Call once at the app root to keep capabilities fresh.
 * Polls every 10 s while the tab is visible; cleans up on unmount.
 * Replaces the old module-level ``setInterval`` so the side effect
 * lives in the React lifecycle and is SSR-safe.
 */
export function useCapabilitiesPolling(intervalMs = 10_000): void {
  const fetch = useCapabilityStore((s) => s.fetch);
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") void fetch();
    };
    const id = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(id);
  }, [fetch, intervalMs]);
}
