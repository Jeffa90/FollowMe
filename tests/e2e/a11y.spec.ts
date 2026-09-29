// WCAG 2.2 AA automated checks (axe-core) on every major screen, plus keyboard and reflow checks.
import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page } from "@playwright/test";
import { loginAs } from "./helpers";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
async function scan(page: Page, name: string) {
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const bad = r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  expect(bad, `${name} accessibility violations`).toEqual([]);
}

test.describe.configure({ mode: "serial" });

test("login page is accessible", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "FollowMe" })).toBeVisible();
  await scan(page, "login");
});

test("learner screens are accessible (home, library, search results, guide, guided view, ask, training, notifications)", async ({ page }) => {
  await loginAs(page, "lena@contoso.example");
  await scan(page, "home");
  await page.goto("/library"); await expect(page.getByRole("heading", { name: "Library" })).toBeVisible(); await scan(page, "library");
  await page.goto("/library?q=purchase+order"); await expect(page.getByText(/result/).first()).toBeVisible(); await scan(page, "search results");
  await page.goto("/g/WI-0001"); await expect(page.getByRole("heading", { level: 1 })).toBeVisible(); await scan(page, "guide view");
  await page.goto("/g/WI-0001/guided"); await expect(page.getByText(/Step 1 of/)).toBeVisible(); await scan(page, "guided view");
  await page.goto("/ask"); await scan(page, "ask");
  await page.goto("/training"); await scan(page, "training");
  await page.goto("/notifications"); await scan(page, "notifications");
});

test("author screens are accessible (workspace, editor, annotation dialog, governance, capture, import)", async ({ page }) => {
  await loginAs(page, "alice@contoso.example");
  await page.goto("/workspace"); await expect(page.getByRole("heading", { name: "Workspace" })).toBeVisible(); await scan(page, "workspace");
  await page.goto("/captures"); await scan(page, "capture");
  await page.goto("/imports"); await scan(page, "imports");
  await page.goto("/workspace");
  const link = page.getByRole("link", { name: /Receive goods/ }).first();
  await link.click();
  await page.waitForURL(/\/guides\/[a-z0-9]+$/);
  await expect(page.getByRole("heading", { name: "Workflow actions" })).toBeVisible();
  await scan(page, "governance");
  await page.getByRole("link", { name: /working version/ }).first().click();
  await expect(page.getByTestId("save-status")).toBeVisible();
  await page.getByRole("button", { name: "Add step" }).click();
  await expect(page.locator("li.step-edit").first()).toBeVisible();
  await scan(page, "editor (edit mode)");
  for (const m of ["Preview: desktop", "Preview: mobile", "Preview: print"]) { await page.getByRole("button", { name: m }).click(); await scan(page, `editor ${m}`); }
});

test("reviewer, owner, admin, auditor screens are accessible", async ({ page }) => {
  await loginAs(page, "rita@contoso.example"); await page.goto("/review"); await expect(page.getByRole("heading", { name: "Review queue" })).toBeVisible(); await scan(page, "review queue");
  await loginAs(page, "olivia@contoso.example"); await page.goto("/dashboard"); await expect(page.getByRole("heading", { name: /Owners/ })).toBeVisible(); await scan(page, "owner dashboard");
  await page.goto("/analytics"); await expect(page.getByRole("heading", { name: "Process analytics" })).toBeVisible(); await scan(page, "analytics");
  await page.goto("/blocks"); await scan(page, "blocks");
  await loginAs(page, "ada@contoso.example"); await page.goto("/admin"); await expect(page.getByRole("heading", { name: "Administration" })).toBeVisible(); await scan(page, "admin");
  await loginAs(page, "aud@contoso.example"); await page.goto("/audit"); await expect(page.getByText(/Hash chain verified/)).toBeVisible(); await scan(page, "audit");
});

test("keyboard and reflow: skip link, visible focus, no horizontal scroll at 320px", async ({ page }) => {
  await loginAs(page, "lena@contoso.example");
  await page.goto("/library");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeVisible();
  await page.setViewportSize({ width: 320, height: 700 });
  for (const url of ["/library", "/g/WI-0001", "/g/WI-0001/guided", "/ask"]) {
    await page.goto(url);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${url} horizontal overflow at 320px`).toBeLessThanOrEqual(1);
  }
});

test("dark colour scheme remains accessible", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await loginAs(page, "lena@contoso.example");
  await page.goto("/g/WI-0001"); await expect(page.getByRole("heading", { level: 1 })).toBeVisible(); await scan(page, "guide view (dark)");
  await page.goto("/library"); await scan(page, "library (dark)");
});
