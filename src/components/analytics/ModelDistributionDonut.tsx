/**
 * Model distribution donut chart (recharts PieChart).
 *
 * Shows token usage breakdown by model. Colours are auto-assigned from
 * a palette that works in both light and dark themes.
 */

import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
} from "recharts";
import type { ModelUsage } from "@/hooks/useAnalytics";

interface Props {
  data: ModelUsage[];
  title: string;
}

const COLORS = [
  "#6366f1", "var(--hms-success)", "var(--hms-warning)", "var(--hms-error)", "#8b5cf6",
  "#06b6d4", "#ec4899", "#14b8a6", "#f97316", "#64748b",
];

function formatK(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(0) + "k";
  return String(n);
}

/** Shorten model names like "openai/gpt-4o-2024-05-13" → "gpt-4o" */
function shortModel(m: string): string {
  const last = m.split("/").pop() ?? m;
  // Strip date suffixes like -2024-05-13
  return last.replace(/-\d{4}-\d{2}-\d{2}$/, "");
}

export default function ModelDistributionDonut({ data, title }: Props) {
  if (!data.length) return null;

  const chartData = data.map((d) => ({
    name: shortModel(d.model),
    value: d.input_tokens + d.output_tokens,
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
              formatter={(v) => formatK(Number(v)) + " tokens"}
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
