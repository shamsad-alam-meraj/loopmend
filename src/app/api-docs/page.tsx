import type { Metadata } from "next";
import Link from "next/link";
import { API_OPERATIONS } from "@/lib/http/openapi";
import { Logo } from "@/components/ui/logo";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils/cn";

export const metadata: Metadata = { title: "API reference" };

const METHOD = { get: "bg-info/15 text-info", post: "bg-success/15 text-success", patch: "bg-warning/20 text-[color-mix(in_oklch,var(--warning)_75%,var(--foreground))]" } as const;
const AUTH = { session: "Session", signature: "HMAC signature", cron: "Bearer CRON_SECRET", public: "Public" } as const;

export default function ApiDocsPage() {
  const tags = [...new Set(API_OPERATIONS.map((o) => o.tag))];
  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2 font-semibold"><Logo /> Loopmend API</Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <a href="/api/v1/openapi.json" className={buttonVariants({ size: "sm", variant: "outline" })}>openapi.json</a>
        </div>
      </header>
      <p className="mb-2 text-sm text-muted-foreground">
        Base URL <code className="rounded bg-muted px-1.5 py-0.5">/api/v1</code>. Every response uses the envelope{" "}
        <code className="break-all rounded bg-muted px-1.5 py-0.5">{"{ success, data, error, meta: { requestId } }"}</code>. Request and response schemas in the OpenAPI document are generated from the same Zod schemas that validate requests.
      </p>
      <p className="mb-8 text-sm text-muted-foreground">Error codes: BAD_REQUEST, VALIDATION_FAILED, UNAUTHENTICATED, FORBIDDEN, NOT_FOUND, CONFLICT, PAYLOAD_TOO_LARGE, RATE_LIMITED, INVALID_SIGNATURE, REPLAY_DETECTED, POLICY_VIOLATION, UPSTREAM_FAILURE, SERVICE_UNAVAILABLE, INTERNAL.</p>
      <div className="space-y-8">
        {tags.map((tag) => (
          <section key={tag}>
            <h2 className="mb-3 text-lg font-semibold">{tag}</h2>
            <ul className="divide-y rounded-xl border bg-card">
              {API_OPERATIONS.filter((o) => o.tag === tag).map((o) => (
                <li key={`${o.method} ${o.path}`} className="flex flex-col gap-1.5 p-4 sm:flex-row sm:items-start sm:gap-4">
                  <div className="flex shrink-0 items-center gap-2 sm:w-80">
                    <span className={cn("w-14 rounded px-1.5 py-0.5 text-center font-mono text-[11px] font-semibold uppercase", METHOD[o.method])}>{o.method}</span>
                    <code className="break-all font-mono text-xs">{o.path}</code>
                  </div>
                  <div className="min-w-0 flex-1 text-sm">
                    <p>{o.summary}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <Badge tone={o.auth === "public" ? "neutral" : "primary"}>{AUTH[o.auth]}</Badge>
                      {o.permission && <Badge tone="neutral">{o.permission}</Badge>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
