"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils/cn";

type Line = { t: string; tone: "muted" | "danger" | "info" | "warning" | "success" | "primary"; text: string };

const SCRIPT: Line[] = [
  { t: "10:00:00.412", tone: "danger", text: "n8n ▸ Payment Notification failed · HTTP 429 Too Many Requests" },
  { t: "10:00:00.431", tone: "muted", text: "webhook ▸ signature v1 ✓ · timestamp ✓ · nonce 9f3c… first use ✓" },
  { t: "10:00:00.447", tone: "info", text: "ingest ▸ eventId evt_01JXYZ claimed · INC-0042 opened (rate_limit / medium)" },
  { t: "10:00:01.208", tone: "primary", text: "ai ▸ root cause: external API rate limit exceeded · confidence 0.94*" },
  { t: "10:00:01.230", tone: "warning", text: "policy ▸ non-idempotent workflow → 1 attempt · approval: operator+" },
  { t: "10:03:12.004", tone: "info", text: "approval ▸ Opal (operator) approved · “safe to retry once”" },
  { t: "10:03:12.019", tone: "muted", text: "recovery ▸ side-effect check: no completed retry found" },
  { t: "10:03:13.140", tone: "success", text: "recovery ▸ attempt #1 succeeded · key plan:…:attempt:1" },
  { t: "10:03:13.152", tone: "success", text: "incident ▸ INC-0042 resolved · audit trail sealed (7 events)" },
];

const TONE: Record<Line["tone"], string> = {
  muted: "text-muted-foreground",
  danger: "text-destructive",
  info: "text-info",
  warning: "text-[color-mix(in_oklch,var(--warning)_80%,var(--foreground))]",
  success: "text-success",
  primary: "text-primary",
};

/** Animated replay of a failure-to-recovery lifecycle (illustrative data). */
export function IncidentConsole() {
  const [count, setCount] = useState(1);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      const id = setTimeout(() => setCount(SCRIPT.length), 0);
      return () => clearTimeout(id);
    }
    const id = setInterval(() => setCount((c) => (c >= SCRIPT.length + 3 ? 1 : c + 1)), 1100);
    return () => clearInterval(id);
  }, []);
  const visible = SCRIPT.slice(0, Math.min(count, SCRIPT.length));
  const status = count >= SCRIPT.length ? "resolved" : count >= 6 ? "recovering" : count >= 5 ? "awaiting approval" : count >= 3 ? "investigating" : "open";

  return (
    <div className="lm-float overflow-hidden rounded-xl border bg-card shadow-2xl shadow-primary/10">
      <div className="flex items-center justify-between border-b bg-muted/50 px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full bg-destructive/70" />
          <span className="size-2.5 rounded-full bg-warning/70" />
          <span className="size-2.5 rounded-full bg-success/70" />
        </div>
        <span className="font-mono text-[11px] text-muted-foreground">INC-0042 · live replay</span>
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors duration-500",
            status === "resolved" ? "border-success/40 bg-success/10 text-success" : status === "open" ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-primary/40 bg-primary/10 text-primary",
          )}
        >
          {status}
        </span>
      </div>
      <ol className="h-[300px] space-y-1.5 overflow-hidden p-4 font-mono text-[11.5px] leading-relaxed" aria-label="Incident lifecycle replay">
        {visible.map((l, i) => (
          <li key={i} className={cn("animate-in flex gap-3", i === visible.length - 1 && count <= SCRIPT.length && "lm-caret")}>
            <span className="shrink-0 text-muted-foreground/70">{l.t}</span>
            <span className={TONE[l.tone]}>{l.text}</span>
          </li>
        ))}
      </ol>
      <div className="border-t px-4 py-2 text-[10px] text-muted-foreground">* model-reported estimate — never used alone to authorize actions</div>
    </div>
  );
}
