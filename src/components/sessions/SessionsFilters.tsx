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
    search, sourceFilter, profileFilter, view,
    setSearch, setDebouncedSearch, setSourceFilter, setProfileFilter, setView,
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
    <div className="hms-sessions-filters">
      <div className="hms-sessions-filters-groups">
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
        <Group label={s.viewLabel}>
          <SegmentedControl<"active" | "archived">
            size="sm" ariaLabel={s.viewLabel} value={view} onChange={setView}
            options={[
              { value: "active", label: s.viewActive },
              { value: "archived", label: s.viewArchived },
            ]}
          />
        </Group>
      </div>

      <div className="hms-sessions-filters-search">
        <span className="hms-sessions-filters-count">
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
    <div className="hms-sessions-filters-group">
      <span className="hms-sessions-filters-group-label">{label}</span>
      {children}
    </div>
  );
}
