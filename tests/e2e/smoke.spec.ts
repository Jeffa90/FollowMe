import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers";

test("learner can sign in, search and read a published guide", async ({ page }) => {
  await loginAs(page, "lena@contoso.example");
  await page.getByRole("searchbox").first().fill("purchase order");
  await page.getByRole("button", { name: "Search" }).first().click();
  await expect(page.getByRole("link", { name: /Create a purchase order in SAP/ }).first()).toBeVisible();
  await page.getByRole("link", { name: /Create a purchase order in SAP/ }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Create a purchase order");
  await expect(page.getByText("Controlled document")).toBeVisible();
});
