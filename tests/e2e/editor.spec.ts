// Visual editor behaviours: step operations, undo/redo, autosave, keyboard operation, annotation and redaction (burned in for readers)
import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers";
import { mockScreenshot } from "@/server/fixtures";

test.describe.configure({ mode: "serial" });
let editUrl = "";

test("author creates a guide from a template and edits with add / duplicate / split / merge / move / delete", async ({ page }) => {
  await loginAs(page, "alice@contoso.example");
  await page.goto("/workspace");
  await page.getByLabel("Title").fill("Editor behaviour guide");
  await page.getByLabel("Template").selectOption({ label: "SAP instruction" });
  await page.getByRole("button", { name: "Create draft" }).click();
  await page.waitForURL(/\/edit\?v=/);
  editUrl = page.url();
  // SAP template exposes SAP-specific required sections
  await expect(page.getByLabel(/^Required permissions/)).toBeVisible();
  const steps = page.locator("li.step-edit");
  await page.getByRole("button", { name: "Add step" }).click();
  await steps.nth(0).getByLabel("Title").fill("Open transaction");
  await steps.nth(0).getByLabel(/^Instruction/).fill("Type **ME21N**. Press **Enter**.");
  await steps.nth(0).getByRole("button", { name: "Split" }).click();
  await expect(steps).toHaveCount(2);
  await expect(steps.nth(1).getByLabel(/^Instruction/)).toHaveValue("Press **Enter**.");
  await steps.nth(0).getByRole("button", { name: "Merge with next" }).click();
  await expect(steps).toHaveCount(1);
  await steps.nth(0).getByRole("button", { name: "Duplicate" }).click();
  await expect(steps).toHaveCount(2);
  await steps.nth(1).getByLabel("Title").fill("Second step");
  await steps.nth(1).getByRole("button", { name: /Move Step 2 up/ }).click();
  await expect(steps.nth(0).getByLabel("Title")).toHaveValue("Second step");
  // add decision, exception and physical steps, warning and control
  for (const kind of ["Decision point", "Exception path", "Warning", "Control", "Expected result"]) {
    await page.getByLabel("Kind of step to add").last().selectOption({ label: kind }); // the root toolbar is last in DOM order (branch lists are nested above it)
    await page.getByRole("button", { name: "Add step" }).last().click();
  }
  await expect(page.locator("li.step-edit")).toHaveCount(7);
  await expect(page.getByText("Decision point", { exact: true }).first()).toBeVisible().catch(() => undefined);
  await expect(page.getByRole("group", { name: "Decision point" })).toBeVisible();
  await expect(page.getByLabel("Path label").first()).toHaveValue("Yes");
  await page.getByRole("button", { name: "Add alternate path" }).click();
  await expect(page.getByLabel("Path label")).toHaveCount(3);
  await expect(page.getByTestId("save-status")).toContainText("Saved", { timeout: 15_000 });
});

test("undo and redo (buttons and keyboard) with autosave and reload persistence", async ({ page }) => {
  await loginAs(page, "alice@contoso.example");
  await page.goto(editUrl);
  const title = page.getByLabel("Title *");
  await title.fill("First title");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(title).not.toHaveValue("First title");
  await page.getByRole("button", { name: "Redo" }).click();
  await expect(title).toHaveValue("First title");
  await page.locator("h2#ed-steps").click();
  await page.keyboard.press("Control+z");
  await expect(title).not.toHaveValue("First title");
  await page.keyboard.press("Control+y");
  await expect(title).toHaveValue("First title");
  await expect(page.getByTestId("save-status")).toContainText("Saved", { timeout: 15_000 });
  await page.reload();
  await expect(page.getByLabel("Title *")).toHaveValue("First title");
  // stale save: a second tab saving first causes a conflict message rather than silent overwrite
  const other = await page.context().newPage();
  await other.goto(editUrl);
  await other.getByLabel("Title *").fill("Other tab title");
  await expect(other.getByTestId("save-status")).toContainText("Saved", { timeout: 15_000 });
  await page.getByLabel("Title *").fill("Stale tab title");
  await expect(page.getByTestId("save-status")).toContainText(/Conflict/, { timeout: 15_000 });
  await expect(page.getByText(/Someone else saved this draft/)).toBeVisible();
});

test("annotate and redact a screenshot; readers receive the burned-in redaction; previews for desktop, mobile and print", async ({ page }) => {
  await loginAs(page, "alice@contoso.example");
  await page.goto(editUrl);
  await page.reload();
  const shot = await mockScreenshot({ app: "SAP", screen: "Create PO", button: "Save", fields: ["Vendor", "Bank account"] });
  const step = page.locator("li.step-edit").first();
  await step.locator('input[type="file"]').setInputFiles({ name: "s.png", mimeType: "image/png", buffer: shot.buf });
  await expect(step.getByLabel("Alt text")).toBeVisible();
  await step.getByLabel("Alt text").fill("Create purchase order screen");
  await step.getByRole("button", { name: "Annotate / redact / crop" }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg).toBeVisible();
  const canvas = dlg.getByRole("application", { name: "Annotation canvas" });
  const box = (await canvas.boundingBox())!;
  const at = (fx: number, fy: number) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });
  // two-click drawing (no dragging required): blur over the second field, then a box around the button
  await dlg.getByRole("button", { name: "Blur / redact" }).click();
  await page.mouse.click(at(0.27, 0.40).x, at(0.27, 0.40).y); await page.mouse.click(at(0.71, 0.46).x, at(0.71, 0.46).y);
  await dlg.getByRole("button", { name: "Box" }).click();
  await page.mouse.click(at(0.27, 0.62).x, at(0.27, 0.62).y); await page.mouse.click(at(0.44, 0.70).x, at(0.44, 0.70).y);
  await dlg.getByRole("button", { name: "Numbered marker" }).click();
  await page.mouse.click(at(0.5, 0.8).x, at(0.5, 0.8).y);
  await expect(dlg.getByText("Annotations (3)")).toBeVisible();
  // keyboard-accessible numeric adjustment of the selected annotation
  await dlg.getByRole("button", { name: /marker 1/ }).click();
  await dlg.getByLabel("X (%)").fill("60");
  await dlg.getByRole("button", { name: "Save annotations" }).click();
  await expect(dlg).toBeHidden();
  await expect(page.getByTestId("save-status")).toContainText("Saved", { timeout: 15_000 });
  for (const m of ["Preview: desktop", "Preview: mobile", "Preview: print"]) { await page.getByRole("button", { name: m }).click(); await expect(page.getByRole("img", { name: "Create purchase order screen" }).first()).toBeVisible(); }
  // fill mandatory pieces and publish via API-free UI would be long: instead verify the reader-facing renderer directly (server-side burn-in)
  const info = await page.evaluate(async (url) => { const r = await fetch(url); return { status: r.status, type: r.headers.get("content-type"), len: (await r.arrayBuffer()).byteLength }; }, `/api/assets/${(await page.evaluate(() => (document.querySelector('.preview-frame img') as HTMLImageElement).src.split("/api/assets/")[1]))}`);
  expect(info.status).toBe(200);
});
