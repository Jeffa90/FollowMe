import { describe, expect, it } from "vitest";
import { extractDocument } from "@/server/import/extract";
import { convertToGuide, classifyHeading } from "@/server/import/convert";
import { makeLegacyDocx, makeLegacyPdf, makePptx, makeScanPng } from "./fixtures";

const NOW = new Date("2026-09-29");
const retired = [{ kind: "TCODE", value: "ME21", replacement: "ME21N", note: "superseded" }];

describe("legacy extraction and conversion", () => {
  it("DOCX: extracts headings, list, tables, images, header control fields and metadata", async () => {
    const { buffer } = await makeLegacyDocx();
    const { doc, imageBuffers } = await extractDocument(buffer, "docx", "legacy.docx");
    expect(doc.blocks.filter((b) => b.type === "heading").map((b) => b.text)).toEqual(["Create a purchase order in SAP", "Purpose", "Scope", "Responsibilities", "Procedure", "Revision History"]);
    expect(doc.blocks.filter((b) => b.type === "list_item")).toHaveLength(5);
    expect(doc.blocks.filter((b) => b.type === "table")).toHaveLength(2);
    expect(doc.images).toHaveLength(1);
    expect(imageBuffers.size).toBe(1);
    expect(doc.docControl.documentId).toBe("WI-OLD-042");
    expect(doc.docControl.version).toBe("3");
    expect(doc.docControl.owner).toMatch(/Jane Smith/);
    expect(doc.metadata.author).toBe("J. Smith");
  });

  it("DOCX conversion: verbatim steps, warning kind, uncertainty flags, obsolete-looking content, screenshots flagged, nothing invented", async () => {
    const { buffer } = await makeLegacyDocx();
    const { doc } = await extractDocument(buffer, "docx", "legacy.docx");
    const r = convertToGuide(doc, { now: NOW, retired });
    const c = r.content;
    expect(c.title).toBe("Create a purchase order in SAP");
    expect(c.purpose).toBe("This instruction describes how buyers create a standard purchase order in SAP.");
    expect(c.scope).toBe("Applies to buyers at the Manchester site.");
    expect(c.responsibilities).toEqual([{ role: "Buyer", responsibility: "Creates the purchase order" }, { role: "Budget holder", responsibility: "Approves orders above 10,000" }]);
    const actions = c.steps.filter((s) => s.kind === "action");
    expect(actions).toHaveLength(5);
    expect(actions[0].title).toBe("Open transaction ME21 from the SAP Easy Access menu");
    expect(c.steps.some((s) => s.kind === "warning" && s.text.startsWith("Do not create a purchase order after goods"))).toBe(true);
    // never invents missing facts
    expect(c.expectedResult).toBe("");
    expect(r.flags.some((f) => f.code === "missing-section" && /expected result/.test(f.message))).toBe(true);
    // uncertainty
    const codes = r.flags.map((f) => f.code);
    expect(codes).toEqual(expect.arrayContaining(["obsolete-looking-age", "obsolete-reference", "broken-cross-reference"]));
    expect(actions[2].origin.flags.some((f) => f.code === "vague-language")).toBe(true);
    expect(actions[3].origin.flags.map((f) => f.code)).toEqual(expect.arrayContaining(["possible-decision", "broken-cross-reference"]));
    expect(r.metadata).toMatchObject({ legacyDocumentId: "WI-OLD-042", legacyVersion: "3", owner: expect.stringContaining("Jane Smith") });
    expect(r.metadata.sapTransactions).toContain("ME21");
    // screenshot associated with step 2 (it follows it) and flagged for replacement (2019 document, retired tcode)
    const withImg = actions.find((s) => s.image)!;
    expect(withImg.title).toContain("Enter the vendor number");
    expect(withImg.image!.needsReplacement).toBe(true);
    expect(withImg.image!.assetId).toMatch(/^pending:/);
    // change summary
    const kinds = r.changeSummary.counts;
    expect(kinds.retained).toBeGreaterThan(3);
    expect(kinds.removed).toBeGreaterThan(3); // headings, revision history, footer
    expect(r.changeSummary.blocks.find((b) => b.reason.includes("Revision history"))).toBeTruthy();
    expect(r.changeSummary.blocks.length).toBe(doc.blocks.length); // every source block is accounted for
  });

  it("flags a missing purpose instead of inventing one", async () => {
    const { buffer } = await makeLegacyDocx({ withPurpose: false });
    const { doc } = await extractDocument(buffer, "docx", "legacy.docx");
    const r = convertToGuide(doc, { now: NOW });
    expect(r.content.purpose).toBe("");
    expect(r.content.sectionConfidence!.purpose.confidence).toBe(0);
    expect(r.flags.some((f) => f.code === "missing-section" && /purpose/.test(f.message))).toBe(true);
  });

  it("treats instructions embedded in a document as ordinary (untrusted) text", async () => {
    const { buffer } = await makeLegacyDocx({ injection: true });
    const { doc } = await extractDocument(buffer, "docx", "evil.docx");
    const r = convertToGuide(doc, { now: NOW });
    // The injected sentence is just content: it does not change status, approval or anything else; it is visible to the reviewer.
    const injected = [...r.content.steps].find((s) => /IGNORE ALL PREVIOUS/i.test(`${s.title} ${s.text}`));
    expect(injected).toBeTruthy();
    expect(r.content.steps.every((s) => s.origin.type === "import")).toBe(true);
    expect(JSON.stringify(r.content)).not.toMatch(/"status"|APPROVED|PUBLISHED/);
  });

  it("PDF: reconstructs headings, numbered steps, embedded images and metadata", async () => {
    const pdf = await makeLegacyPdf();
    const { doc, pageImages } = await extractDocument(pdf, "pdf", "expenses.pdf");
    expect(doc.metadata.title).toBe("Submit an expense claim");
    expect(doc.blocks.filter((b) => b.type === "heading").map((b) => b.text)).toEqual(expect.arrayContaining(["Purpose", "Scope", "Procedure"]));
    expect(doc.blocks.filter((b) => b.type === "list_item")).toHaveLength(4);
    expect(doc.images.length).toBeGreaterThanOrEqual(1);
    expect(pageImages?.length).toBeGreaterThanOrEqual(1);
    expect(doc.docControl.documentId).toBe("WI-FIN-007");
    const r = convertToGuide(doc, { now: NOW });
    expect(r.content.steps.filter((s) => s.kind === "action").map((s) => s.title)).toEqual([
      "Log in to the expenses portal using your company account", "Click New claim and enter a short description", "Add each expense and attach the receipt", "Click Submit claim",
    ]);
    expect(r.content.expectedResult).toBe("The claim shows as Submitted.");
    expect(r.content.steps.find((s) => s.image)).toBeTruthy();
  });

  it("PPTX, HTML and Markdown are supported; external images are never fetched", async () => {
    const p = convertToGuide((await extractDocument(await makePptx(), "pptx", "reset.pptx")).doc, { now: NOW });
    expect(p.content.purpose).toBe("Explain how to reset a password");
    expect(p.content.steps.map((s) => s.title)).toEqual(["Open the IT portal", "Select the user", "Click Reset password"]);

    const html = `<html><head><title>Book a room</title><script>alert(1)</script></head><body><h1>Book a room</h1><h2>Purpose</h2><p>Reserve a meeting room.</p><h2>Procedure</h2><ol><li>Open Outlook.</li><li>Click <b>New meeting</b>.</li></ol><img src="http://evil.example/x.png"><form><input></form></body></html>`;
    const h = await extractDocument(Buffer.from(html), "html", "room.html");
    expect(h.doc.warnings.join(" ")).toMatch(/External image not fetched/);
    expect(JSON.stringify(h.doc.blocks)).not.toContain("alert(1)");
    expect(convertToGuide(h.doc, { now: NOW }).content.steps.map((s) => s.title)).toEqual(["Open Outlook", "Click New meeting"]);

    const md = "# Water the plants\n\n## Purpose\nKeep plants alive.\n\n## Procedure\n1. Fill the can.\n2. Water the soil.\n";
    const m = convertToGuide((await extractDocument(Buffer.from(md), "markdown", "plants.md")).doc, { now: NOW });
    expect(m.content.title).toBe("Water the plants");
    expect(m.content.steps).toHaveLength(2);
  });

  it("images and scans go through the OCR abstraction and are marked as lower confidence", async () => {
    const png = await makeScanPng(["Procedure", "1. Switch on the machine", "2. Press the green button"]);
    const { doc } = await extractDocument(png, "png", "scan.png");
    expect(doc.ocrUsed).toBe(true);
    expect(doc.warnings.join(" ")).toMatch(/OCR/);
    const r = convertToGuide(doc, { now: NOW });
    const titles = r.content.steps.filter((s) => s.kind === "action").map((s) => s.title.toLowerCase());
    expect(titles.join(" ")).toMatch(/switch on the machine/);
    expect(r.content.steps.filter((s) => s.kind === "action").every((s) => (s.origin.confidence ?? 1) < 0.8 && s.origin.flags.some((f) => f.code === "ocr"))).toBe(true);
  });

  it("classifies headings with synonyms and numbering", () => {
    expect(classifyHeading("1. Objective")).toBe("purpose");
    expect(classifyHeading("Applies to")).toBe("scope");
    expect(classifyHeading("Roles and Responsibilities")).toBe("responsibilities");
    expect(classifyHeading("Random topic")).toBeNull();
  });
});
