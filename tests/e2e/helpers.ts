import { expect, type Page } from "@playwright/test";

export async function loginAs(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(email.split("@")[0], "i") }).first().click();
  await page.waitForURL("**/");
  await expect(page.getByRole("link", { name: "FollowMe" }).first()).toBeVisible();
}
