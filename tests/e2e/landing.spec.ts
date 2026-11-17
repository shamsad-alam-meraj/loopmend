import { expect, test } from "@playwright/test";

test("landing page explains the product and runs the policy engine client-side", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("close the loop");
  await expect(page.getByText("INC-0042 · live replay")).toBeVisible();
  await page.getByRole("button", { name: "financial" }).click();
  await expect(page.getByText("Needs admin approval · four-eyes")).toBeVisible();
  await page.getByRole("button", { name: "idempotent", exact: true }).click();
  await expect(page.getByText("Self-heals automatically")).toBeVisible();
});

test("API rejects unauthenticated and unsigned requests", async ({ request }) => {
  expect((await request.get("/api/v1/health")).status()).toBe(200);
  expect((await request.get("/api/v1/incidents")).status()).toBe(401);
  const webhook = await request.post("/api/v1/webhooks/n8n/incident", { data: { workflow: { id: "x" } } });
  expect(webhook.status()).toBe(401);
  expect((await webhook.json()).error.code).toBe("INVALID_SIGNATURE");
});
