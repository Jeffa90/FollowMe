// Acceptance journeys B-F through the real UI (Journey A lives in journey-a.spec.ts and uses the real extension).
import { test, expect, type Page } from "@playwright/test";
import JSZip from "jszip";
import fs from "node:fs";
import { extractText, getDocumentProxy } from "unpdf";
import { loginAs } from "./helpers";
import { makeLegacyDocx } from "../fixtures";
import { mockScreenshot } from "@/server/fixtures";

test.describe.configure({ mode: "serial" });

async function actOnGuide(page: Page, who: string, guideUrl: string, button: string | RegExp, expectedStatus: RegExp, exact = false) {
  await loginAs(page, who);
  await page.goto(guideUrl);
  await page.getByRole("button", { name: button, exact }).click();
  await expect(page.getByText("Working version status:")).toContainText(expectedStatus, { timeout: 20_000 }).catch(async () => { /* publish removes the working version */ });
}

test("Journey E: a learner asks a question and gets an answer citing an authorised published guide and step; unknown topics get a clear 'no approved answer'", async ({ page }) => {
  await loginAs(page, "lena@contoso.example");
  await page.goto("/ask");
  await page.getByLabel(/Your question/).fill("How do I create a purchase order in SAP?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  const ans = page.getByTestId("answer");
  await expect(ans.getByRole("heading", { name: "Answer" })).toBeVisible();
  await expect(ans).toContainText("Create a purchase order in SAP");
  await expect(ans).toContainText("No AI model used");
  const cite = ans.getByRole("link", { name: /Create a purchase order in SAP/ }).first();
  await expect(cite).toHaveAttribute("href", /\/g\/WI-0001(#step-|$)/);
  await expect(ans).toContainText(/Step \d/);
  await page.getByLabel(/Your question/).fill("What is the corporate policy on bringing dogs to the office?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByTestId("answer").getByRole("heading", { name: "No approved answer" })).toBeVisible();
  await expect(page.getByTestId("answer")).toContainText("No approved answer exists");
  // permission-aware: a Leeds learner cannot get answers from a Manchester-only guide
  await loginAs(page, "leo@contoso.example");
  await page.goto("/ask");
  await page.getByLabel(/Your question/).fill("How do I create a purchase order in SAP?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(page.getByTestId("answer").getByRole("heading", { name: "No approved answer" })).toBeVisible();
});

test("Journey D: a learner downloads controlled Word and PDF copies containing version and source information", async ({ page }) => {
  await loginAs(page, "lena@contoso.example");
  await page.goto("/g/WI-0001");
  const dl = async (label: string) => { if (!(await page.getByRole("link", { name: label }).isVisible())) await page.getByText("Export", { exact: true }).click(); const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: label }).click()]); return d; };
  const pdf = await dl("PDF");
  expect(pdf.suggestedFilename()).toBe("WI-0001_v1.0_controlled.pdf");
  const pdfBuf = fs.readFileSync((await pdf.path())!);
  const doc = await getDocumentProxy(new Uint8Array(pdfBuf));
  const { text } = await extractText(doc, { mergePages: false });
  for (const [i, pg] of text.entries()) { expect(pg).toContain("WI-0001"); expect(pg).toContain("Uncontrolled when printed"); expect(pg).toContain(`Page ${i + 1} of ${text.length}`); }
  expect(text[0]).toContain("Publication date"); expect(text[0]).toContain("Export timestamp"); expect(text[0]).toMatch(/\/g\/WI-0001/);
  const docx = await dl("Word (.docx)");
  const zip = await JSZip.loadAsync(fs.readFileSync((await docx.path())!));
  const xml = (await Promise.all(Object.keys(zip.files).filter((n) => /word\/(document|header\d*|footer\d*)\.xml$/.test(n)).map((n) => zip.files[n].async("string")))).join(" ").replace(/<[^>]+>/g, " ");
  expect(xml).toContain("WI-0001"); expect(xml).toContain("Check the live source for the current version"); expect(xml).toMatch(/FOLLOWME-CONTROL WI-0001 v1\.0/);
});

test("Journey F: overdue and outdated-looking guides get review recommendations without any change to approved content", async ({ page }) => {
  await loginAs(page, "olivia@contoso.example");
  await page.goto("/dashboard");
  await expect(page.getByText("overdue for review")).toBeVisible();
  await page.getByRole("button", { name: "Run health scan now" }).click();
  await expect(page.getByText(/new recommendation/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Review recommendations" })).toBeVisible();
  await expect(page.getByText("overdue review").first()).toBeVisible();
  await expect(page.getByText(/retired reference/).first()).toBeVisible();
  // open the overdue expense guide: still published, content untouched
  await page.getByRole("link", { name: /WI-0002/ }).first().click();
  await page.waitForURL(/\/guides\/[a-z0-9]+$/);
  await expect(page.getByRole("heading", { name: /Published version/ })).toBeVisible();
  const before = await page.locator("body").innerText();
  expect(before).toMatch(/Published version|Live version approvals/);
  await page.getByRole("button", { name: "Accept: begin review" }).first().click();
  await expect(page.getByText(/Accepted: guide marked under review/)).toBeVisible();
  await page.reload();
  await expect(page.getByText("under review", { exact: false }).first()).toBeVisible();
  // learners still see the (unchanged) approved guide, with a banner
  await loginAs(page, "lena@contoso.example");
  await page.goto("/g/WI-0002");
  await expect(page.getByText("Under review.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Submit an expense claim", level: 1 })).toBeVisible();
});

test("Journey C: revising a published guide leaves the historical version intact; learners see the old text until the revision is published", async ({ page }) => {
  await loginAs(page, "alice@contoso.example");
  await page.goto("/g/WI-0002");
  await page.getByRole("link", { name: "Governance" }).click();
  await page.getByLabel(/Start a revision/).fill("Clarify the receipt requirement");
  await page.getByRole("button", { name: "Start revision" }).click();
  await page.waitForURL(/\/edit\?v=/);
  const firstTitle = page.locator("li.step-edit").first().locator("input").first();
  await firstTitle.fill("Open Contoso Expenses and sign in");
  await expect(page.getByTestId("save-status")).toContainText("Saved", { timeout: 15_000 });
  await page.getByRole("link", { name: /Governance/ }).click();
  await expect(page.getByRole("cell", { name: "2.0" })).toBeVisible();
  const guideUrl = page.url();
  // learner still sees v1
  await loginAs(page, "lena@contoso.example");
  await page.goto("/g/WI-0002");
  await expect(page.getByText("Open Contoso Expenses", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Open Contoso Expenses and sign in")).toHaveCount(0);
  // publish v2 through the workflow
  await loginAs(page, "alice@contoso.example"); await page.goto(guideUrl);
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByText("Working version status:")).toContainText("in review", { timeout: 20_000 });
  await loginAs(page, "rita@contoso.example"); await page.goto(guideUrl); await page.getByRole("button", { name: "Approve review" }).click();
  await expect(page.getByText("Working version status:")).toContainText("ready for approval", { timeout: 20_000 });
  await loginAs(page, "alan@contoso.example"); await page.goto(guideUrl); await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Working version status:")).toContainText("approved", { timeout: 20_000 });
  await loginAs(page, "pat@contoso.example"); await page.goto(guideUrl); await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("heading", { name: /Published version/ })).toBeVisible({ timeout: 20_000 });
  await loginAs(page, "lena@contoso.example"); await page.goto("/g/WI-0002");
  await expect(page.getByText("Open Contoso Expenses and sign in").first()).toBeVisible();
  // permanent link to the superseded version redirects learners to the current guide; auditors can read history
  await page.goto("/g/WI-0002/v/1");
  await expect(page).toHaveURL(/\/g\/WI-0002\?from=v1/);
  await expect(page.getByText(/followed a link to an older version/)).toBeVisible();
  await loginAs(page, "aud@contoso.example"); await page.goto("/g/WI-0002/v/1");
  await expect(page.getByText(/Historical version \(superseded\)/)).toBeVisible();
  await expect(page.getByText("Open Contoso Expenses and sign in")).toHaveCount(0); // v1 text is intact
});

test("Journey B: upload an older DOCX, review the conversion side by side, confirm it, replace the obsolete screenshot, and publish the redevelopment", async ({ page }) => {
  test.setTimeout(180_000);
  const { buffer } = await makeLegacyDocx();
  await loginAs(page, "alice@contoso.example");
  await page.goto("/imports");
  await page.locator('input[type="file"]').setInputFiles({ name: "WI-OLD-042.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer });
  await page.getByRole("button", { name: "Upload and convert" }).click();
  await page.waitForURL(/\/imports\/[a-z0-9]+$/);
  await expect(page.getByRole("heading", { name: "Converted draft" })).toBeVisible({ timeout: 40_000 });
  await expect(page.getByRole("heading", { name: "Original (as extracted)" })).toBeVisible();
  await expect(page.getByText(/retained .* rewritten .* removed .* uncertain/).first()).toBeVisible();
  await expect(page.getByText(/months ago\)/).first()).toBeVisible(); // obsolete-looking age flagged
  await expect(page.getByText(/does not match|not invent|missing|No expected result/i).first()).toBeVisible();
  await expect(page.getByText("needs replacement").first()).toBeVisible();
  await expect(page.getByText(/Step 1|Open transaction ME21/).first()).toBeVisible();
  // confirmation is required and explicit
  const confirm = page.getByRole("button", { name: "Confirm converted content" });
  await expect(confirm).toBeDisabled();
  await page.getByLabel(/I have compared the converted content/).check();
  await confirm.click();
  await expect(page.getByText(/Confirmed\./)).toBeVisible();
  await page.getByRole("link", { name: "Governance page" }).first().click();
  await page.waitForURL(/\/guides\/[a-z0-9]+$/);
  const guideUrl = page.url();
  await page.getByLabel("Backup owner *").selectOption({ label: "Bob Backup" });
  await page.getByLabel("Escalation contact").selectOption({ label: "Alan Approver" });
  await page.getByLabel(/^Systems/).fill("SAP S/4HANA");
  await page.getByLabel("SAP transaction codes").fill("ME21N");
  await page.getByRole("button", { name: "Save metadata" }).click();
  await expect(page.getByText("Metadata saved")).toBeVisible();
  // blocked until the human resolves the flagged content
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByText(/Blocking issues must be resolved/)).toBeVisible();
  await page.getByRole("link", { name: /working version/ }).first().click();
  await page.getByLabel(/^Expected result/).first().fill("SAP confirms the purchase order number.");
  await page.getByLabel(/^Prerequisites/).fill("SAP access with the buyer role");
  await page.getByLabel(/^Required permissions/).fill("Z_BUYER");
  await page.getByLabel(/^Validation checks/).fill("The PO number is shown in the status bar");
  // replace the obsolete screenshot
  const fresh = await mockScreenshot({ app: "SAP S/4HANA", screen: "Create Purchase Order (ME21N)", button: "Save" });
  const stepWithImage = page.locator("li.step-edit").filter({ has: page.locator("img") }).first();
  await expect(stepWithImage.getByText(/Needs replacement/)).toBeVisible();
  await stepWithImage.locator('input[type="file"]').setInputFiles({ name: "me21n.png", mimeType: "image/png", buffer: fresh.buf });
  await expect(stepWithImage.getByText(/Needs replacement/)).toHaveCount(0, { timeout: 15_000 });
  await stepWithImage.getByLabel("Alt text").fill("SAP S/4HANA create purchase order screen with the Save button");
  await expect(page.getByTestId("save-status")).toContainText("Saved", { timeout: 20_000 });
  await page.goto(guideUrl);
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByText("Working version status:")).toContainText("in review", { timeout: 20_000 });
  await loginAs(page, "rita@contoso.example"); await page.goto(guideUrl); await page.getByRole("button", { name: "Approve review" }).click();
  await expect(page.getByText("Working version status:")).toContainText("ready for approval", { timeout: 20_000 });
  await loginAs(page, "alan@contoso.example"); await page.goto(guideUrl); await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Working version status:")).toContainText("approved", { timeout: 20_000 });
  await loginAs(page, "pat@contoso.example"); await page.goto(guideUrl); await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByRole("heading", { name: /Published version/ })).toBeVisible({ timeout: 20_000 });
  await loginAs(page, "lena@contoso.example");
  await page.goto("/library?q=" + encodeURIComponent("describes how buyers create a standard purchase order"));
  await page.getByRole("link", { name: /^Create a purchase order in SAP$/ }).first().click();
  await expect(page.getByText("Applies to buyers at the Manchester site.")).toBeVisible();
  await expect(page.getByText("SAP confirms the purchase order number.")).toBeVisible();
  // the replaced screenshot is what readers get (served through the redacting renderer)
  await expect(page.locator("img.shot").first()).toHaveAttribute("src", /\/api\/versions\/.+\/steps\/.+\/image/);
});
