/**
 * react-query hooks for the Files panel.
 *
 * Pulls from the station-owned ``/api/files/*`` surface; upstream
 * has no equivalent (file access is a station responsibility).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type FileRoot = "hermes" | "workspace";

export interface FsEntry {
  name: string;
  kind: "dir" | "file";
  size: number;
  mtime: number;
}

export interface TreePayload {
  root: FileRoot;
  path: string;
  entries: FsEntry[];
  error?: string;
}

export interface ReadPayloadText {
  root: FileRoot;
  path: string;
  binary: false;
  size: number;
  content: string;
  mtime: number;
}
export interface ReadPayloadBinary {
  root: FileRoot;
  path: string;
  binary: true;
  size: number;
  content_b64: string;
  mtime: number;
}
export type ReadPayload = ReadPayloadText | ReadPayloadBinary;

const TREE_KEY = "files-tree" as const;
const READ_KEY = "files-read" as const;

export function useFileTree(root: FileRoot, path: string) {
  return useQuery<TreePayload>({
    queryKey: [TREE_KEY, root, path],
    queryFn: () =>
      api.get<TreePayload>(
        `/api/files/tree?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`,
      ),
    staleTime: 10_000,
    retry: 1,
  });
}

export function useFileRead(
  root: FileRoot,
  path: string,
  enabled: boolean,
) {
  return useQuery<ReadPayload>({
    queryKey: [READ_KEY, root, path],
    queryFn: () =>
      api.get<ReadPayload>(
        `/api/files/read?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`,
      ),
    enabled,
    staleTime: 5_000,
    retry: 0,
  });
}

export function useWriteFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { root: FileRoot; path: string; content: string }) =>
      api.json<{ ok: boolean; size: number; mtime: number }>(
        "/api/files/write",
        "PUT",
        body,
      ),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: [TREE_KEY] });
      qc.invalidateQueries({ queryKey: [READ_KEY, vars.root, vars.path] });
    },
  });
}

export function useDeleteFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { root: FileRoot; path: string }) =>
      api.json<{ ok: boolean }>("/api/files/delete", "DELETE", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [TREE_KEY] });
    },
  });
}

export function useRenameFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { root: FileRoot; path: string; new_name: string }) =>
      api.json<{ ok: boolean; path: string }>("/api/files/rename", "POST", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [TREE_KEY] });
    },
  });
}

export function useCreateDir() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { root: FileRoot; path: string }) =>
      api.json<{ ok: boolean }>("/api/files/mkdir", "POST", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [TREE_KEY] });
    },
  });
}

export interface GitInfo {
  branch?: string;
  dirty?: number;
  ahead?: number;
  behind?: number;
}

export function useGitInfo(root: FileRoot, enabled = true) {
  return useQuery<GitInfo>({
    queryKey: ["files-git-info", root],
    queryFn: () => api.get<GitInfo>(`/api/files/git-info?root=${encodeURIComponent(root)}`),
    enabled,
    staleTime: 30_000,
    retry: 0,
  });
}

export interface LogEntry {
  hash: string;
  subject: string;
  author: string;
  date: string;
  relative: string;
}

export function useFileLog(root: FileRoot, path: string, enabled = true) {
  return useQuery<{ entries: LogEntry[] }>({
    queryKey: ["files-log", root, path],
    queryFn: () =>
      api.get<{ entries: LogEntry[] }>(
        `/api/files/log?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}`,
      ),
    enabled: enabled && !!path,
    staleTime: 60_000,
    retry: 0,
  });
}

export function useFileShow(root: FileRoot, path: string, ref: string, enabled = true) {
  return useQuery<{ content: string }>({
    queryKey: ["files-show", root, path, ref],
    queryFn: () =>
      api.get<{ content: string }>(
        `/api/files/show?root=${encodeURIComponent(root)}&path=${encodeURIComponent(path)}&ref=${encodeURIComponent(ref)}`,
      ),
    enabled: enabled && !!path && !!ref,
    staleTime: Infinity,
    retry: 0,
  });
}
