/**
 * Top skills list with call counts and proportional bars.
 *
 * Data comes from upstream ``/api/analytics/usage`` → ``skills.top_skills``.
 * When the upstream is too old (pre-v0.14) the array is empty and this
 * component renders nothing.
 */

import type { SkillUsage } from "@/hooks/useAnalytics";

interface Props {
  data: SkillUsage[];
}

export default function TopSkillsList({ data }: Props) {
  if (!data.length) return null;

  const max = Math.max(...data.map((d) => d.calls), 1);

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 'var(--hms-space-2)' }}>
        {data.map((s, i) => (
          <div
            key={`${s.name}-${i}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 'var(--hms-space-2)',
              fontSize: 'var(--hms-text-caption)',
            }}
          >
            <span
              style={{
                width: 18,
                textAlign: "right",
                color: "var(--hms-text-muted)",
                fontSize: '0.625rem',
                flexShrink: 0,
              }}
            >
              {i + 1}.
            </span>
            <span style={{ width: 130, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {s.name}
            </span>
            <div style={{ flex: 1, height: 6, borderRadius: 3, background: "var(--hms-border)", overflow: "hidden" }}>
              <div
                style={{
                  width: `${(s.calls / max) * 100}%`,
                  height: "100%",
                  borderRadius: 3,
                  background: "var(--hms-accent)",
                  transition: "width 300ms ease",
                }}
              />
            </div>
            <span
              style={{
                width: 40,
                textAlign: "right",
                color: "var(--hms-text-muted)",
                fontSize: 'var(--hms-text-xs)',
                flexShrink: 0,
              }}
            >
              {s.calls}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
