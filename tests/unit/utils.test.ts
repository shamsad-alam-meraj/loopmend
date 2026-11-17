import { describe, expect, it } from "vitest";
import { formatDuration, formatPercent, formatRelative, slugify, titleCase } from "@/lib/utils/format";
import { rateLimit, resetRateLimits } from "@/lib/http/rate-limit";
import { AppError } from "@/lib/utils/errors";

describe("format helpers", () => {
  it("formats durations", () => {
    expect(formatDuration(450)).toBe("450 ms");
    expect(formatDuration(3400)).toBe("3.4 s");
    expect(formatDuration(125_000)).toBe("2m 5s");
    expect(formatDuration(93_005_000)).toBe("1d 2h");
    expect(formatDuration(5_400_000)).toBe("1h 30m");
    expect(formatDuration(null)).toBe("—");
  });
  it("formats percentages and relative times", () => {
    expect(formatPercent(0.9512)).toBe("95.1%");
    const now = new Date("2026-11-17T10:00:00Z");
    expect(formatRelative(new Date("2026-11-17T09:00:00Z"), now)).toBe("1h ago");
    expect(formatRelative(new Date("2026-11-17T09:59:50Z"), now)).toBe("just now");
  });
  it("slugifies and title-cases", () => {
    expect(slugify("Acme Corp. — Ops!")).toBe("acme-corp-ops");
    expect(titleCase("rate_limit")).toBe("Rate Limit");
  });
});

describe("rate limiter", () => {
  it("allows up to capacity and then refills", () => {
    resetRateLimits();
    const opts = { capacity: 2, refillPerSecond: 1 };
    const t = 1_000_000;
    expect(rateLimit("k", opts, t).allowed).toBe(true);
    expect(rateLimit("k", opts, t).allowed).toBe(true);
    const denied = rateLimit("k", opts, t);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    expect(rateLimit("k", opts, t + 1100).allowed).toBe(true);
  });
});

describe("AppError", () => {
  it("maps codes to HTTP status", () => {
    expect(new AppError("FORBIDDEN", "x").status).toBe(403);
    expect(new AppError("INVALID_SIGNATURE", "x").status).toBe(401);
  });
});
