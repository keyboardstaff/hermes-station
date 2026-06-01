/**
 * Horizontal filters bar for /logs — rendered inside the PageTopBar context
 * row. Mirrors upstream's File / Level / Component / Lines segmented controls
 * plus an HMS-only keyword filter + follow toggle. One scrollable row.
 */
import SegmentedControl from "@/components/ui/SegmentedControl";
import SearchInput from "@/components/ui/SearchInput";
import {
  LOG_COMPONENTS, LOG_FILES, LOG_LEVEL_OPTIONS, LOG_LINE_OPTIONS,
  type LogComponent, type LogFile, type LogLevel, type LogLines,
  useLogsFilters,
} from "@/store/filters";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export default function LogsFilters() {
  const {
    file, component, level, lines, keyword, follow,
    setFile, setComponent, setLevel, setLines, setKeyword, setFollow,
  } = useLogsFilters();

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--hms-space-3)", overflowX: "auto" }}>
      <Group label="File">
        <SegmentedControl<LogFile>
          size="sm" ariaLabel="Log file" value={file} onChange={setFile}
          options={LOG_FILES.map((f) => ({ value: f, label: cap(f) }))}
        />
      </Group>
      <Group label="Level">
        <SegmentedControl<LogLevel>
          size="sm" ariaLabel="Log level" value={level} onChange={setLevel}
          options={LOG_LEVEL_OPTIONS.map((l) => ({ value: l, label: l }))}
        />
      </Group>
      <Group label="Component">
        <SegmentedControl<LogComponent>
          size="sm" ariaLabel="Component" value={component} onChange={setComponent}
          options={LOG_COMPONENTS.map((c) => ({ value: c, label: cap(c) }))}
        />
      </Group>
      <Group label="Lines">
        <SegmentedControl<LogLines>
          size="sm" ariaLabel="Line count" value={lines} onChange={setLines}
          options={LOG_LINE_OPTIONS.map((n) => ({ value: n, label: String(n) }))}
        />
      </Group>

      <SearchInput
        size="sm"
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        placeholder="filter…"
        style={{ minWidth: 160, flex: "0 1 220px" }}
      />

      <label style={{ display: "flex", alignItems: "center", gap: "var(--hms-space-2)", fontSize: "var(--hms-text-caption)", cursor: "pointer", color: "var(--hms-text-muted)", whiteSpace: "nowrap" }}>
        <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
        Follow tail
      </label>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--hms-space-2)", flexShrink: 0 }}>
      <span style={{ fontSize: "var(--hms-text-xs)", fontWeight: 600, color: "var(--hms-text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        {label}
      </span>
      {children}
    </div>
  );
}
