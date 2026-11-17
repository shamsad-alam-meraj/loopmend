"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";

type Toast = { id: number; text: string };

/**
 * Keeps dashboards live. Uses Supabase Realtime (postgres_changes, filtered by
 * organization and protected by RLS) when configured, otherwise the SSE feed.
 * Changes trigger a debounced router.refresh() — server components re-render
 * with fresh, authorized data; no client-side data duplication.
 */
export function LiveUpdates({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [connected, setConnected] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const refresh = (text?: string) => {
      if (text) {
        const id = Date.now() + Math.random();
        setToasts((t) => [...t.slice(-2), { id, text }]);
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
      }
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => router.refresh(), 600);
    };

    const supabase = getSupabaseBrowserClient();
    if (supabase) {
      const channel = supabase
        .channel(`org-${orgId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "incidents", filter: `organization_id=eq.${orgId}` }, () => refresh("Incident updated"))
        .on("postgres_changes", { event: "*", schema: "public", table: "recovery_plans", filter: `organization_id=eq.${orgId}` }, () => refresh("Recovery updated"))
        .subscribe((status: string) => setConnected(status === "SUBSCRIBED"));
      return () => void supabase.removeChannel(channel);
    }

    const es = new EventSource("/api/v1/events/stream");
    es.addEventListener("ready", () => setConnected(true));
    es.addEventListener("change", (ev) => {
      const data = JSON.parse((ev as MessageEvent).data) as { type: string; summary?: string };
      refresh(`${data.type.replace(".", " ")}${data.summary ? ` · ${data.summary}` : ""}`);
    });
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, [orgId, router]);

  return (
    <>
      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground" title={connected ? "Live updates connected" : "Reconnecting…"}>
        <span className={cn("relative flex size-2", connected ? "text-success" : "text-muted-foreground")}>
          {connected && <span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-60" />}
          <span className="relative inline-flex size-2 rounded-full bg-current" />
        </span>
        {connected ? "Live" : "Offline"}
      </span>
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="animate-in rounded-md border bg-card px-3 py-2 text-xs shadow-lg">{t.text}</div>
        ))}
      </div>
    </>
  );
}
