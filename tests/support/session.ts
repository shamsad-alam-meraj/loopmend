import { createSessionToken, SESSION_COOKIE, ORG_COOKIE } from "@/lib/auth/session-token";
import { secrets } from "@/lib/env";
import { requestContext } from "./request-context";

/** Signs in as a user for subsequent route-handler calls (local auth mode). */
export function signInAs(userId: string | undefined, orgId?: string) {
  requestContext.reset();
  if (!userId) return;
  requestContext.cookies.set(SESSION_COOKIE, createSessionToken(userId, secrets.session()));
  if (orgId) requestContext.cookies.set(ORG_COOKIE, orgId);
}
