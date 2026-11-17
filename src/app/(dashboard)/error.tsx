"use client";

import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const forbidden = /permission|role|access|cannot perform/i.test(error.message);
  return (
    <div className="mx-auto mt-16 max-w-md rounded-lg border bg-card p-6 text-center">
      <ShieldAlert className="mx-auto size-6 text-destructive" />
      <h2 className="mt-3 text-sm font-semibold">{forbidden ? "Access denied" : "Something went wrong"}</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {forbidden ? error.message : "The page failed to load. No changes were made."}
        {error.digest && <span className="mt-2 block font-mono">ref: {error.digest}</span>}
      </p>
      <Button className="mt-4" variant="outline" size="sm" onClick={reset}>Try again</Button>
    </div>
  );
}
