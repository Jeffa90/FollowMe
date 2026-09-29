// Journey D: controlled Word and PDF exports carry version and source information
import { beforeAll, describe, expect, it } from "vitest";
import JSZip from "jszip";
import sharp from "sharp";
import { extractText, getDocumentProxy } from "unpdf";
import { prisma } from "@/server/db";
import { freshOrg } from "./helpers";
import { createGuide, saveContent, getVersionDetail, submitForReview, reviewDecision, approvalDecision, publishVersion } from "@/server/services/guides";
import { exportVersion } from "@/server/services/exports";
import { storeAsset, renderImageForExport } from "@/server/services/assets";
import { mockScreenshot } from "@/server/fixtures";
import { newId, newStep } from "@/lib/guide-schema";
import { extractDocument } from "@/server/import/extract";
import { convertToGuide } from "@/server/import/convert";

let s: Awaited<ReturnType<typeof freshOrg>>;
let versionId: string, guideId: string, docId: string, draftVersionId: string, shot: Awaited<ReturnType<typeof mockScreenshot>>;

beforeAll(async () => {
  s = await freshOrg();
  const alice = await s.ctx("alice");
  shot = await mockScreenshot({ app: "Contoso Expenses", screen: "New claim", button: "Submit claim", fields: ["Description", "Amount", "Category"] });
  const mk = async (title: string) => {
    const { guide, version } = await createGuide(alice, { title, metadata: { ownerId: s.users.olivia.id, backupOwnerId: s.users.bob.id, escalationUserId: s.users.alan.id, systems: ["Contoso Expenses"] } });
    const asset = await storeAsset(alice, { buffer: shot.buf, filename: "s.png", purpose: "CONTENT", allow: ["png"], guideId: guide.id });
    const d = await getVersionDetail(alice, version.id);
    await saveContent(alice, version.id, {
      ...d.content, purpose: "Claim expenses <b>safely</b>.", scope: "All staff.", expectedResult: "Claim submitted.",
      steps: [
        newStep("action", { title: "Open the form", text: "Click **New claim**.", image: { assetId: asset.id, alt: "New claim form", annotations: [{ id: newId("a"), kind: "box", x: 0.27, y: 0.24, w: 0.44, h: 0.07 }, { id: newId("a"), kind: "blur", x: 0.27, y: 0.38, w: 0.44, h: 0.07 }] } }),
        newStep("warning", { text: "Receipts are required. <script>alert(1)</script> [x](javascript:alert(1))" }),
        newStep("action", { title: "Submit", text: "Press **Submit claim**. Ünïcode ✓ check." }),
      ],
    }, d.rev);
    return { guide, version };
  };
  const a = await mk("Submit an expense claim");
  await submitForReview(alice, a.version.id);
  await reviewDecision(await s.ctx("rita"), a.version.id, { decision: "APPROVE" });
  await approvalDecision(await s.ctx("alan"), a.version.id, { decision: "APPROVE" });
  await publishVersion(await s.ctx("pat"), a.version.id);
  versionId = a.version.id; guideId = a.guide.id; docId = a.guide.documentId;
  draftVersionId = (await mk("Unpublished draft guide")).version.id;
});

describe("Journey D: controlled exports", () => {
  it("Word export contains document ID, version, publication date, export timestamp, controlled-source reference and live-source warning", async () => {
    const r = await exportVersion(await s.ctx("lena"), versionId, "docx");
    expect(r.filename).toBe(`${docId}_v1.0_controlled.docx`);
    const zip = await JSZip.loadAsync(r.buffer);
    const all = (await Promise.all(Object.keys(zip.files).filter((n) => /word\/(document|header\d*|footer\d*)\.xml$/.test(n)).map((n) => zip.files[n].async("string")))).join("\n");
    const text = all.replace(/<[^>]+>/g, " ");
    expect(text).toContain(docId);
    expect(text).toContain("1.0");
    expect(text).toContain(r.control.publishedAt!);
    expect(text).toContain(r.control.exportedAt);
    expect(all).toContain("http://localhost:3000/g/" + docId);
    expect(text).toMatch(/Check the live source for the current version/);
    expect(text).toContain("Uncontrolled when printed");
    expect(Object.keys(zip.files).some((n) => n.startsWith("word/media/"))).toBe(true); // screenshots embedded
    expect(await zip.file("docProps/custom.xml")!.async("string")).toContain("FollowMeContentHash");
    // it round-trips through the import pipeline (it is a valid, readable Word file)
    const { doc } = await extractDocument(r.buffer, "docx", "export.docx");
    expect(doc.blocks.some((b) => /Submit an expense claim/.test(b.text))).toBe(true);
    // injected markup is text, not structure
    expect(all).not.toContain("<script>"); // stays inert text (XML-escaped), never structure
    expect(text).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("PDF export carries the control information on every page", async () => {
    const r = await exportVersion(await s.ctx("lena"), versionId, "pdf");
    expect(r.buffer.subarray(0, 5).toString()).toBe("%PDF-");
    const pdf = await getDocumentProxy(new Uint8Array(r.buffer));
    const { text } = await extractText(pdf, { mergePages: false });
    expect(text.length).toBeGreaterThanOrEqual(1);
    text.forEach((pg, i) => {
      expect(pg).toContain(docId);
      expect(pg).toMatch(/Uncontrolled when printed/);
      expect(pg).toContain(`Page ${i + 1} of ${text.length}`);
      expect(pg).toContain("http://localhost:3000/g/" + docId);
    });
    expect(text[0]).toContain(r.control.publishedAt!);
    expect(text[0]).toContain("Version");
    expect(text[0]).toContain("Export timestamp");
    expect(text.join(" ")).toContain("Check the live source for the current version");
    const meta = await pdf.getMetadata();
    expect(String((meta.info as Record<string, string>).Keywords)).toContain("FOLLOWME-CONTROL " + docId);
  });

  it("HTML, Markdown and offline package are escaped, controlled copies", async () => {
    const lena = await s.ctx("lena");
    const html = (await exportVersion(lena, versionId, "html")).buffer.toString();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Check the live source for the current version");
    expect(html).toContain("data:image/png;base64,");
    const md = (await exportVersion(lena, versionId, "md")).buffer.toString();
    expect(md).toContain(`FOLLOWME-CONTROL ${docId}`);
    expect(md).not.toContain("[x](javascript:");
    expect(md).toContain("_[Screenshot: New claim form]_");
    const zip = await JSZip.loadAsync((await exportVersion(lena, versionId, "zip")).buffer);
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    expect(manifest).toMatchObject({ documentId: docId, version: "1.0", controlledSource: `http://localhost:3000/g/${docId}` });
    expect(Object.keys(zip.files)).toEqual(expect.arrayContaining(["index.html", "guide.md", "README-CONTROLLED.txt"]));
  });

  it("redaction is burned into exported and served images (blurred pixels cannot be recovered)", async () => {
    const d = await getVersionDetail(await s.ctx("alice"), versionId);
    const step = d.content.steps[0];
    const out = await renderImageForExport(s.org.id, step.image!, 960);
    const orig = await sharp(shot.buf).extract({ left: 260 + 20, top: 232, width: 200, height: 20 }).raw().toBuffer();
    const red = await sharp(out).extract({ left: 260 + 20, top: 232, width: 200, height: 20 }).raw().toBuffer();
    let diff = 0; for (let i = 0; i < Math.min(orig.length, red.length); i++) diff += Math.abs(orig[i] - red[i]);
    expect(diff / red.length).toBeGreaterThan(5);
  });

  it("access control: drafts are not exportable by learners; authors get DRAFT-marked copies; every export is recorded and audited", async () => {
    await expect(exportVersion(await s.ctx("lena"), draftVersionId, "pdf")).rejects.toMatchObject({ status: 404 });
    const r = await exportVersion(await s.ctx("alice"), draftVersionId, "html");
    expect(r.filename).toContain("DRAFT");
    expect(r.buffer.toString()).toContain("DRAFT: NOT APPROVED");
    await expect(exportVersion(await s.ctx("lena"), versionId, "exe")).rejects.toMatchObject({ status: 400 });
    const recs = await prisma.exportRecord.findMany({ where: { versionId } });
    expect(recs.length).toBeGreaterThanOrEqual(4);
    expect(recs[0].sha256).toHaveLength(64);
    expect((await prisma.auditEvent.count({ where: { versionId, action: "EXPORTED" } }))).toBeGreaterThanOrEqual(4);
    void guideId; void convertToGuide;
  });
});
