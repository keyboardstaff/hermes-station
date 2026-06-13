import { useEffect, useMemo, useState } from "react";
import { Plus, Zap, X } from "lucide-react";
import { useI18n } from "@/i18n";
import {
  KANBAN_COLUMNS,
  useKanbanBoards, useBoardTasks, useSetTaskStatus,
  useCreateTask, useCreateBoard, useNudgeDispatcher,
  type KanbanStatus, type KanbanTask,
} from "@/hooks/useKanban";
import PageTopBar from "@/components/layout/PageTopBar";
import IconButton from "@/components/ui/IconButton";
import SearchInput from "@/components/ui/SearchInput";
import Button from "@/components/ui/Button";

const STATUS_TONE: Record<string, string> = {
  triage: "var(--hms-muted)",
  todo: "var(--hms-muted)",
  scheduled: "var(--hms-accent)",
  ready: "var(--hms-warning)",
  running: "var(--hms-success)",
  blocked: "var(--hms-error)",
  review: "var(--hms-accent)",
  done: "var(--hms-success)",
  archived: "var(--hms-muted)",
};

export default function KanbanPanel() {
  const { t } = useI18n();
  const k = t.kanban;
  const boardsQuery = useKanbanBoards();
  const boards = boardsQuery.data?.boards ?? [];

  const [board, setBoard] = useState<string | null>(null);
  useEffect(() => {
    if (!board && boardsQuery.data?.current) setBoard(boardsQuery.data.current);
  }, [board, boardsQuery.data]);

  const [showArchived, setShowArchived] = useState(false);
  const tasksQuery = useBoardTasks(board, showArchived);
  const setStatus = useSetTaskStatus();
  const createBoard = useCreateBoard();
  const nudge = useNudgeDispatcher(board);

  const [query, setQuery] = useState("");
  const [tenant, setTenant] = useState("all");
  const [assignee, setAssignee] = useState("all");
  const [dragId, setDragId] = useState<string | null>(null);

  const tasks = useMemo(() => tasksQuery.data?.tasks ?? [], [tasksQuery.data]);
  const tenants = tasksQuery.data?.tenants ?? [];
  const assignees = useMemo(
    () => Array.from(new Set(tasks.map((x) => x.assignee).filter(Boolean) as string[])).sort(),
    [tasks],
  );

  const byStatus = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map: Record<string, KanbanTask[]> = {};
    for (const x of tasks) {
      if (tenant !== "all" && x.tenant !== tenant) continue;
      if (assignee !== "all" && x.assignee !== assignee) continue;
      if (q && !(x.title.toLowerCase().includes(q) || x.id.toLowerCase().includes(q))) continue;
      (map[x.status] ??= []).push(x);
    }
    return map;
  }, [tasks, query, tenant, assignee]);

  const clearFilters = () => { setQuery(""); setTenant("all"); setAssignee("all"); };

  const onDrop = (status: KanbanStatus) => {
    if (!dragId || !board) return;
    const task = tasks.find((x) => x.id === dragId);
    setDragId(null);
    // Running is claimed by the dispatcher — not a manual drop target.
    if (!task || status === "running" || task.status === "running" || task.status === status) return;
    setStatus.mutate({ taskId: dragId, board, status });
  };

  const onNewBoard = () => {
    const slug = window.prompt(k?.newBoardPrompt ?? "New board slug:");
    if (slug && slug.trim()) createBoard.mutate({ slug: slug.trim() });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <PageTopBar
        title={t.nav.kanban}
        context={
          // The kanban board is shared across profiles by upstream design, so
          // there's NO profile scope selector here — `assignee` is a card filter
          // (which agent owns a card), placed with the other filters.
          <div style={{ display: "flex", alignItems: "center", gap: "var(--hms-space-3)", flexWrap: "wrap" }}>
            <select
              value={board ?? ""}
              onChange={(e) => setBoard(e.target.value)}
              style={selectStyle}
              aria-label={k?.board ?? "Board"}
            >
              {boards.length === 0 && <option value="default">default</option>}
              {boards.map((b) => {
                const slug = (b.slug as string) ?? "default";
                return <option key={slug} value={slug}>{(b.display_name as string) || slug}</option>;
              })}
            </select>
            <SearchInput size="sm" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={k?.searchPlaceholder ?? "Filter cards…"} style={{ flex: "0 1 220px" }} />
            <select value={tenant} onChange={(e) => setTenant(e.target.value)} style={selectStyle} aria-label={k?.tenant ?? "Tenant"}>
              <option value="all">{k?.allTenants ?? "All tenants"}</option>
              {tenants.map((tn) => <option key={tn} value={tn}>{tn}</option>)}
            </select>
            <select value={assignee} onChange={(e) => setAssignee(e.target.value)} style={selectStyle} aria-label={k?.assignee ?? "Assignee"}>
              <option value="all">{k?.allAssignees ?? "All profiles"}</option>
              {assignees.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <label style={{ display: "flex", alignItems: "center", gap: "var(--hms-space-1)", fontSize: "var(--hms-text-caption)", color: "var(--hms-text-muted)", cursor: "pointer" }}>
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
              {k?.showArchived ?? "Show archived"}
            </label>
            <div style={{ flex: 1 }} />
            <Button size="sm" onClick={() => nudge.mutate()} disabled={nudge.isPending}>
              <Zap size={12} />{k?.nudge ?? "Nudge dispatcher"}
            </Button>
            {(query || tenant !== "all" || assignee !== "all") && (
              <Button size="sm" onClick={clearFilters}><X size={11} />{k?.clearFilters ?? "Clear filters"}</Button>
            )}
          </div>
        }
      />

      <div style={{ flex: 1, overflow: "auto", padding: "var(--hms-space-4)" }}>
        {/* New board lives in the content (not the topbar) — a board-level action. */}
        <div style={{ marginBottom: "var(--hms-space-3)" }}>
          <Button size="sm" variant="primary" onClick={onNewBoard}>
            <Plus size={12} />{k?.newBoard ?? "New board"}
          </Button>
        </div>
        {tasksQuery.isError ? (
          <div style={{ padding: "var(--hms-space-6)", color: "var(--hms-error-text)", fontSize: "var(--hms-text-sm)" }}>
            {k?.errorLoading ?? "Failed to load board."}
          </div>
        ) : (
          // 4-column grid → the 8 status columns lay out as two rows of four
          // (a 9th "archived" column wraps to a short third row).
          <div className="hms-kanban-grid">
            {(showArchived ? [...KANBAN_COLUMNS, "archived" as KanbanStatus] : KANBAN_COLUMNS).map((status) => (
              <Column
                key={status}
                status={status}
                tasks={byStatus[status] ?? []}
                board={board}
                label={k?.[`col_${status}` as keyof typeof k] as string | undefined ?? status}
                onDragStart={setDragId}
                onDrop={() => onDrop(status)}
                addLabel={k?.addCard ?? "New task title…"}
                createLabel={k?.create ?? "Create"}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Column ───────────────────────────────────────────────────────────

function Column({
  status, tasks, board, label, onDragStart, onDrop, addLabel, createLabel,
}: {
  status: KanbanStatus;
  tasks: KanbanTask[];
  board: string | null;
  label: string;
  onDragStart: (id: string) => void;
  onDrop: () => void;
  addLabel: string;
  createLabel: string;
}) {
  const [over, setOver] = useState(false);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const create = useCreateTask(board);
  const locked = status === "running";

  const submit = () => {
    if (!title.trim()) return;
    create.mutate({ title: title.trim(), triage: status === "triage" });
    setTitle("");
    setAdding(false);
  };

  return (
    <div
      onDragOver={(e) => { if (!locked) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={() => { setOver(false); onDrop(); }}
      style={{
        width: "100%",
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: "var(--hms-space-2)",
        padding: "var(--hms-space-2)",
        borderRadius: "var(--hms-radius-lg)",
        border: "1px solid var(--hms-border)",
        background: over ? "var(--hms-hover-bg)" : "transparent",
        transition: "background var(--hms-duration-fast)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--hms-space-2)", padding: "0 var(--hms-space-1)" }}>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: STATUS_TONE[status] ?? "var(--hms-muted)", flexShrink: 0 }} />
        <span style={{ flex: 1, fontSize: "var(--hms-text-sm)", fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: "var(--hms-text-xs)", color: "var(--hms-text-muted)" }}>{tasks.length}</span>
        {!locked && status !== "archived" && (
          <IconButton size="sm" title={createLabel} onClick={() => setAdding((a) => !a)}><Plus size={13} /></IconButton>
        )}
      </div>

      {adding && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--hms-space-1)" }}>
          <textarea
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } if (e.key === "Escape") setAdding(false); }}
            placeholder={addLabel}
            rows={2}
            style={{ width: "100%", resize: "vertical", padding: "6px 8px", fontSize: "var(--hms-text-sm)", background: "var(--hms-input-bg)", border: "1px solid var(--hms-border)", borderRadius: "var(--hms-radius-md)", color: "var(--hms-text)", outline: "none", boxSizing: "border-box" }}
          />
          <div style={{ display: "flex", gap: "var(--hms-space-1)" }}>
            <Button size="sm" variant="primary" onClick={submit} disabled={!title.trim() || create.isPending}>{createLabel}</Button>
            <Button size="sm" onClick={() => { setAdding(false); setTitle(""); }}>×</Button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--hms-space-2)" }}>
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} onDragStart={onDragStart} draggable={!locked} />
        ))}
      </div>
    </div>
  );
}

function TaskCard({ task, onDragStart, draggable }: { task: KanbanTask; onDragStart: (id: string) => void; draggable: boolean }) {
  return (
    <div
      draggable={draggable}
      onDragStart={() => onDragStart(task.id)}
      style={{
        border: "1px solid var(--hms-border)",
        borderLeft: `3px solid ${STATUS_TONE[task.status] ?? "var(--hms-muted)"}`,
        borderRadius: "var(--hms-radius-md)",
        background: "var(--hms-surface)",
        padding: "var(--hms-space-2)",
        cursor: draggable ? "grab" : "default",
        display: "flex",
        flexDirection: "column",
        gap: "var(--hms-space-1)",
      }}
    >
      <span style={{ fontSize: "var(--hms-text-sm)", color: "var(--hms-text)", lineHeight: 1.4 }}>{task.title}</span>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--hms-space-2)", fontSize: "0.625rem", color: "var(--hms-text-muted)" }}>
        {task.assignee && <span>@{task.assignee}</span>}
        {task.tenant && <span>· {task.tenant}</span>}
        <span style={{ marginLeft: "auto", fontFamily: "monospace" }}>{task.id.slice(0, 6)}</span>
      </div>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: "var(--hms-text-caption)",
  background: "var(--hms-input-bg)",
  border: "1px solid var(--hms-border)",
  borderRadius: "var(--hms-radius-md)",
  color: "var(--hms-text)",
  outline: "none",
};
