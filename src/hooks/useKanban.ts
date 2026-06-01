/**
 * react-query hooks for the Kanban panel.
 *
 * The station owns its own ``/api/kanban/*`` surface (queries
 * ``~/.hermes/kanban.db`` directly via the shim). Upstream does not
 * expose Kanban over HTTP; this is station-owned data.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type KanbanStatus =
  | "triage"
  | "todo"
  | "scheduled"
  | "ready"
  | "running"
  | "blocked"
  | "review"
  | "done"
  | "archived";

/** Column order shown on the board (archived is gated behind a toggle). */
export const KANBAN_COLUMNS: KanbanStatus[] = [
  "triage", "todo", "scheduled", "ready", "running", "blocked", "review", "done",
];

export interface KanbanTask {
  id: string;
  title: string;
  body: string | null;
  assignee: string | null;
  status: KanbanStatus | string;
  priority: number;
  created_by: string | null;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  workspace_kind: string;
  workspace_path: string | null;
  claim_lock: string | null;
  claim_expires: number | null;
  tenant: string | null;
  result: string | null;
  consecutive_failures: number;
  worker_pid: number | null;
  last_failure_error: string | null;
  last_heartbeat_at: number | null;
}

export interface KanbanBoard {
  slug: string;
  display_name?: string;
  archived?: boolean;
  /** Free-form extras upstream may add (created_at, description, …). */
  [key: string]: unknown;
}

export interface BoardsPayload {
  boards: KanbanBoard[];
  current: string;
  error?: string;
}

export interface BoardTasksPayload {
  board: string;
  tasks: KanbanTask[];
  by_status: Record<string, KanbanTask[]>;
  tenants: string[];
  stranded_in_ready: number;
  error?: string;
}

// ── Boards list ─────────────────────────────────────────────────────

export function useKanbanBoards() {
  return useQuery<BoardsPayload>({
    queryKey: ["kanban-boards"],
    queryFn: () => api.get<BoardsPayload>("/api/kanban/boards"),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });
}

// ── Board tasks ─────────────────────────────────────────────────────

export function useBoardTasks(slug: string | null, includeArchived = false) {
  return useQuery<BoardTasksPayload>({
    queryKey: ["kanban-board", slug, includeArchived],
    queryFn: () =>
      api.get<BoardTasksPayload>(
        `/api/kanban/board/${encodeURIComponent(slug!)}/tasks${
          includeArchived ? "?include_archived=1" : ""
        }`,
      ),
    enabled: !!slug,
    refetchInterval: 15_000,
    staleTime: 5_000,
    retry: 1,
  });
}

// ── Mutate status ───────────────────────────────────────────────────

export function useSetTaskStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      taskId,
      board,
      status,
    }: {
      taskId: string;
      board: string;
      status: KanbanStatus;
    }) =>
      api.json<{ ok: boolean; task: KanbanTask }>(
        `/api/kanban/tasks/${encodeURIComponent(taskId)}/status`,
        "PUT",
        { board, status },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kanban-board"] }),
  });
}

// ── Create task / board · nudge ─────────────────────────────────────

export interface CreateTaskBody {
  title: string;
  assignee?: string | null;
  skills?: string[];
  workspace_kind?: string;
  triage?: boolean;
}

export function useCreateTask(slug: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTaskBody) =>
      api.json<{ ok: boolean; task_id: string }>(
        `/api/kanban/board/${encodeURIComponent(slug!)}/tasks`, "POST", body,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kanban-board"] }),
  });
}

export function useCreateBoard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { slug: string; name?: string }) =>
      api.json<{ ok: boolean }>("/api/kanban/boards", "POST", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kanban-boards"] }),
  });
}

export function useNudgeDispatcher(slug: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.json<{ ok: boolean }>(`/api/kanban/board/${encodeURIComponent(slug!)}/nudge`, "POST"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["kanban-board"] }),
  });
}
