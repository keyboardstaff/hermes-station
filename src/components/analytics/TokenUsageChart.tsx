/**
 * Token usage time series (recharts LineChart).
 *
 * Stacked area lines for Input / Output / Cache tokens over the
 * selected time range. Responsive width; fixed 260 px height.
 */

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import type { DailyUsage } from "@/hooks/useAnalytics";

interface Props {
  data: DailyUsage[];
  labels: { input: string; output: string; cache: string };
}

function formatK(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(0) + "k";
  return String(n);
}

function formatDate(d: string): string {
  // "2025-05-10" → "5/10"
  const parts = d.split("-");
  return `${Number(parts[1])}/${Number(parts[2])}`;
}

export default function TokenUsageChart({ data, labels }: Props) {
  if (!data.length) return null;

  return (
    <div style={{ width: "100%", height: 260, overflow: "hidden" }}>
      <ResponsiveContainer minWidth={0} debounce={50}>
        <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--hms-border)" />
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            tick={{ fontSize: '0.625rem', fill: "var(--hms-text-muted)" }}
            stroke="var(--hms-border)"
          />
          <YAxis
            tickFormatter={formatK}
            tick={{ fontSize: '0.625rem', fill: "var(--hms-text-muted)" }}
            stroke="var(--hms-border)"
            width={48}
          />
          <Tooltip
            contentStyle={{
              background: "var(--hms-surface)",
              border: "1px solid var(--hms-border)",
              borderRadius: 6,
              fontSize: 'var(--hms-text-caption)',
            }}
            formatter={(v) => formatK(Number(v))}
            labelFormatter={(label) => formatDate(String(label))}
          />
          <Legend
            wrapperStyle={{ fontSize: 'var(--hms-text-xs)'}}
            iconType="circle"
            iconSize={8}
          />
          <Area
            type="monotone"
            dataKey="input_tokens"
            name={labels.input}
            stackId="1"
            stroke="var(--hms-accent)"
            fill="rgba(99,102,241,0.15)"
            strokeWidth={1.5}
          />
          <Area
            type="monotone"
            dataKey="output_tokens"
            name={labels.output}
            stackId="1"
            stroke="var(--hms-success)"
            fill="rgba(34,197,94,0.12)"
            strokeWidth={1.5}
          />
          <Area
            type="monotone"
            dataKey="cache_tokens"
            name={labels.cache}
            stackId="1"
            stroke="var(--hms-warning)"
            fill="rgba(245,158,11,0.10)"
            strokeWidth={1.5}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
