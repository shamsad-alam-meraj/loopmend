"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, CircleSlash } from "lucide-react";
import { evaluatePolicy, STRATEGY_INFO } from "@/lib/recovery/policy";
import type { Category, RecoveryStrategy, Severity, SideEffectProfile } from "@schema";
import { cn } from "@/lib/utils/cn";

const SIDE_EFFECTS: SideEffectProfile[] = ["read_only", "idempotent", "non_idempotent", "financial", "destructive"];
const CATEGORIES: Category[] = ["rate_limit", "timeout", "upstream_outage", "authentication", "validation", "configuration"];
const SEVERITIES: Severity[] = ["low", "medium", "high", "critical"];

function Chips<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: T[]; onChange: (v: T) => void }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onChange(o)}
            aria-pressed={o === value}
            className={cn("rounded-full border px-2.5 py-1 text-xs transition-all", o === value ? "border-primary bg-primary text-primary-foreground shadow-sm" : "hover:border-primary/50 hover:bg-muted")}
          >
            {o.replaceAll("_", " ")}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** Runs the production policy engine in the browser — the same pure function the server uses. */
export function PolicyPlayground() {
  const [strategy, setStrategy] = useState<RecoveryStrategy>("exponential_backoff");
  const [sideEffect, setSideEffect] = useState<SideEffectProfile>("idempotent");
  const [category, setCategory] = useState<Category>("rate_limit");
  const [severity, setSeverity] = useState<Severity>("medium");
  const [auto, setAuto] = useState(true);
  const [confidence, setConfidence] = useState(0.94);

  const d = useMemo(
    () =>
      evaluatePolicy({
        strategy,
        workflow: { sideEffectProfile: sideEffect, criticality: "high", autoRecoveryEnabled: auto, status: "active" },
        incident: { category, severity, occurrences: 2, status: "open" },
        aiConfidence: confidence,
        recentAttemptsForWorkflow: 1,
      }),
    [strategy, sideEffect, category, severity, auto, confidence],
  );

  const verdict = !d.allowed ? "Blocked by policy" : d.requiresApproval ? `Needs ${d.approverMinRole} approval${d.requiresSeparateApprover ? " · four-eyes" : ""}` : "Self-heals automatically";
  return (
    <div className="grid grid-cols-1 gap-6 rounded-2xl border bg-card p-5 md:p-7 lg:grid-cols-2">
      <div className="space-y-5">
        <Chips label="Recommended strategy" value={strategy} options={Object.keys(STRATEGY_INFO) as RecoveryStrategy[]} onChange={setStrategy} />
        <Chips label="Workflow side effects" value={sideEffect} options={SIDE_EFFECTS} onChange={setSideEffect} />
        <Chips label="Failure category" value={category} options={CATEGORIES} onChange={setCategory} />
        <Chips label="Severity" value={severity} options={SEVERITIES} onChange={setSeverity} />
        <div className="flex flex-wrap items-center gap-6">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="accent-[var(--primary)]" /> Auto-recovery enabled
          </label>
          <label className="flex items-center gap-2 text-sm">
            AI confidence
            <input type="range" min={0} max={1} step={0.01} value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} className="accent-[var(--primary)]" />
            <span className="w-10 tabular-nums text-muted-foreground">{Math.round(confidence * 100)}%</span>
          </label>
        </div>
      </div>
      <div className="flex flex-col rounded-xl border bg-muted/40 p-5" aria-live="polite">
        <div className={cn("text-lg font-semibold transition-colors", !d.allowed ? "text-destructive" : d.requiresApproval ? "text-[color-mix(in_oklch,var(--warning)_75%,var(--foreground))]" : "text-success")}>{verdict}</div>
        <div className="mt-3 grid grid-cols-3 gap-3 text-center">
          {[
            ["Risk", d.riskLevel],
            ["Max attempts", String(d.maxAttempts)],
            ["Deadline", `${Math.round(d.deadlineMs / 60000)} min`],
          ].map(([k, v]) => (
            <div key={k} className="rounded-lg border bg-card p-2.5">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</div>
              <div className="mt-0.5 text-sm font-semibold capitalize">{v}</div>
            </div>
          ))}
        </div>
        <ul className="mt-4 space-y-1.5 text-xs">
          {d.checks.map((c) => (
            <li key={c.name} className="flex gap-2">
              {c.passed ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" /> : <CircleSlash className="mt-0.5 size-3.5 shrink-0 text-destructive" />}
              <span><code className="font-mono">{c.name}</code> <span className="text-muted-foreground">— {c.detail}</span></span>
            </li>
          ))}
          {d.reasons.map((r, i) => <li key={i} className="pl-5 text-muted-foreground">• {r}</li>)}
        </ul>
        <p className="mt-auto pt-4 text-[11px] text-muted-foreground">This is <code>evaluatePolicy()</code> from the codebase running in your browser — the same deterministic function that gates production recoveries.</p>
      </div>
    </div>
  );
}
