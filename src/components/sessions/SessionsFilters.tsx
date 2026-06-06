import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSessionsFilters } from "@/store/filters";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useI18n } from "@/i18n";
import SearchInput from "@/components/ui/SearchInput";

interface SessionRow {
  session_id: string;
  source?: string;
  profile?: string;
}

/**
 * Sessions toolbar — the view-controls band under the (title-only) page header.
 *
 * Left: two filter chip groups (Source · Profile). Right: a result count + the
 * shared search field (same size as the Artifacts page). The bulk-action /
 * selection controls live in a separate selection bar above the table, so the
 * header row carries only the title.
 */
export default function SessionsFilters({ total }: { total: number }) {
  const { t } = useI18n();
  const s = t.sessions;
  const {
    search, sourceFilter, profileFilter,
    setSearch, setDebouncedSearch, setSourceFilter, setProfileFilter,
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
  const rows = data?.sessions ?? [];
  const sources = Array.from(new Set(rows.map((r) => r.source).filter(Boolean))) as string[];
  const profiles = Array.from(new Set(rows.map((r) => r.profile || "default")));

  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 'var(--hms-space-4)',
        padding: "6px 16px", flexShrink: 0, flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-4)', flex: 1, minWidth: 0, flexWrap: "wrap" }}>
        <ChipGroup
          label={s.source}
          options={["all", ...sources]}
          value={sourceFilter}
          onChange={setSourceFilter}
          allLabel={s.all}
        />
        <span style={{ width: 1, height: 18, background: "var(--hms-border)", flexShrink: 0 }} aria-hidden="true" />
        <ChipGroup
          label={s.profile}
          options={["all", ...profiles]}
          value={profileFilter}
          onChange={setProfileFilter}
          allLabel={s.all}
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-3)', flexShrink: 0 }}>
        <span style={{ fontSize: 'var(--hms-text-caption)', color: "var(--hms-text-muted)", whiteSpace: "nowrap" }}>
          {total} {s.count}
        </span>
        <SearchInput
          size="sm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={s.search}
          style={{ width: 200 }}
        />
      </div>
    </div>
  );
}

function ChipGroup({
  label, options, value, onChange, allLabel,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
  allLabel: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-2)', minWidth: 0, flexWrap: "wrap" }}>
      <span style={{ fontSize: 'var(--hms-text-xs)', fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--hms-text-muted)", flexShrink: 0 }}>
        {label}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-1)', flexWrap: "wrap" }}>
        {options.map((opt) => {
          const active = value === opt;
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onChange(opt)}
              style={{
                padding: "3px 10px", borderRadius: 999,
                border: `1px solid ${active ? "var(--hms-accent)" : "var(--hms-border)"}`,
                background: active ? "var(--hms-accent-weak)" : "var(--hms-surface)",
                color: active ? "var(--hms-accent)" : "var(--hms-text-muted)",
                fontSize: 'var(--hms-text-caption)', cursor: "pointer",
                fontWeight: active ? 600 : 400,
              }}
            >
              {opt === "all" ? allLabel : opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}
