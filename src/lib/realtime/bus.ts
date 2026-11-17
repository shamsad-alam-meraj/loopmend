import { EventEmitter } from "node:events";

export type OrgEvent = {
  type: "incident.created" | "incident.updated" | "execution.recorded" | "investigation.completed" | "recovery.updated" | "approval.recorded";
  id: string;
  at: string;
  summary?: string;
};

const g = globalThis as unknown as { __loopmendBus?: EventEmitter };
const bus = (g.__loopmendBus ??= new EventEmitter().setMaxListeners(500));

/**
 * In-process change feed used by the SSE stream. Supabase Realtime (Postgres
 * changes + RLS) is used instead when configured; this keeps local/self-hosted
 * deployments live without extra infrastructure.
 */
export function publishOrgEvent(orgId: string, event: Omit<OrgEvent, "at">) {
  bus.emit(`org:${orgId}`, { ...event, at: new Date().toISOString() } satisfies OrgEvent);
}

export function subscribeOrgEvents(orgId: string, listener: (e: OrgEvent) => void): () => void {
  bus.on(`org:${orgId}`, listener);
  return () => bus.off(`org:${orgId}`, listener);
}
