import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSessionsFilters } from "@/store/filters";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useI18n } from "@/i18n";
import SearchInput from "@/components/ui/SearchInput";
import SegmentedControl from "@/components/ui/SegmentedControl";

interface SessionRow {
  session_id: string;
  source?: string;
  profile?: string;
}

/**
 * Sessions toolbar — the view-controls band under the (title-only) page header.
 *
 * Left: Profile · Source filter groups (Profile first — it's the higher-level
 * scope) rendered with the shared `SegmentedControl`, the same control /logs
 * uses, so the tab styling is consistent across pages. Right: a result count +
 * the shared search field (same size as the Artifacts page).
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

  const opt = (vals: string[]) => vals.map((v) => ({ value: v, label: v === "all" ? s.all : v }));

  return (
    <div
      style={{
        display: "flex", alignItems: "center", gap: 'var(--hms-space-4)',
        padding: "6px 16px", flexShrink: 0, flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-4)', flex: 1, minWidth: 0, flexWrap: "wrap" }}>
        {/* Profile first — it's the higher-level scope. */}
        <Group label={s.profile}>
          <SegmentedControl<string>
            size="sm" ariaLabel={s.profile} value={profileFilter} onChange={setProfileFilter}
            options={opt(["all", ...profiles])}
          />
        </Group>
        <Group label={s.source}>
          <SegmentedControl<string>
            size="sm" ariaLabel={s.source} value={sourceFilter} onChange={setSourceFilter}
            options={opt(["all", ...sources])}
          />
        </Group>
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

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 'var(--hms-space-2)', flexShrink: 0 }}>
      <span style={{ fontSize: 'var(--hms-text-xs)', fontWeight: 600, color: "var(--hms-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </span>
      {children}
    </div>
  );
}
