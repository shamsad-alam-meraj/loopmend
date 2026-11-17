import { expect, type Page } from "@playwright/test";

export async function demoLogin(page: Page, role: "owner" | "admin" | "operator" | "viewer", org: "acme" | "globex" = "acme") {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByTestId(`demo-${role}-${org}`).click();
  await expect(page).toHaveURL(/\/overview/);
  await expect(page.getByTestId("current-role")).toHaveText(role);
}
