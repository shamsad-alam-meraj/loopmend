import type { Role } from "@schema";
import { can, type Permission } from "@/lib/security/rbac";
import { AppError } from "@/lib/utils/errors";

export type ActorType = "user" | "system" | "n8n" | "ai";

/** Who is acting, in which tenant. Every service call receives one. */
export type ServiceContext = {
  organizationId: string;
  actor: { type: ActorType; id: string | null };
  /** Membership role for user actors; null for machine actors. */
  role: Role | null;
  requestId?: string;
};

/**
 * Service-boundary authorization (defense in depth: route handlers and
 * server actions also check). Machine actors are only created by
 * authenticated machine entrypoints (signed webhooks, cron), never from user input.
 */
export function authorize(ctx: ServiceContext, permission: Permission): void {
  if (ctx.actor.type !== "user") return;
  if (!can(ctx.role, permission)) {
    throw new AppError("FORBIDDEN", `Your role (${ctx.role ?? "none"}) cannot perform ${permission}`);
  }
}

export function systemContext(organizationId: string, requestId?: string, type: ActorType = "system"): ServiceContext {
  return { organizationId, actor: { type, id: null }, role: null, requestId };
}
