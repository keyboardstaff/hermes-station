import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

// MCP server management — the configured ``mcp_servers``
// block surfaced on the /skills page. Lists / toggles / adds / removes entries;
// catalog git-install stays in the CLI.

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
  return useQuery<{ servers: McpServer[]; path: string }>({
    queryKey: MCP_KEY,
    queryFn: () => api.get<{ servers: McpServer[]; path: string }>("/api/mcp/servers"),
    staleTime: 15_000,
    retry: 1,
  });
}

export function useToggleMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) =>
      api.json<{ ok: boolean }>(`/api/mcp/servers/${encodeURIComponent(name)}`, "PATCH", { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: MCP_KEY }),
  });
}

export function useAddMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AddMcpServer) =>
      api.json<{ ok: boolean; name: string }>("/api/mcp/servers", "POST", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: MCP_KEY }),
  });
}

export function useRemoveMcpServer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api.json<{ ok: boolean }>(`/api/mcp/servers/${encodeURIComponent(name)}`, "DELETE"),
    onSuccess: () => qc.invalidateQueries({ queryKey: MCP_KEY }),
  });
}
