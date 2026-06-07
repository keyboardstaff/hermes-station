import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useScopeParam } from "@/hooks/useProfiles";

// MCP server management — the configured ``mcp_servers``
// block surfaced on the /skills page. Lists / toggles / adds / removes entries;
// catalog git-install stays in the CLI. Reads + writes are profile-scoped
// (Phase B): ?profile= targets the viewed profile's own config.yaml.

/** `?profile=<name>` for the current view-scope, or "" for the default home. */
function scopeQuery(profile?: string): string {
  return profile ? `?profile=${encodeURIComponent(profile)}` : "";
}

export interface McpServer {
  name: string;
  transport: "stdio" | "http";
  command: string | null;
  args: string[];
  url: string | null;
  auth: string | null;
  enabled: boolean;
}

export interface AddMcpServer {
  name: string;
  transport: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  auth?: "oauth";
}

const MCP_KEY = ["mcp-servers"] as const;

export function useMcpServers() {
  const profile = useScopeParam();
  return useQuery<{ servers: McpServer[]; path: string }>({
    queryKey: [...MCP_KEY, profile ?? null],
    queryFn: () =>
      api.get<{ servers: McpServer[]; path: string }>(`/api/mcp/servers${scopeQuery(profile)}`),
    staleTime: 15_000,
    retry: 1,
  });
}

export function useToggleMcpServer() {
  const qc = useQueryClient();
  const profile = useScopeParam();
  return useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) =>
      api.json<{ ok: boolean }>(
        `/api/mcp/servers/${encodeURIComponent(name)}${scopeQuery(profile)}`, "PATCH", { enabled },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: MCP_KEY }),
  });
}

export function useAddMcpServer() {
  const qc = useQueryClient();
  const profile = useScopeParam();
  return useMutation({
    mutationFn: (body: AddMcpServer) =>
      api.json<{ ok: boolean; name: string }>(`/api/mcp/servers${scopeQuery(profile)}`, "POST", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: MCP_KEY }),
  });
}

export function useRemoveMcpServer() {
  const qc = useQueryClient();
  const profile = useScopeParam();
  return useMutation({
    mutationFn: (name: string) =>
      api.json<{ ok: boolean }>(
        `/api/mcp/servers/${encodeURIComponent(name)}${scopeQuery(profile)}`, "DELETE",
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: MCP_KEY }),
  });
}
