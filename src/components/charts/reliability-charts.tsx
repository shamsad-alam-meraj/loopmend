"use client";

import { Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const tooltip = { contentStyle: { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 } };
const tick = { fontSize: 10, fill: "var(--muted-foreground)" };

export function SuccessRateChart({ data }: { data: { day: string; runs: number; failures: number; successRate: number | null }[] }) {
  if (!data.length) return <p className="py-10 text-center text-xs text-muted-foreground">No data</p>;
  const rows = data.map((d) => ({ ...d, rate: d.successRate === null ? null : Math.round(d.successRate * 1000) / 10 }));
  return (
    <div className="h-56" role="img" aria-label="Daily executions and success rate">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 4, right: 0, bottom: 0, left: -18 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="day" tick={tick} tickLine={false} axisLine={false} tickFormatter={(d: string) => d.slice(5)} />
          <YAxis yAxisId="runs" tick={tick} tickLine={false} axisLine={false} />
          <YAxis yAxisId="rate" orientation="right" domain={[80, 100]} tick={tick} tickLine={false} axisLine={false} unit="%" />
          <Tooltip {...tooltip} />
          <Bar yAxisId="runs" dataKey="runs" name="Executions" fill="var(--primary)" fillOpacity={0.25} radius={[3, 3, 0, 0]} />
          <Bar yAxisId="runs" dataKey="failures" name="Failures" fill="var(--destructive)" fillOpacity={0.8} radius={[3, 3, 0, 0]} />
          <Line yAxisId="rate" dataKey="rate" name="Success %" stroke="var(--success)" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CategoryChart({ data }: { data: { category: string; n: number }[] }) {
  if (!data.length) return <p className="py-10 text-center text-xs text-muted-foreground">No incidents in this window</p>;
  return (
    <div style={{ height: Math.max(120, data.length * 30) }} role="img" aria-label="Incidents by category">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data.map((d) => ({ ...d, label: d.category.replaceAll("_", " ") }))} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 10 }}>
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis type="category" dataKey="label" tick={tick} tickLine={false} axisLine={false} width={110} />
          <Tooltip {...tooltip} cursor={{ fill: "var(--muted)" }} />
          <Bar dataKey="n" name="Incidents" fill="var(--primary)" radius={[0, 3, 3, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
