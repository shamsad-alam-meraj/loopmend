import { expect, test } from "@playwright/test";
import { demoLogin } from "./helpers";

test("viewers get read-only access", async ({ page }) => {
  await demoLogin(page, "viewer");
  await expect(page.locator("#simulator")).toHaveCount(0);
  await page.goto("/incidents");
  await page.getByTestId("incident-table").getByRole("link").first().click();
  await expect(page.getByRole("heading", { name: "Investigation" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Run investigation/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Resolve" })).toHaveCount(0);
  await page.goto("/settings");
  await expect(page.getByRole("button", { name: "Add member" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Connect n8n" })).toHaveCount(0);
});

test("organizations are isolated", async ({ page }) => {
  await demoLogin(page, "operator");
  await page.goto("/incidents");
  const href = await page.getByTestId("incident-table").getByRole("link").first().getAttribute("href");
  expect(href).toMatch(/^\/incidents\//);

  await demoLogin(page, "owner", "globex");
  // Pages stream behind a loading boundary, so the 404 is asserted on content; the API returns a real 404 status.
  await page.goto(href!);
  await expect(page.getByTestId("not-found")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Investigation" })).toHaveCount(0);
  const api = await page.request.get(`/api${href!.replace("/incidents", "/v1/incidents")}`);
  expect(api.status()).toBe(404);
});

test("signed-out users are redirected to sign in", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/approvals");
  await expect(page).toHaveURL(/\/login\?next=%2Fapprovals/);
});
