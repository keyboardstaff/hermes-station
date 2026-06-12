// Wraps /api/discover/* in react-query + subscribes to the WS "discovery" channel
// so backend discovery.changed broadcasts invalidate the matching cache.

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useWSStore } from "@/store/ws";
import type { DiscoveryChangedMessage } from "@/lib/ws-types";

// Payload shapes mirror server/routes/plugins.py.

export interface DiscoveredPlatform {
  name: string;
  label: string;
  /** "builtin" | "plugin". */
  kind: string;
}

export interface DiscoveredSlashCommand {
  name: string;
  /** Usually empty server-side; SPA looks up slash.<name>.description in i18n. */
  description: string;
  /** "builtin" | "plugin". */
  source: string;
}

/** Upstream theme passed through from hermes_cli.web_server._BUILTIN_DASHBOARD_THEMES. */
export interface DiscoveredTheme {
  name: string;
  label?: string;
  description?: string;
  palette?: {
    background?: { hex: string; alpha: number };
    midground?: { hex: string; alpha: number };
    foreground?: { hex: string; alpha: number };
    warmGlow?: string;
    noiseOpacity?: number;
  };
  typography?: {
    fontSans?: string;
    fontMono?: string;
    fontDisplay?: string;
    fontUrl?: string;
    baseSize?: string;
    lineHeight?: string;
    letterSpacing?: string;
  };
  layout?: { radius?: string; density?: string };
  [key: string]: unknown;
}

const PLATFORMS_KEY = ["discover", "platforms"] as const;
const SLASH_KEY = ["discover", "slash-commands"] as const;
const THEMES_KEY = ["discover", "themes"] as const;

// 60s balances focus-refresh cost vs. WS push for real changes.
const STALE_TIME_MS = 60_000;

export function useDiscoverPlatforms() {
  return useQuery({
    queryKey: PLATFORMS_KEY,
    queryFn: () => api.get<{ platforms: DiscoveredPlatform[]; count: number }>(
      "/api/discover/platforms",
    ),
    staleTime: STALE_TIME_MS,
  });
}

export function useDiscoverSlashCommands() {
  return useQuery({
    queryKey: SLASH_KEY,
    queryFn: () => api.get<{ commands: DiscoveredSlashCommand[]; count: number }>(
      "/api/discover/slash-commands",
    ),
    staleTime: STALE_TIME_MS,
  });
}

/** Keep in sync with _BUILDERS in server/routes/plugins.py. */
const RESOURCE_TO_KEY: Record<string, readonly string[]> = {
  platforms: PLATFORMS_KEY,
  "slash-commands": SLASH_KEY,
  themes: THEMES_KEY,
};

/** Mount once inside <App>. Idempotent — duplicate subscribes are no-ops. */
export function useDiscoveryWatcher() {
  const qc = useQueryClient();
  useEffect(() => {
    const ws = useWSStore.getState();
    ws.subscribe("discovery");
    const off = ws.on<DiscoveryChangedMessage>("discovery.changed", (msg) => {
      const key = RESOURCE_TO_KEY[msg.resource];
      if (key) {
        qc.invalidateQueries({ queryKey: key });
      }
    });
    return () => {
      off();
      // Don't unsubscribe — other code may also listen on "discovery".
    };
  }, [qc]);
}
