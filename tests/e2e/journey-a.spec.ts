// Journey A: record (real extension) -> generate -> edit -> review -> approve -> publish -> search
import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = `http://localhost:${process.env.E2E_PORT ?? "3100"}`;
const EXT = path.resolve("extension/dist");
const LOCAL_CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const CHROME = process.env.CHROMIUM_PATH ?? (fs.existsSync(LOCAL_CHROME) ? LOCAL_CHROME : chromium.executablePath());
const SECRET_PASSWORD = "S3cretPassw0rd!";
const CARD = "4111111111111111";

async function login(page: Page, who: string) {
  await page.context().clearCookies();
  await page.goto(`${BASE}/login`);
  await page.getByRole("button", { name: new RegExp(who, "i") }).first().click();
  await page.waitForURL(`${BASE}/`);
}

test("Journey A: record, edit, review, approve, publish and search a process", async () => {
  test.setTimeout(120_000);
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), "fm-ext-"));
  const context: BrowserContext = await chromium.launchPersistentContext(userDir, {
    executablePath: CHROME, headless: false,
    args: ["--headless=new", "--no-sandbox", `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--window-size=1280,900"],
    viewport: { width: 1200, height: 800 },
  });
  try {
    let sw = context.serviceWorkers()[0];
    if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 30_000 });

    console.log("STEP: Author signs in and creates a capture token (scoped, revocable)");
    const web = await context.newPage();
    await login(web, "alice");
    await web.goto(`${BASE}/captures`);
    await web.getByRole("button", { name: "Create token" }).click();
    const token = (await web.getByTestId("capture-token").textContent())!.trim();
    expect(token).toMatch(/^fmt_/);
    await sw.evaluate(async ([baseUrl, tok]) => { await chrome.storage.local.set({ cfg: { baseUrl, token: tok } }); }, [BASE, token]);

    console.log("STEP: Start recording the demo application in its own tab");
    const app = await context.newPage();
    await app.goto(`${BASE}/demo/expenses`);
    const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: "*://localhost/*demo/expenses*" }))[0]?.id ?? (await chrome.tabs.query({}))[0].id);
    await app.bringToFront(); // the recorded tab must be the active tab (screenshots are only taken of the active recorded tab)
    const started = await sw.evaluate((id) => globalThis.__followme.start(id), tabId as number).then((r) => ({ ...r, error: undefined }), (e) => ({ error: String(e) }));
    expect(started.error).toBeUndefined();
    await expect.poll(() => sw.evaluate(() => chrome.action.getBadgeText({}))).toBe("REC"); // visible recording indicator

    await app.bringToFront();
    await app.getByLabel("Work email").fill("jane.doe@contoso.example");
    await app.getByLabel("Password").fill(SECRET_PASSWORD);
    await app.getByRole("button", { name: "Sign in" }).click();
    await app.waitForURL("**/claims**");
    await app.waitForTimeout(800);

    // Immediate pause: actions while paused must not be recorded
    await sw.evaluate(() => globalThis.__followme.pause());
    await expect.poll(() => sw.evaluate(() => chrome.action.getBadgeText({}))).toBe("II");
    await app.getByRole("button", { name: "New claim" }).click(); // recorded? no: paused
    await app.waitForURL("**/new");
    await sw.evaluate(() => globalThis.__followme.resume());
    await expect.poll(() => sw.evaluate(() => chrome.action.getBadgeText({}))).toBe("REC");

    await app.bringToFront();
    await app.getByLabel("Description").fill("Client lunch");
    await app.getByLabel("Description").blur();
    await app.getByLabel("Category").focus();
    await app.keyboard.press("ArrowDown"); // real (trusted) keyboard input: Travel -> Meals (synthetic selectOption events are ignored by design)
    await app.getByLabel("Payment card number").fill(CARD);
    await app.getByLabel("Payment card number").blur();
    await app.getByRole("button", { name: "Submit claim" }).click();
    await app.waitForURL("**/done**");
    await app.waitForTimeout(1200);

    await sw.evaluate(() => globalThis.__followme.stop());
    await expect.poll(() => sw.evaluate(() => chrome.action.getBadgeText({}))).toBe("");

    console.log("STEP: Review the evidence: no secrets stored anywhere");
    await web.bringToFront();
    await web.goto(`${BASE}/captures`);
    await web.getByRole("link", { name: "Open" }).first().click();
    await web.waitForURL(/\/captures\/[a-z0-9]+$/);
    await expect(web.getByRole("heading", { name: "Recording", exact: true })).toBeVisible();
    const sessionId = web.url().split("/captures/")[1];
    const dump = await web.evaluate(async (id) => (await fetch(`/api/capture/sessions/${id}`)).text(), sessionId);
    expect(dump).not.toContain(SECRET_PASSWORD);
    expect(dump).not.toContain(CARD);
    expect(dump).not.toContain("Client lunch"); // typed values are never captured
    expect(dump).not.toContain("jane.doe@contoso.example"); // page text matching redaction patterns is redacted from metadata
    const events = JSON.parse(dump).events as { type: string; target: Record<string, unknown> }[];
    expect(events.some((e) => e.type === "click")).toBe(true);
    expect(events.find((e) => e.target.inputType === "password")?.target.valueLength).toBeUndefined(); // even lengths of sensitive fields are omitted

    console.log("STEP: Generate the draft guide");
    await web.getByRole("button", { name: "Generate draft guide" }).click();
    await web.waitForURL("**/edit**");
    const titles = () => web.locator("li.step-edit").evaluateAll((els) => els.map((e) => (e.querySelector("input") as HTMLInputElement | null)?.value ?? ""));
    await expect.poll(titles).toContain("Click Submit claim");
    const allTitles = await titles();
    expect(allTitles.join("|")).not.toContain("New claim"); // the click made while paused was not recorded
    expect(allTitles.some((t) => t.includes("Choose Meals"))).toBe(true);
    // The step during the paused interval ("New claim" click) was not recorded
    const steps = await web.locator("li.step-edit").count();
    expect(steps).toBeGreaterThanOrEqual(4);

    console.log("STEP: Edit: scope + a step title; autosave");
    await web.getByLabel("Scope *").fill("Employees submitting expense claims in Contoso Expenses.");
    await web.getByLabel("Purpose *").fill("Submit a business expense claim for reimbursement.");
    await web.getByLabel("Expected result *").fill("The claim shows as submitted and the manager is notified.");
    await expect(web.getByTestId("save-status")).toContainText("Saved", { timeout: 15_000 });

    console.log("STEP: Governance details, submit");
    const guideUrl = web.url().replace(/\/edit.*/, "");
    await web.goto(guideUrl);
    await web.getByLabel("Backup owner *").selectOption({ label: "Bob Backup" });
    await web.getByLabel("Escalation contact").selectOption({ label: "Alan Approver" });
    await web.getByRole("button", { name: "Save metadata" }).click();
    await expect(web.getByText("Metadata saved")).toBeVisible();
    await web.getByRole("button", { name: "Submit for review" }).click();
    await expect(web.getByText("Working version status:")).toContainText("in review", { timeout: 15_000 });

    console.log("STEP: Reviewer, approver, publisher");
    await login(web, "rita");
    await web.goto(guideUrl);
    await web.getByRole("button", { name: "Approve review" }).click();
    await expect(web.getByText("Working version status:")).toContainText("ready for approval", { timeout: 15_000 });
    await login(web, "alan");
    await web.goto(guideUrl);
    await web.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(web.getByText("Working version status:")).toContainText("approved", { timeout: 15_000 });
    await login(web, "pat");
    await web.goto(guideUrl);
    await web.getByRole("button", { name: "Publish" }).click();
    await expect(web.getByRole("heading", { name: /Published version/ })).toBeVisible({ timeout: 15_000 });

    console.log("STEP: Learner finds it via search");
    await login(web, "lena");
    await web.goto(`${BASE}/library?q=${encodeURIComponent("submit claim")}`);
    await expect(web.getByRole("link", { name: /Submit claim in Contoso Expenses/ }).first()).toBeVisible();
  } finally {
    await context.close();
  }
});
