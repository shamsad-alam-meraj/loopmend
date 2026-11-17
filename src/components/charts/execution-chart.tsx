"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type Point = { bucket: string; success: number; failures: number };

function label(bucket: string, granularity: "hour" | "day") {
  const d = new Date(bucket);
  return granularity === "hour" ? `${String(d.getUTCHours()).padStart(2, "0")}:00` : `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

/** Stacked success/failure execution counts. Colors come from theme tokens. */
export function ExecutionChart({ data, granularity = "hour", height = 200 }: { data: Point[]; granularity?: "hour" | "day"; height?: number }) {
  if (data.length === 0) return <div className="flex items-center justify-center text-xs text-muted-foreground" style={{ height }}>No executions in this window</div>;
  return (
    <div style={{ height }} role="img" aria-label="Executions over time: successes and failures">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="bucket" tickFormatter={(b: string) => label(b, granularity)} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} minTickGap={16} />
          <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
            labelFormatter={(b) => new Date(String(b)).toUTCString().slice(0, 22)}
          />
          <Bar dataKey="success" name="Succeeded" stackId="a" fill="var(--success)" fillOpacity={0.75} />
          <Bar dataKey="failures" name="Failed" stackId="a" fill="var(--destructive)" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
