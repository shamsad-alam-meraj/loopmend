import "server-only";
import type { NextRequest } from "next/server";
import { secrets } from "@/lib/env";
import { safeEqual } from "@/lib/security/crypto";
import { AppError } from "@/lib/utils/errors";

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`; n8n schedules can send the same header. */
export function assertCron(req: NextRequest) {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || !safeEqual(token, secrets.cron())) throw new AppError("UNAUTHENTICATED", "Invalid cron credentials");
}
