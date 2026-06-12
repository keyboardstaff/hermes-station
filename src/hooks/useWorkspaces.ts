import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface Workspace {
  id: string;
  name: string;
  path: string;
}

export interface WorkspacesData {
  active_id: string | null;
  workspaces: Workspace[];
}

const WS_KEY = ["files-workspaces"] as const;
export const TREE_KEY = "files-tree";

export function useWorkspaces() {
  return useQuery<WorkspacesData>({
    queryKey: WS_KEY,
    queryFn: () => api.get<WorkspacesData>("/api/files/workspaces"),
    staleTime: 60_000,
    retry: 1,
  });
}

