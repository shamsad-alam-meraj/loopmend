import { route, ok } from "@/lib/http/api";

export const dynamic = "force-dynamic";

export const GET = route(async (_req, { requestId }) => {
  return ok({ status: "ok", version: process.env.npm_package_version ?? "0.1.0", time: new Date().toISOString() }, requestId);
});
