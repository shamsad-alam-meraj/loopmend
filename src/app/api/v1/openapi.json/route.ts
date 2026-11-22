import { NextResponse, type NextRequest } from "next/server";
import { buildOpenApi } from "@/lib/http/openapi";

export const dynamic = "force-dynamic";

/** GET /api/v1/openapi.json — OpenAPI 3.1, generated from the runtime Zod schemas. */
export function GET(req: NextRequest) {
  return NextResponse.json(buildOpenApi(process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin), { headers: { "cache-control": "public, max-age=300" } });
}
