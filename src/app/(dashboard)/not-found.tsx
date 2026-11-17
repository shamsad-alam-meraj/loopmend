import Link from "next/link";
import { SearchX } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

/** Shown for missing resources and for resources owned by other organizations (indistinguishable by design). */
export default function DashboardNotFound() {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-lg border bg-card p-8 text-center">
      <SearchX className="mx-auto size-6 text-muted-foreground" />
      <h2 className="mt-3 text-sm font-semibold" data-testid="not-found">Not found in this organization</h2>
      <p className="mt-1 text-xs text-muted-foreground">It may have been removed, or it belongs to an organization you are not a member of.</p>
      <Link href="/incidents" className={buttonVariants({ variant: "outline", size: "sm", className: "mt-4" })}>Back to incidents</Link>
    </div>
  );
}
