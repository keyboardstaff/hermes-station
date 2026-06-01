import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

export function useAddWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; path: string }) =>
      api.json<WorkspacesData>("/api/files/workspaces", "POST", body),
    onSuccess: (data) => {
      qc.setQueryData(WS_KEY, data);
      qc.invalidateQueries({ queryKey: [TREE_KEY] });
    },
  });
}

export function useRemoveWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { id: string }) =>
      api.json<WorkspacesData>("/api/files/workspaces", "DELETE", body),
    onSuccess: (data) => {
      qc.setQueryData(WS_KEY, data);
      qc.invalidateQueries({ queryKey: [TREE_KEY] });
    },
  });
}

export function useSetActiveWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { id: string | null }) =>
      api.json<WorkspacesData>("/api/files/workspaces/active", "PUT", body),
    onSuccess: (data) => {
      qc.setQueryData(WS_KEY, data);
      qc.invalidateQueries({ queryKey: [TREE_KEY] });
    },
  });
}
