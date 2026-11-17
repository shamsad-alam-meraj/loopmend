import { expect, test } from "@playwright/test";
import { demoLogin } from "./helpers";

test("failure → signed ingestion → investigation → approval → idempotent recovery → audit", async ({ page }) => {
  await demoLogin(page, "operator");

  // 1. Simulate a signed n8n failure (re-delivered once to prove idempotency).
  const simulator = page.locator("#simulator");
  await simulator.getByLabel("Workflow").selectOption({ label: "Customer Onboarding" });
  await simulator.getByLabel("Failure scenario").selectOption("upstream_503");
  await simulator.getByRole("button", { name: /Simulate failure/ }).click();
  const result = page.getByTestId("simulation-result");
  await expect(result).toContainText("HTTP 202");
  await expect(result).toContainText("duplicate");

  // 2. Open the incident.
  await result.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/incidents\//);
  await expect(page.getByText("Upstream Outage").first()).toBeVisible();

  // 3. Investigate (rules engine; no AI key in E2E) → plan proposed, awaiting approval.
  await page.getByRole("button", { name: /Run investigation|Re-investigate/ }).click();
  await expect(page.getByTestId("investigation-result")).toBeVisible();
  await expect(page.getByTestId("recovery-plan")).toContainText("Pending Approval");

  // 4. Approve and execute.
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByTestId("recovery-plan")).toContainText("Approved by Opal Operator");
  await page.getByRole("button", { name: "Execute" }).click();
  await expect(page.getByTestId("recovery-plan")).toContainText("Succeeded");
  await expect(page.getByText("Resolved").first()).toBeVisible();

  // 5. Audit trail records decision and outcome.
  await page.goto("/audit");
  await expect(page.getByText("recovery.approved").first()).toBeVisible();
  await expect(page.getByText("recovery.succeeded").first()).toBeVisible();
});
