import { describe, expect, it } from "vitest";
import { appUrl } from "@/lib/app-url";

describe("appUrl", () => {
  it("prefers explicit configuration, then the legacy name", () => {
    expect(appUrl({ APP_URL: "https://a.example/", NEXT_PUBLIC_APP_URL: "https://b.example" })).toBe("https://a.example");
    expect(appUrl({ NEXT_PUBLIC_APP_URL: "https://b.example" })).toBe("https://b.example");
  });
  it("falls back to the URLs Vercel provides", () => {
    expect(appUrl({ VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "loopmend-ten.vercel.app", VERCEL_URL: "loopmend-abc123.vercel.app" })).toBe("https://loopmend-ten.vercel.app");
    expect(appUrl({ VERCEL_ENV: "preview", VERCEL_URL: "loopmend-git-feat.vercel.app" })).toBe("https://loopmend-git-feat.vercel.app");
    expect(appUrl({})).toBeUndefined();
  });
});
