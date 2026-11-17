import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export function Stat({ label, value, hint, tone, icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "danger" | "success" | "warning"; icon?: ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        {icon && <span className="[&_svg]:size-4">{icon}</span>}
      </div>
      <div
        className={cn(
          "mt-2 text-2xl font-semibold tabular-nums tracking-tight",
          tone === "danger" && "text-destructive",
          tone === "success" && "text-success",
          tone === "warning" && "text-[color-mix(in_oklch,var(--warning)_75%,var(--foreground))]",
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
