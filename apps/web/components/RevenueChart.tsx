"use client";
// Routed revenue per window (one series, magnitude over time). Completed windows are ink; the window in
// progress is sand and labelled "in progress", because it isn't scored yet. Windows are labelled by
// their start time. A table view sits under the chart for screen readers and exact values.
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PROFILE } from "../lib/env";
import { fmtUsdc } from "../lib/format";

export interface BucketPoint {
  bucket: bigint;
  inflow: bigint;
  current: boolean;
}

const timeOf = (bucket: bigint) =>
  new Date(Number(bucket) * PROFILE.bucketSec * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

export function RevenueChart({ points, source }: { points: BucketPoint[]; source: string }) {
  const data = points.map((p) => ({
    label: timeOf(p.bucket),
    usdc: Number(p.inflow) / 1e6,
    current: p.current,
    raw: p.inflow,
  }));
  if (data.length === 0 || points.every((p) => p.inflow === 0n))
    return (
      <div className="rounded-xl border border-dashed border-sand-400 bg-sand-50 p-6 text-center text-sm text-subtle">
        No revenue yet. Open your payment link and pay yourself: the first bar appears here within about 30
        seconds.
      </div>
    );
  return (
    <figure>
      <figcaption className="mb-2 text-xs text-subtle">
        USDC received per {PROFILE.bucketSec / 60}-minute window, by start time ({source}). Dark bars are
        completed windows, which count for offers; the sand bar is the window in progress.
      </figcaption>
      <div style={{ width: "100%", height: 220, background: "var(--viz-surface)", borderRadius: 12 }}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 12, right: 12, bottom: 4, left: 4 }} barCategoryGap={4}>
            <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
            <XAxis
              dataKey="label"
              tick={{ fill: "var(--viz-axis)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "var(--viz-axis)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={56}
            />
            <Tooltip
              cursor={{ fill: "var(--viz-grid)", opacity: 0.5 }}
              contentStyle={{
                background: "var(--c-panel)",
                border: "1px solid var(--c-line)",
                borderRadius: 10,
                color: "var(--c-fg)",
              }}
              formatter={(_v, _n, item) => [
                `${fmtUsdc((item.payload as { raw: bigint }).raw)} USDC`,
                (item.payload as { current: boolean }).current ? "in progress" : "completed window",
              ]}
            />
            <Bar dataKey="usdc" radius={[6, 6, 0, 0]} maxBarSize={36} animationDuration={700}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.current ? "var(--viz-highlight)" : "var(--viz-series-1)"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-subtle">Table view</summary>
        <table className="mt-1 w-full">
          <thead>
            <tr className="text-left text-subtle">
              <th>Window starting</th>
              <th>Revenue (USDC)</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={String(p.bucket)}>
                <td className="font-mono">
                  {timeOf(p.bucket)}
                  {p.current ? " (in progress)" : ""}
                </td>
                <td className="font-mono">{fmtUsdc(p.inflow)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
