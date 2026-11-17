import Link from "next/link";
import {
  Activity,
  ArrowRight,
  BarChart3,
  BrainCircuit,
  CheckCheck,
  FileLock2,
  Fingerprint,
  KeyRound,
  Lock,
  ShieldCheck,
  Timer,
  Undo2,
  Users,
  Workflow,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { ThemeToggle } from "@/components/theme-toggle";
import { Reveal } from "@/components/landing/reveal";
import { IncidentConsole } from "@/components/landing/incident-console";
import { LifecycleStepper } from "@/components/landing/lifecycle-stepper";
import { PolicyPlayground } from "@/components/landing/policy-playground";
import { ArchitectureDiagram } from "@/components/landing/architecture";

const FEATURES = [
  { icon: Activity, title: "Execution observability", body: "Success rate, p50/p95 latency and throughput per workflow, with keyset-paginated execution history." },
  { icon: Fingerprint, title: "Failure correlation", body: "Errors are fingerprinted by workflow + signature. Alert storms collapse into one incident with a recurrence count." },
  { icon: BrainCircuit, title: "Evidence-based AI", body: "Diagnoses cite the evidence they used. Model, prompt version, latency and fallback use are persisted for every run." },
  { icon: Undo2, title: "Safe self-healing", body: "Low-risk recoveries on idempotent workflows heal on their own; everything else waits for the right human." },
  { icon: BarChart3, title: "SLOs & anomalies", body: "Error budgets by criticality plus z-score and MAD anomaly detection against each workflow's own baseline." },
  { icon: Users, title: "Multi-tenant RBAC", body: "Owner / admin / operator / viewer, checked in handlers, actions and services, and enforced again by Postgres RLS." },
];

const CONTROLS = [
  { icon: KeyRound, text: "HMAC-SHA256 webhook signatures with per-integration secrets" },
  { icon: Timer, text: "±5 min timestamp window and single-use nonces (replay protection)" },
  { icon: FileLock2, text: "Idempotency ledger: one event → one incident, even under concurrency" },
  { icon: Lock, text: "AES-256-GCM encrypted credentials bound to their organization" },
  { icon: ShieldCheck, text: "Row-level security on every tenant table; client roles are read-only" },
  { icon: CheckCheck, text: "Append-only audit log and immutable approvals (database triggers)" },
];

const FAQ = [
  { q: "Can the AI run arbitrary code or workflows?", a: "No. Models can only pick from six allowlisted strategies. A deterministic policy engine decides risk, approvals, attempts and deadlines, and financial or destructive workflows are never retried automatically." },
  { q: "What happens if Gemini is down or returns nonsense?", a: "Output must pass a strict schema. After a bounded retry, Loopmend falls back to a deterministic rules engine and records that the fallback was used." },
  { q: "How do you avoid retrying something that already succeeded?", a: "Each attempt claims the plan under a row lock and carries a unique idempotency key. Non-idempotent workflows also get a side-effect check before every attempt. Ambiguous outcomes go to the dead-letter queue instead of being retried." },
  { q: "Does it need paid infrastructure?", a: "It is designed for a $0 start: Vercel Hobby, Supabase Free and an Oracle Cloud Always Free VM for n8n. Locally it runs with an embedded Postgres, with no setup at all." },
];

export default function Home() {
  return (
    <div className="min-h-screen overflow-x-hidden">
      <header className="sticky top-0 z-40 border-b border-transparent bg-background/70 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link href="/" className="flex items-center gap-2 font-semibold"><Logo /> Loopmend</Link>
          <nav className="flex items-center gap-1 text-sm">
            <a href="#lifecycle" className="hidden rounded-md px-3 py-1.5 text-muted-foreground hover:text-foreground md:block">Lifecycle</a>
            <a href="#policy" className="hidden rounded-md px-3 py-1.5 text-muted-foreground hover:text-foreground md:block">Policy</a>
            <a href="#security" className="hidden rounded-md px-3 py-1.5 text-muted-foreground hover:text-foreground md:block">Security</a>
            <ThemeToggle />
            <Link href="/login" className={buttonVariants({ variant: "ghost", size: "sm" })}>Sign in</Link>
            <Link href="/register" className={cn(buttonVariants({ size: "sm" }), "hidden sm:inline-flex")}>Get started</Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="relative">
          <div className="lm-grid-bg pointer-events-none absolute inset-0 -z-10 opacity-60" />
          <div className="pointer-events-none absolute left-1/2 top-[-120px] -z-10 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-primary/20 blur-[120px]" />
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-14 md:pt-20 lg:grid-cols-[1.05fr_1fr]">
            <Reveal>
              <span className="inline-flex items-center gap-2 rounded-full border bg-card/70 px-3 py-1 text-xs text-muted-foreground">
                <span className="relative flex size-2"><span className="lm-ring absolute inline-flex size-full rounded-full bg-success" /><span className="relative inline-flex size-2 rounded-full bg-success" /></span>
                Self-healing reliability for n8n automations
              </span>
              <h1 className="mt-5 text-4xl font-semibold tracking-tight md:text-6xl">
                When workflows break, <span className="lm-gradient-text">close the loop</span> safely.
              </h1>
              <p className="mt-5 max-w-xl text-base text-muted-foreground md:text-lg">
                Loopmend ingests n8n failures, investigates them with evidence, proposes policy-checked recoveries, gets the right human to approve,
                and executes them idempotently, with an audit trail that proves every step.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/login" className={buttonVariants({ size: "lg" })}>Explore the live demo <ArrowRight /></Link>
                <a href="#policy" className={buttonVariants({ size: "lg", variant: "outline" })}>Try the policy engine</a>
              </div>
              <dl className="mt-10 grid max-w-lg grid-cols-3 gap-4 text-sm">
                {[
                  ["6", "allowlisted strategies"],
                  ["±300s", "signature window"],
                  ["1", "incident per event"],
                ].map(([v, l]) => (
                  <div key={l}><dt className="text-2xl font-semibold tabular-nums">{v}</dt><dd className="text-xs text-muted-foreground">{l}</dd></div>
                ))}
              </dl>
            </Reveal>
            <Reveal delay={150}><IncidentConsole /></Reveal>
          </div>
        </section>

        <section id="lifecycle" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20">
          <Reveal className="mb-10 max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">The lifecycle</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">From failure to proof, in seven deliberate steps</h2>
            <p className="mt-3 text-muted-foreground">Each step is its own module with its own tests. Hover to pause, click to explore real contracts.</p>
          </Reveal>
          <Reveal><LifecycleStepper /></Reveal>
        </section>

        <section className="border-y bg-muted/30">
          <div className="mx-auto max-w-6xl px-5 py-20">
            <Reveal className="mb-10 max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-widest text-primary">Capabilities</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight">Beyond alerting</h2>
            </Reveal>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ icon: Icon, title, body }, i) => (
                <Reveal as="li" key={title} delay={i * 70} className="lm-card-hover rounded-xl border bg-card p-6">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="size-5" /></span>
                  <h3 className="mt-4 font-semibold">{title}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
                </Reveal>
              ))}
            </ul>
          </div>
        </section>

        <section id="policy" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20">
          <Reveal className="mb-10 max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">Interactive</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">AI suggests. Policy decides.</h2>
            <p className="mt-3 text-muted-foreground">Change the inputs and watch the deterministic policy engine respond. Notice that AI confidence never changes the outcome.</p>
          </Reveal>
          <Reveal><PolicyPlayground /></Reveal>
        </section>

        <section className="mx-auto max-w-6xl px-5 pb-20">
          <Reveal className="mb-8 max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">Architecture</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">A modular monolith, on purpose</h2>
            <p className="mt-3 text-muted-foreground">One Next.js codebase owns tenancy, intelligence, authorization and audit. n8n orchestrates; it is never the source of truth.</p>
          </Reveal>
          <Reveal className="rounded-2xl border bg-card p-4 md:p-8"><ArchitectureDiagram /></Reveal>
        </section>

        <section id="security" className="scroll-mt-20 border-y bg-muted/30">
          <div className="mx-auto grid max-w-6xl gap-10 px-5 py-20 lg:grid-cols-[1fr_1.2fr]">
            <Reveal>
              <p className="text-xs font-semibold uppercase tracking-widest text-primary">Security model</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight">Security and auditability are product features</h2>
              <p className="mt-3 text-muted-foreground">Hiding a button is not access control. Every sensitive path is authorized server-side and again at the database.</p>
            </Reveal>
            <ul className="grid gap-3 sm:grid-cols-2">
              {CONTROLS.map(({ icon: Icon, text }, i) => (
                <Reveal as="li" key={text} delay={i * 60} className="flex gap-3 rounded-lg border bg-card p-4 text-sm">
                  <Icon className="mt-0.5 size-4 shrink-0 text-primary" />{text}
                </Reveal>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-5 py-20">
          <Reveal><h2 className="mb-6 text-center text-3xl font-semibold tracking-tight">Questions engineers ask</h2></Reveal>
          <div className="space-y-3">
            {FAQ.map((f, i) => (
              <Reveal key={f.q} delay={i * 60}>
                <details className="group rounded-xl border bg-card p-5 open:shadow-sm">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                    {f.q}
                    <span className="text-muted-foreground transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <p className="mt-3 text-sm text-muted-foreground">{f.a}</p>
                </details>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 pb-24">
          <Reveal className="relative overflow-hidden rounded-2xl border bg-card px-6 py-14 text-center">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/15 via-transparent to-success/10" />
            <Workflow className="relative mx-auto size-8 text-primary" />
            <h2 className="relative mt-4 text-3xl font-semibold tracking-tight">See a failure heal itself</h2>
            <p className="relative mx-auto mt-3 max-w-xl text-muted-foreground">Sign in to the demo workspace as any role, fire a signed failure with the simulator, and walk it to an audited recovery.</p>
            <div className="relative mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/login" className={buttonVariants({ size: "lg" })}>Open the demo <ArrowRight /></Link>
              <Link href="/api/v1/health" className={buttonVariants({ size: "lg", variant: "outline" })}>API health</Link>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-xs text-muted-foreground">
          <span className="flex items-center gap-2"><Logo className="size-4" /> Loopmend: workflow reliability & self-healing</span>
          <span>Demo data is synthetic and clearly labeled · Next.js · Supabase · n8n · Gemini</span>
        </div>
      </footer>
    </div>
  );
}
