import "server-only";
import { AppError } from "@/lib/utils/errors";
import { getDb } from "@/lib/db/client";
import { incidentEvents } from "@schema";
import { systemContext } from "./context";
import { onInvestigationCompleted } from "./investigation.service";
import { createRecoveryPlan } from "./recovery.service";

/**
 * Cross-module wiring (kept here to avoid import cycles):
 * after an investigation completes, propose a policy-checked recovery plan.
 * Imported for side effects by every entrypoint that can run investigations.
 */
let registered = false;

export function registerRecoveryHooks() {
  if (registered) return;
  registered = true;
  onInvestigationCompleted(async (ctx, { incidentId, investigationId, result }) => {
    const sys = systemContext(ctx.organizationId, ctx.requestId, "system");
    try {
      await createRecoveryPlan(sys, { incidentId, investigationId, strategy: result.recommendation.strategy, maxAttempts: result.recommendation.maxAttempts, rationale: result.recommendation.rationale });
    } catch (e) {
      if (e instanceof AppError && (e.code === "CONFLICT" || e.code === "POLICY_VIOLATION")) {
        const db = await getDb();
        await db.insert(incidentEvents).values({ organizationId: sys.organizationId, incidentId, eventType: "recovery_not_proposed", actorType: "system", metadata: { reason: e.message } });
        return;
      }
      throw e;
    }
  });
}

registerRecoveryHooks();
