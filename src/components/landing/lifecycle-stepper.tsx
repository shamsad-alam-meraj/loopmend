"use client";

import { useEffect, useState } from "react";
import { BrainCircuit, CheckCheck, FileLock2, Radio, ScrollText, ShieldCheck, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const STEPS = [
  {
    icon: Radio,
    title: "Detect",
    body: "n8n's Error Trigger posts the failure. Raw payloads from any n8n version are normalized into one canonical contract and secrets are redacted.",
    code: `POST /api/v1/webhooks/n8n/incident
x-loopmend-integration: 4be1…c09
x-loopmend-timestamp: 1794900000
x-loopmend-nonce: 9f3c2a71d0b84e6f
x-loopmend-signature: v1=hmac_sha256(ts.nonce.body)`,
  },
  {
    icon: ShieldCheck,
    title: "Authenticate",
    body: "Per-integration HMAC secrets, a 5-minute timestamp window and single-use nonces. Replays, stale or forged requests are rejected before any parsing.",
    code: `401 INVALID_SIGNATURE  // wrong secret / tampered body
401 INVALID_SIGNATURE  // timestamp outside ±300s
409 REPLAY_DETECTED    // nonce already used`,
  },
  {
    icon: FileLock2,
    title: "Ingest once",
    body: "The (organization, eventId) pair is claimed inside the incident transaction. Retries and concurrent deliveries return the original incident.",
    code: `{ "outcome": "duplicate",
  "incidentId": "inc_…", "duplicate": true }
// same error signature while open → recurrence ×N`,
  },
  {
    icon: BrainCircuit,
    title: "Investigate",
    body: "Gemini classifies and diagnoses using sanitized evidence only. Output must pass a Zod schema; failures fall back to a deterministic rules engine.",
    code: `{ "category": "rate_limit", "severity": "medium",
  "rootCause": { "summary": "External API rate limit exceeded",
    "evidence": ["HTTP status 429", "3 of 96 runs failed in 24h"] },
  "recommendation": { "strategy": "exponential_backoff",
    "requiresApproval": true, "maxAttempts": 3 },
  "confidence": 0.94 }`,
  },
  {
    icon: CheckCheck,
    title: "Approve",
    body: "Deterministic policy decides risk, approver role, retry budget and deadline. High-risk plans need an admin — and a different person than the requester.",
    code: `risk: high · approver: admin+ (four-eyes)
✓ allowlisted_strategy   ✓ incident_active
✓ workflow_retry_budget  ✓ failure_is_retryable
• financial workflow: never retried automatically`,
  },
  {
    icon: Undo2,
    title: "Recover",
    body: "An atomic claim plus a unique per-attempt idempotency key means no duplicate side effects. Backoff with jitter; exhausted or ambiguous work goes to dead-letter.",
    code: `attempt #1 failed (429) → next in 4.1s (full jitter)
attempt #2 succeeded   key plan:…:attempt:2
// unknown outcome after 10m → dead_letter`,
  },
  {
    icon: ScrollText,
    title: "Prove it",
    body: "Every approval, rejection, execution request and outcome is written to an append-only audit log enforced by a database trigger.",
    code: `UPDATE audit_logs SET … → ERROR 42501
  audit_logs is append-only (UPDATE blocked)`,
  },
];

export function LifecycleStepper() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setActive((a) => (a + 1) % STEPS.length), 5000);
    return () => clearInterval(id);
  }, [paused]);
  const step = STEPS[active];
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_1fr]" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <ol className="relative min-w-0 space-y-1" role="tablist" aria-label="Incident lifecycle">
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <button
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={cn("group flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-all", i === active ? "border-primary/40 bg-primary/10" : "border-transparent hover:bg-muted")}
            >
              <span className={cn("flex size-8 items-center justify-center rounded-md transition-colors", i === active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground group-hover:text-foreground")}>
                <s.icon className="size-4" />
              </span>
              <span className="flex-1">
                <span className="block text-sm font-medium">{i + 1}. {s.title}</span>
              </span>
              {i === active && !paused && <span className="h-1 w-10 overflow-hidden rounded-full bg-primary/20"><span key={active} className="block h-full origin-left animate-[lm-progress_5s_linear] bg-primary" /></span>}
            </button>
          </li>
        ))}
      </ol>
      <div key={active} className="animate-in flex min-w-0 flex-col rounded-xl border bg-card p-6" role="tabpanel">
        <div className="flex items-center gap-2 text-primary"><step.icon className="size-5" /><span className="text-sm font-semibold">{step.title}</span></div>
        <p className="mt-3 text-sm text-muted-foreground">{step.body}</p>
        <pre className="mt-5 flex-1 overflow-x-auto rounded-lg border bg-muted/60 p-4 font-mono text-[12px] leading-relaxed">{step.code}</pre>
      </div>
    </div>
  );
}
