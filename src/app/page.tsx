import Link from "next/link";
import { Activity, BrainCircuit, ShieldCheck, Undo2, BarChart3, Users } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { buttonVariants } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

const capabilities = [
  { icon: Activity, title: "Execution observability", body: "Status, latency, throughput and failure rates for every monitored n8n workflow." },
  { icon: ShieldCheck, title: "Signed, idempotent ingestion", body: "HMAC-signed webhooks with timestamp + nonce replay protection. One event, one incident." },
  { icon: BrainCircuit, title: "Evidence-based investigation", body: "Gemini (or a deterministic fallback) classifies the failure and cites the evidence it used." },
  { icon: Undo2, title: "Safe recovery", body: "Allowlisted strategies, retry budgets, deadlines, approval gates and a dead-letter queue." },
  { icon: BarChart3, title: "Reliability analytics", body: "Success rates, p95 latency, MTTR and anomaly detection from observed executions." },
  { icon: Users, title: "Multi-tenant RBAC", body: "Organization-scoped roles enforced server-side and by Postgres row-level security." },
];

const lifecycle = ["Failure detected", "Incident opened", "AI investigation", "Recovery plan", "Human approval", "Idempotent recovery", "Audit trail"];

export default function Home() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Logo /> FlowSentinel
        </Link>
        <nav className="flex items-center gap-2">
          <ThemeToggle />
          <Link href="/login" className={buttonVariants({ variant: "ghost", size: "sm" })}>Sign in</Link>
          <Link href="/register" className={buttonVariants({ size: "sm" })}>Get started</Link>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-6">
        <section className="py-16 md:py-24">
          <p className="mb-4 inline-flex rounded-full border px-3 py-1 text-xs text-muted-foreground">Workflow reliability for n8n automations</p>
          <h1 className="max-w-3xl text-4xl font-semibold tracking-tight md:text-5xl">
            Detect, investigate and safely recover failing automations.
          </h1>
          <p className="mt-5 max-w-2xl text-base text-muted-foreground">
            FlowSentinel ingests failures from n8n, correlates them with execution history, produces an evidence-backed
            diagnosis, and runs only allowlisted, approved, idempotent recovery actions — with a complete audit trail.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/login" className={buttonVariants({ size: "lg" })}>Open the demo workspace</Link>
            <Link href="/api/v1/health" className={buttonVariants({ size: "lg", variant: "outline" })}>Health check</Link>
          </div>
        </section>

        <section className="mb-16 overflow-x-auto rounded-lg border bg-card p-5">
          <ol className="flex min-w-max items-center gap-2 text-xs">
            {lifecycle.map((step, i) => (
              <li key={step} className="flex items-center gap-2">
                <span className="rounded-md border bg-muted px-3 py-1.5 font-medium">{step}</span>
                {i < lifecycle.length - 1 && <span className="text-muted-foreground">→</span>}
              </li>
            ))}
          </ol>
        </section>

        <section className="grid gap-4 pb-24 sm:grid-cols-2 lg:grid-cols-3">
          {capabilities.map(({ icon: Icon, title, body }) => (
            <div key={title} className="rounded-lg border bg-card p-5">
              <Icon className="size-5 text-primary" />
              <h2 className="mt-3 text-sm font-semibold">{title}</h2>
              <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
            </div>
          ))}
        </section>
      </main>
      <footer className="border-t py-6 text-center text-xs text-muted-foreground">
        FlowSentinel · portfolio project · demo data is clearly labeled
      </footer>
    </div>
  );
}
