/**
 * Logs viewer. Filters render inline at the top of the panel via
 * `<LogsFilters />`; the global SidePanel side column is no longer used.
 *
 * Two data paths:
 *  - ``follow=true``  → EventSource against ``/api/fs/logs/{source}``
 *    streams live tail chunks.
 *  - ``follow=false`` → one-shot ``GET /api/fs/logs/{source}?tail=N``
 *    snapshot, never re-fetched until source/lines change.
 *
 * Level + keyword filters are applied at render time so toggling them
 * never re-opens the stream.
 */
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n";
import { sanitizeLogLine } from "@/lib/escape";
import { useLogsFilters } from "@/store/filters";
import LogsFilters from "@/components/logs/LogsFilters";
import PageTopBar from "@/components/layout/PageTopBar";
import { api } from "@/lib/api";

const LEVEL_COLORS: Record<string, string> = {
  ERROR: "var(--hms-error)",
  WARNING: "var(--hms-warning)",
  WARN: "var(--hms-warning)",
  INFO: "var(--hms-success)",
  DEBUG: "var(--hms-text-muted)",
};

function lineLevel(line: string): string {
  if (/\bERROR\b/i.test(line)) return "ERROR";
  if (/\bWARN(ING)?\b/i.test(line)) return "WARNING";
  if (/\bINFO\b/i.test(line)) return "INFO";
  return "DEBUG";
}

export default function LogsPanel() {
  const { t } = useI18n();
  const { file, component, level, lines: lineCap, keyword, follow } = useLogsFilters();
  const [lines, setLines] = useState<string[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Compose the upstream-aligned query string. ``level`` is also
  // applied client-side (cheap, instant), but we still send it so SSE
  // chunks are pre-filtered server-side and don't waste bandwidth.
  const queryString = `component=${encodeURIComponent(component)}&level=${encodeURIComponent(level)}`;

  // File / component / level / follow changes reset the buffer and
  // re-open the right channel. (line-cap is client-side only; we
  // already keep a 5× buffer for keyword tail filtering.)
  useEffect(() => {
    let cancelled = false;
    setLines([]);

    if (follow) {
      const es = new EventSource(`/api/fs/logs/${file}?${queryString}`);
      es.onmessage = (ev) => {
        if (cancelled) return;
        try {
          const chunk: string = JSON.parse(ev.data);
          if (!chunk) return;
          setLines((prev) => {
            const next = [...prev, ...chunk.split("\n").filter(Boolean)];
            // Keep a 5× buffer of the user-selected cap so the keyword
            // filter has something to chew on without an unbounded grow.
            return next.slice(-lineCap * 5);
          });
        } catch {
          /* malformed SSE chunk; ignore */
        }
      };
      es.onerror = () => {
        // EventSource auto-reconnects; nothing to do here.
      };
      return () => { cancelled = true; es.close(); };
    }

    // Snapshot mode.
    api
      .get<{ lines?: string[] }>(`/api/fs/logs/${file}?tail=${lineCap}&${queryString}`)
      .then((data) => {
        if (cancelled) return;
        setLines((data.lines ?? []).filter(Boolean).slice(-lineCap * 5));
      })
      .catch(() => { /* leave empty */ });
    return () => { cancelled = true; };
  }, [file, queryString, lineCap, follow]);

  // Auto-scroll when following.
  useEffect(() => {
    if (follow) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines, follow]);

  const kw = keyword.trim().toLowerCase();
  const filtered = lines.filter((ln) => {
    if (level !== "ALL" && lineLevel(ln) !== level) return false;
    if (kw && !ln.toLowerCase().includes(kw)) return false;
    return true;
  }).slice(-lineCap);

  return (
    <div
      style={{
        display: "flex", flexDirection: "column",
        height: "100%", overflow: "hidden",
      }}
    >
      <PageTopBar title={t.nav.logs} context={<LogsFilters />} />
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: 'var(--hms-space-3)',
          fontFamily: "monospace",
          fontSize: 'var(--hms-text-caption)',
          lineHeight: 1.6,
        }}
      >
        {filtered.length === 0 ? (
          <div style={{ color: "var(--hms-text-muted)", fontStyle: "italic" }}>
            No matching log lines.
          </div>
        ) : (
          filtered.map((line, i) => {
            const lvl = lineLevel(line);
            return (
              <div key={i} style={{ color: LEVEL_COLORS[lvl] ?? "var(--hms-text)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {sanitizeLogLine(line)}
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
