import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { publicStatus } from "@/services/insights.service";
import { Logo } from "@/components/ui/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils/cn";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Status", robots: { index: false } };

const STATE = {
  operational: { label: "Operational", dot: "bg-success", text: "text-success" },
  degraded: { label: "Degraded", dot: "bg-warning", text: "text-[color-mix(in_oklch,var(--warning)_75%,var(--foreground))]" },
  major_outage: { label: "Major outage", dot: "bg-destructive", text: "text-destructive" },
  paused: { label: "Paused", dot: "bg-muted-foreground", text: "text-muted-foreground" },
} as const;

const HEADLINE = { operational: "All systems operational", degraded: "Some automations are degraded", major_outage: "Major automation outage" } as const;

function barColor(rate: number | null) {
  if (rate === null) return "bg-muted";
  if (rate >= 0.99) return "bg-success";
  if (rate >= 0.95) return "bg-warning";
  return "bg-destructive";
}

/** Public, opt-in status page. Aggregate health only — no incident or error details. */
export default async function StatusPage({ params }: PageProps<"/status/[slug]">) {
  const status = await publicStatus((await params).slug);
  if (!status) notFound();
  const head = STATE[status.overall as keyof typeof STATE];
  return (
    <div className="mx-auto min-h-screen max-w-3xl px-5 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{status.organization}</h1>
          <p className="text-xs text-muted-foreground">Automation status{status.isDemo ? " · demo data" : ""}</p>
        </div>
        <ThemeToggle />
      </header>
      <div className={cn("mb-8 flex items-center gap-3 rounded-xl border bg-card p-5")}>
        <span className="relative flex size-3"><span className={cn("lm-ring absolute inline-flex size-full rounded-full", head.dot)} /><span className={cn("relative inline-flex size-3 rounded-full", head.dot)} /></span>
        <span className="text-lg font-semibold">{HEADLINE[status.overall as keyof typeof HEADLINE]}</span>
      </div>
      <ul className="space-y-3">
        {status.services.map((s) => {
          const st = STATE[s.state as keyof typeof STATE];
          return (
            <li key={s.name} className="rounded-xl border bg-card p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{s.name}</span>
                <span className={cn("flex items-center gap-1.5 text-xs font-medium", st.text)}><span className={cn("size-2 rounded-full", st.dot)} />{st.label}</span>
              </div>
              <div className="mt-3 flex h-8 items-end gap-[3px]" aria-label="Daily success rate, last 30 days">
                {s.bars.map((b) => (
                  <span key={b.day} title={`${b.day}: ${b.successRate === null ? "no runs" : `${(b.successRate * 100).toFixed(2)}% of ${b.runs} runs`}`} className={cn("h-full flex-1 rounded-sm opacity-80 transition-opacity hover:opacity-100", barColor(b.successRate))} />
                ))}
              </div>
              <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground"><span>30 days ago</span><span>{s.uptime === null ? "—" : `${(s.uptime * 100).toFixed(2)}% success`}</span><span>Today</span></div>
            </li>
          );
        })}
      </ul>
      <footer className="mt-10 flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Logo className="size-4" /> Powered by <Link href="/" className="hover:text-foreground">Loopmend</Link> · updated {new Date(status.generatedAt).toUTCString().slice(17, 22)} UTC
      </footer>
    </div>
  );
}
