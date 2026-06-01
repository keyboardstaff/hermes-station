/**
 * Source (platform) distribution donut chart.
 *
 * Data comes from the station-owned ``/api/analytics/sources``
 * endpoint which queries state.db directly.
 */

import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from "recharts";
import type { SourceEntry } from "@/hooks/useAnalytics";

interface Props {
  data: SourceEntry[];
  title: string;
}

const COLORS = [
  "var(--hms-success)", "#6366f1", "var(--hms-warning)", "var(--hms-error)", "#8b5cf6",
  "#06b6d4", "#ec4899", "#14b8a6", "#f97316", "#64748b",
];

export default function SourceDistributionDonut({ data, title }: Props) {
  if (!data.length) return null;

  const chartData = data.map((d) => ({
    name: d.source || "unknown",
    value: d.sessions,
  }));

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 'var(--hms-text-caption)', fontWeight: 600, marginBottom: 8 }}>
        {title}
      </div>
      <div style={{ width: "100%", height: 220, overflow: "hidden" }}>
        <ResponsiveContainer minWidth={0} debounce={50}>
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={45}
              outerRadius={70}
              dataKey="value"
              paddingAngle={2}
              stroke="none"
            >
              {chartData.map((_entry, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: "var(--hms-surface)",
                border: "1px solid var(--hms-border)",
                borderRadius: 6,
                fontSize: 'var(--hms-text-caption)',
              }}
              formatter={(v) => Number(v) + " sessions"}
            />
            <Legend
              wrapperStyle={{ fontSize: '0.625rem'}}
              iconType="circle"
              iconSize={8}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
