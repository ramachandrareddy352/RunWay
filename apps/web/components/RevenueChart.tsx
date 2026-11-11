"use client";
// Routed revenue per bucket (one series, magnitude over time). Completed buckets are solid; the
// current bucket is drawn lighter and labelled "in progress", because it isn't scored yet.
// A table view sits under the chart for screen readers and exact values.
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtUsdc } from "../lib/format";

export interface BucketPoint {
  bucket: bigint;
  inflow: bigint;
  current: boolean;
}

export function RevenueChart({ points, source }: { points: BucketPoint[]; source: string }) {
  const data = points.map((p) => ({
    label: `#${p.bucket}`,
    usdc: Number(p.inflow) / 1e6,
    current: p.current,
    raw: p.inflow,
  }));
  if (data.length === 0) return <p className="text-sm text-subtle">No routed revenue yet.</p>;
  return (
    <figure>
      <figcaption className="mb-2 text-sm text-subtle">Routed revenue per bucket, USDC ({source})</figcaption>
      <div style={{ width: "100%", height: 220, background: "var(--viz-surface)", borderRadius: 8 }}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 12, right: 12, bottom: 4, left: 4 }} barCategoryGap={2}>
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
              cursor={{ fill: "var(--viz-grid)", opacity: 0.4 }}
              contentStyle={{
                background: "var(--c-panel)",
                border: "1px solid var(--c-line)",
                borderRadius: 8,
                color: "var(--c-fg)",
              }}
              formatter={(_v, _n, item) => [
                `${fmtUsdc((item.payload as { raw: bigint }).raw)} USDC`,
                (item.payload as { current: boolean }).current ? "in progress" : "inflow",
              ]}
            />
            <Bar dataKey="usdc" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.label} fill="var(--viz-series-1)" fillOpacity={d.current ? 0.35 : 1} />
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
              <th>Bucket</th>
              <th>Inflow (USDC)</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={String(p.bucket)}>
                <td className="font-mono">
                  {String(p.bucket)}
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
