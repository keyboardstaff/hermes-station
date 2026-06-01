import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useSessionsFilters } from "@/store/filters";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useEffect } from "react";

interface SessionRow {
  session_id: string;
  source?: string;
}

/**
 * Horizontal filters bar for /sessions — renders inline at the top of
 * the SessionsPanel. Replaces the legacy side column layout used by
 * the global SidePanel slot.
 */
export default function SessionsFilters() {
  const {
    search, sourceFilter,
    setSearch, setDebouncedSearch, setSourceFilter,
  } = useSessionsFilters();

  const debounced = useDebouncedValue(search, 400);
  useEffect(() => { setDebouncedSearch(debounced); }, [debounced, setDebouncedSearch]);

  const { data } = useQuery<{ sessions: SessionRow[] }>({
    queryKey: ["sessions-table-all"],
    queryFn: async () => {
      const res = await fetch("/api/sessions?limit=1000");
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    staleTime: 10_000,
  });
  const sources = Array.from(
    new Set((data?.sessions ?? []).map((s) => s.source).filter(Boolean))
  ) as string[];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 'var(--hms-space-3)',
        padding: "8px 16px",
        flexShrink: 0,
        flexWrap: "wrap",
      }}
    >
      {/* Search input — fixed width so the chip row keeps a consistent line */}
      <div style={{ position: "relative", minWidth: 200, flex: "0 1 280px" }}>
        <Search
          size={13}
          style={{
            position: "absolute",
            left: 8,
            top: "50%",
            transform: "translateY(-50%)",
            color: "var(--hms-text-muted)",
            pointerEvents: "none",
          }}
        />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search sessions..."
          style={{
            width: "100%",
            padding: "6px 8px 6px 28px",
            borderRadius: 6,
            border: "1px solid var(--hms-border)",
            background: "var(--hms-bg)",
            color: "var(--hms-text)",
            fontSize: 'var(--hms-text-caption)',
            outline: "none",
            boxSizing: "border-box",
          }}
        />
      </div>

      {/* Source chips */}
      <div style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-1)', flexWrap: "wrap" }}>
        {["all", ...sources].map((src) => {
          const active = sourceFilter === src;
          return (
            <button
              key={src}
              onClick={() => setSourceFilter(src)}
              style={{
                padding: "4px 10px",
                borderRadius: 999,
                border: `1px solid ${active ? "var(--hms-text-muted)" : "var(--hms-border)"}`,
                background: active ? "var(--hms-selected-bg)" : "transparent",
                color: active ? "var(--hms-text)" : "var(--hms-text-muted)",
                fontSize: 'var(--hms-text-xs)',
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                cursor: "pointer",
                fontWeight: active ? 600 : 400,
              }}
            >
              {src === "all" ? "ALL" : src.toUpperCase()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
