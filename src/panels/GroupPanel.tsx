import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  Users,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  ArrowRight,
  MessageSquare,
  GitBranch,
  Info,
} from "lucide-react";
import { useI18n } from "@/i18n";
import PageTopBar from "@/components/layout/PageTopBar";
import IconButton from "@/components/ui/IconButton";
import { api } from "@/lib/api";
import Button from "@/components/ui/Button";
import { useChatStore } from "@/store/chat";

/** Compact token count, e.g. 12.3k. */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function relTime(ts?: number): string {
  if (!ts) return "";
  const diff = Date.now() / 1000 - ts;
  if (diff < 3600) return `${Math.max(1, Math.round(diff / 60))}m`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h`;
  if (diff < 86400 * 7) return `${Math.round(diff / 86400)}d`;
  return new Date(ts * 1000).toLocaleDateString();
}

/** Inline messages + tokens + age stats for a session node. */
function SessionStats({ row }: { row: SessionRow }) {
  const tokens = (row.input_tokens ?? 0) + (row.output_tokens ?? 0);
  const parts: string[] = [];
  if (row.message_count) parts.push(`${row.message_count} msg`);
  if (tokens > 0) parts.push(`${fmtTokens(tokens)} tok`);
  const age = relTime(row.started_at);
  if (age) parts.push(age);
  if (parts.length === 0) return null;
  return (
    <span style={{ fontSize: '0.625rem', color: "var(--hms-text-muted)", whiteSpace: "nowrap" }}>
      {parts.join(" · ")}
    </span>
  );
}

/**
 * Group panel.
 *
 * Read-only visualisation of parent → child session hierarchies. The
 * underlying mechanism is upstream's session subagent / handoff
 * facilities; the panel itself doesn't create groups, only surfaces
 * them. Editing happens via the chat (slash commands) or the CLI.
 */

interface SessionRow {
  session_id: string;
  id?: string;
  title?: string;
  source?: string;
  model?: string;
  started_at?: number;
  ended_at?: number;
  parent_session_id?: string | null;
  input_tokens?: number;
  output_tokens?: number;
  message_count?: number;
}

interface SessionsPayload {
  sessions: SessionRow[];
}

export default function GroupPanel() {
  const { t } = useI18n();
  const g = t.group;
  const navigate = useNavigate();
  const setActiveSession = useChatStore((s) => s.setActiveSession);
  const openInChat = (sid: string) => {
    // Title is derived from the sessions cache by useActiveSessionTitle.
    setActiveSession(sid);
    navigate("/chat");
  };

  const sessionsQuery = useQuery<SessionsPayload>({
    queryKey: ["group-sessions"],
    queryFn: () => api.get<SessionsPayload>("/api/sessions?limit=500"),
    refetchInterval: 30_000,
    staleTime: 10_000,
    retry: 1,
  });

  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Build a parent → children map. Only sessions whose parent_session_id
  // resolves to another row become part of a group; orphans (parent missing
  // from the page) are still rendered as standalone for context.
  const { groups, allRows } = useMemo(() => {
    const rows = sessionsQuery.data?.sessions ?? [];
    const byId = new Map<string, SessionRow>();
    for (const r of rows) byId.set(r.session_id, r);

    // Set of session ids that are children (have a parent in this set OR
    // anywhere — we trust the field).
    const childIds = new Set<string>();
    const childrenByParent = new Map<string, SessionRow[]>();
    for (const r of rows) {
      const pid = r.parent_session_id;
      if (pid) {
        childIds.add(r.session_id);
        const list = childrenByParent.get(pid) ?? [];
        list.push(r);
        childrenByParent.set(pid, list);
      }
    }

    // A "group" is anchored at a row that has children but is NOT itself a
    // child (so we surface the top-most parent). If the actual top parent
    // isn't in the page, we still anchor at the highest available ancestor.
    const groupRoots: SessionRow[] = [];
    for (const r of rows) {
      const hasChildren = childrenByParent.has(r.session_id);
      const isChild = childIds.has(r.session_id);
      if (hasChildren && (!isChild || !byId.has(r.parent_session_id || ""))) {
        groupRoots.push(r);
      }
    }
    // Newest groups first.
    groupRoots.sort(
      (a, b) => (b.started_at ?? 0) - (a.started_at ?? 0),
    );

    return {
      groups: groupRoots.map((root) => ({
        root,
        children: childrenByParent.get(root.session_id) ?? [],
        childrenByParent,
      })),
      allRows: rows,
    };
  }, [sessionsQuery.data]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <PageTopBar
        title={t.nav.group}
        subtitle={g?.subtitle ?? "Multi-session collaboration — parent → child hierarchies"}
        actions={
          <IconButton title={g?.refresh ?? "Refresh"} onClick={() => sessionsQuery.refetch()}>
            <RefreshCw size={14} />
          </IconButton>
        }
      />
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: 'var(--hms-space-6)',
          display: "flex",
          flexDirection: "column",
          gap: 'var(--hms-space-4)',
        }}
      >

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 'var(--hms-space-2)',
          padding: "8px 12px",
          background: "rgba(99,102,241,0.06)",
          border: "1px solid rgba(99,102,241,0.18)",
          borderRadius: 6,
          fontSize: 'var(--hms-text-xs)',
          color: "var(--hms-text-muted)",
        }}
      >
        <Info size={12} style={{ color: "var(--hms-accent)" }} />
        <span>
          {g?.readOnlyHint ??
            "This view is read-only. To start a sub-agent session, use the chat slash commands (e.g. /handoff) or `hermes` CLI."}
        </span>
      </div>

      {sessionsQuery.isLoading && (
        <div style={{ padding: 'var(--hms-space-4)', fontSize: 'var(--hms-text-caption)', color: "var(--hms-text-muted)" }}>
          {g?.loading ?? "Loading…"}
        </div>
      )}
      {sessionsQuery.isError && (
        <div style={{ padding: 'var(--hms-space-4)', fontSize: 'var(--hms-text-caption)', color: "var(--hms-error-text)" }}>
          {g?.errorLoading ?? "Failed to load sessions."}
        </div>
      )}
      {!sessionsQuery.isLoading && !sessionsQuery.isError && groups.length === 0 && (
        <div
          style={{
            padding: 'var(--hms-space-6)',
            border: "1px dashed var(--hms-border)",
            borderRadius: 8,
            textAlign: "center",
            color: "var(--hms-text-muted)",
            fontSize: 'var(--hms-text-sm)',
          }}
        >
          {g?.noGroups ??
            "No multi-session groups in the recent history. Sub-agent sessions / handoffs will appear here."}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 'var(--hms-space-3)' }}>
        {groups.map(({ root, children, childrenByParent }) => {
          const isOpen = expanded.has(root.session_id);
          return (
            <div
              key={root.session_id}
              style={{
                padding: 'var(--hms-space-3)',
                border: "1px solid var(--hms-border)",
                borderRadius: 10,
                background: "var(--hms-surface)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 'var(--hms-space-2)',
                  marginBottom: isOpen ? 10 : 0,
                }}
              >
                <button
                  onClick={() =>
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(root.session_id)) next.delete(root.session_id);
                      else next.add(root.session_id);
                      return next;
                    })
                  }
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 'var(--hms-space-1)',
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    color: "var(--hms-text)",
                  }}
                >
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <Users size={14} style={{ color: "var(--hms-accent)" }} />
                  <span style={{ fontSize: 'var(--hms-text-body)', fontWeight: 600 }}>
                    {root.title || g?.untitled || "(untitled)"}
                  </span>
                </button>
                <span
                  style={{
                    fontSize: '0.625rem',
                    color: "var(--hms-text-muted)",
                    fontFamily: "monospace",
                  }}
                >
                  {root.session_id.slice(0, 12)}
                </span>
                <span style={{ marginLeft: "auto" }} />
                <SessionStats row={root} />
                <span
                  style={{
                    fontSize: '0.625rem',
                    padding: "2px 6px",
                    borderRadius: 4,
                    background: "rgba(99,102,241,0.12)",
                    color: "#4f46e5",
                    fontWeight: 600,
                  }}
                >
                  {children.length} {children.length === 1 ? (g?.childOne ?? "child") : (g?.children ?? "children")}
                </span>
                <Button size="sm" onClick={() => openInChat(root.session_id)} title={g?.openSession ?? "Open in chat"}>
                  <MessageSquare size={11} />
                  {g?.openSession ?? "Open"}
                </Button>
              </div>

              {isOpen && (
                <SessionTree
                  parent={root}
                  childrenByParent={childrenByParent}
                  depth={1}
                  onOpenSession={(sid) => openInChat(sid)}
                  labels={{
                    untitled: g?.untitled ?? "(untitled)",
                    openSession: g?.openSession ?? "Open",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Optional footnote: how many total parent-linked sessions seen */}
      {!sessionsQuery.isLoading && allRows.length > 0 && (
        <div style={{ fontSize: '0.625rem', color: "var(--hms-text-muted)", textAlign: "right" }}>
          {g?.footnote
            ?.replace("{groups}", String(groups.length))
            ?.replace("{total}", String(allRows.length)) ??
            `${groups.length} group(s) across ${allRows.length} recent sessions.`}
        </div>
      )}
      </div>
    </div>
  );
}

// ── Recursive child tree ─────────────────────────────────────────────

function SessionTree({
  parent,
  childrenByParent,
  depth,
  onOpenSession,
  labels,
}: {
  parent: SessionRow;
  childrenByParent: Map<string, SessionRow[]>;
  depth: number;
  onOpenSession: (sid: string, title?: string) => void;
  labels: { untitled: string; openSession: string };
}) {
  const children = childrenByParent.get(parent.session_id) ?? [];
  if (children.length === 0) return null;

  return (
    <div style={{ paddingLeft: depth * 12, display: "flex", flexDirection: "column", gap: 'var(--hms-space-1)' }}>
      {children.map((child) => (
        <div key={child.session_id}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 'var(--hms-space-2)',
              padding: "6px 8px",
              borderLeft: "2px solid var(--hms-border)",
              fontSize: 'var(--hms-text-caption)',
            }}
          >
            <ArrowRight size={11} style={{ color: "var(--hms-text-muted)" }} />
            <GitBranch size={11} style={{ color: "var(--hms-success)" }} />
            <span style={{ fontWeight: 500 }}>
              {child.title || labels.untitled}
            </span>
            <span
              style={{
                fontSize: '0.625rem',
                color: "var(--hms-text-muted)",
                fontFamily: "monospace",
              }}
            >
              {child.session_id.slice(0, 10)}
            </span>
            {child.model && (
              <span
                style={{
                  fontSize: '0.625rem',
                  color: "var(--hms-text-muted)",
                  fontFamily: "monospace",
                }}
              >
                · {child.model}
              </span>
            )}
            <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 'var(--hms-space-2)' }}>
              <SessionStats row={child} />
              <Button
                size="sm"
                onClick={() => onOpenSession(child.session_id, child.title)}
                title={labels.openSession}
                style={{ padding: "2px 8px", fontSize: '0.625rem'}}
              >
                <MessageSquare size={10} />
              </Button>
            </span>
          </div>
          <SessionTree
            parent={child}
            childrenByParent={childrenByParent}
            depth={depth + 1}
            onOpenSession={onOpenSession}
            labels={labels}
          />
        </div>
      ))}
    </div>
  );
}

