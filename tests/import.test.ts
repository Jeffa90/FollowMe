import { beforeAll, describe, expect, it } from "vitest";
import JSZip from "jszip";
import sharp from "sharp";
import { prisma } from "@/server/db";
import { freshOrg } from "./helpers";
import "@/server/services/imports";
import { createImports, getImport, confirmImport, getBatch, exceptionReportCsv, materialiseDryRun, rejectImport } from "@/server/services/imports";
import { drainJobs } from "@/server/jobs";
import { getVersionDetail, saveContent, submitForReview, reviewDecision, approvalDecision, publishVersion, updateMetadata } from "@/server/services/guides";
import { storeAsset } from "@/server/services/assets";
import { runHealth } from "@/server/services/health";
import { searchLibrary } from "@/server/services/search";
import { flattenSteps } from "@/lib/guide-schema";
import { makeLegacyDocx, makeLegacyPdf } from "./fixtures";
import { mockScreenshot } from "@/server/fixtures";

let s: Awaited<ReturnType<typeof freshOrg>>;
beforeAll(async () => { s = await freshOrg(); });

describe("Journey B: legacy DOCX -> structured draft -> confirm -> replace obsolete screenshot -> publish", () => {
  it("converts, flags uncertainty, blocks until confirmed and replaced, then publishes the redevelopment", async () => {
    const alice = await s.ctx("alice");
    const { buffer } = await makeLegacyDocx();
    const r = await createImports(alice, [{ name: "WI-OLD-042.docx", buffer }]);
    expect(r.items[0].status).toBe("QUEUED");
    await drainJobs();

    const { item, doc, conversion, version } = await getImport(alice, r.items[0].id);
    expect(item.status).toBe("NEEDS_REVIEW");
    expect(doc!.blocks.length).toBeGreaterThan(10);
    expect(conversion!.changeSummary.counts.retained).toBeGreaterThan(0);
    expect(conversion!.flags.some((f) => f.code === "obsolete-looking-age")).toBe(true);
    expect(version!.content.steps.filter((x) => x.kind === "action")).toHaveLength(5);
    const versionId = item.versionId!, guideId = item.guideId!;

    // the original is kept as immutable evidence
    const src = await prisma.asset.findUniqueOrThrow({ where: { id: item.sourceAssetId } });
    expect(src.purpose).toBe("IMPORT_SOURCE");
    await expect(prisma.asset.update({ where: { id: src.id }, data: { sha256: "tampered" } })).rejects.toThrow(/immutable/);

    // unconfirmed import can never be submitted
    const meta = { ownerId: s.users.olivia.id, backupOwnerId: s.users.bob.id, escalationUserId: s.users.alan.id };
    await updateMetadata(alice, guideId, meta);
    await expect(submitForReview(alice, versionId)).rejects.toMatchObject({ status: 422 });
    let findings = await runHealth(s.org.id, versionId);
    const rules = findings.map((f) => f.ruleId);
    expect(rules).toEqual(expect.arrayContaining(["import.unconfirmed", "image.replace_flagged"]));

    // complete the missing pieces a human must supply (never invented by the converter), replace the obsolete screenshot
    let d = await getVersionDetail(alice, versionId);
    const withImg = flattenSteps(d.content.steps).find((x) => x.image)!;
    const fresh = await mockScreenshot({ app: "SAP S/4HANA", screen: "Create Purchase Order (ME21N)", button: "Save" });
    const newAsset = await storeAsset(alice, { buffer: fresh.buf, filename: "me21n.png", purpose: "CONTENT", allow: ["png"], guideId });
    const oldAssetId = withImg.image!.assetId;
    withImg.image = { assetId: newAsset.id, alt: "SAP S/4HANA create purchase order screen with the Save button", annotations: [], sourceAssetId: oldAssetId };
    d.content.expectedResult = "SAP confirms the purchase order number.";
    d.content.prerequisites = ["SAP access with the buyer role"];
    d.content.permissions = ["Z_BUYER"];
    d.content.validationChecks = ["The PO number is shown in the status bar"];
    d.content.steps = flattenSteps(d.content.steps).length ? d.content.steps.map((x) => (x.image?.assetId === undefined ? x : x)) : d.content.steps;
    // other flagged screenshots (if any) are confirmed accurate
    for (const st of flattenSteps(d.content.steps)) if (st.image?.needsReplacement) st.image = { ...st.image, needsReplacement: false, replaceReason: undefined };
    // retired ME21 -> ME21N is a warning (not blocking); update the step wording is a human decision
    await saveContent(alice, versionId, d.content, d.rev);
    await updateMetadata(alice, guideId, { sapTransactions: ["ME21N"], systems: ["SAP S/4HANA"] });

    await expect(confirmImport(alice, item.id, { acknowledged: false })).rejects.toThrow();
    await confirmImport(alice, item.id, { acknowledged: true, note: "Compared with the original Word file" });
    findings = await runHealth(s.org.id, versionId);
    expect(findings.filter((f) => f.effectiveSeverity === "BLOCKING_ERROR").map((f) => f.ruleId)).toEqual([]);

    await submitForReview(alice, versionId);
    await reviewDecision(await s.ctx("rita"), versionId, { decision: "APPROVE" });
    await approvalDecision(await s.ctx("alan"), versionId, { decision: "APPROVE" });
    await publishVersion(await s.ctx("pat"), versionId);

    const hits = (await searchLibrary(await s.ctx("lena"), "purchase order SAP")).hits;
    expect(hits.some((h) => h.guideId === guideId)).toBe(true);
    // the original document and the obsolete screenshot evidence still exist, untouched
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: src.id } })).sha256).toBe(src.sha256);
    expect(await prisma.asset.count({ where: { id: oldAssetId } })).toBe(1);
    const audit = (await prisma.auditEvent.findMany({ where: { guideId } })).map((e) => e.action);
    expect(audit).toEqual(expect.arrayContaining(["IMPORT_CONVERTED", "IMPORT_CONFIRMED", "PUBLISHED"]));
  });
});

describe("import safety and batches", () => {
  it("rejects malicious or mismatched uploads at the door and records them so batches reconcile", async () => {
    const alice = await s.ctx("alice");
    const eicar = Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
    const macroZip = await JSZip.loadAsync((await makeLegacyDocx()).buffer); macroZip.file("word/vbaProject.bin", "MACRO"); // a real .docx with an injected macro project
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#fff" } }).png().toBuffer();
    const jsPdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/OpenAction<</S/JavaScript/JS(app.alert(1))>>>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF");
    const r = await createImports(alice, [
      { name: "eicar.txt", buffer: eicar },
      { name: "macro.docx", buffer: await macroZip.generateAsync({ type: "nodebuffer" }) },
      { name: "actually-a-png.docx", buffer: png },
      { name: "script.pdf", buffer: jsPdf },
      { name: "empty.md", buffer: Buffer.alloc(0) },
    ]);
    expect(r.items.map((i) => i.status)).toEqual(["REJECTED", "REJECTED", "REJECTED", "REJECTED", "REJECTED"]);
    expect(r.items[0].error).toMatch(/EICAR|Malware/i);
    expect(r.items[1].error).toMatch(/Macro/i);
    expect(r.items[2].error).toMatch(/does not match/i);
    expect(r.items[3].error).toMatch(/JavaScript/i);
    const totals = (await getBatch(alice, r.batchId)).totals;
    expect(totals).toMatchObject({ submitted: 5, rejected: 5, converted: 0, balanced: true });
    // rejected files are never stored
    expect(await prisma.asset.count({ where: { originalName: { in: ["eicar.txt", "macro.docx", "script.pdf"] } } })).toBe(0);
  });

  it("dry run: nothing is created, duplicates are detected, totals reconcile, exception report is generated, dry-run item can be materialised", async () => {
    const alice = await s.ctx("alice");
    const pdf = await makeLegacyPdf();
    const before = await prisma.guide.count({ where: { orgId: s.org.id } });
    const r = await createImports(alice, [
      { name: "expenses-v2.pdf", buffer: pdf },
      { name: "expenses-v2-copy.pdf", buffer: pdf }, // exact duplicate
      { name: "notes.md", buffer: Buffer.from("# Book a room\n\n## Purpose\nReserve a room.\n\n## Procedure\n1. Open Outlook.\n2. Click New meeting.\n") },
    ], { dryRun: true, batchName: "Legacy library A" });
    await drainJobs();
    const b = await getBatch(alice, r.batchId);
    expect(b.totals).toMatchObject({ submitted: 3, converted: 2, duplicates: 1, failed: 0, pending: 0, balanced: true });
    expect(b.items.filter((i) => i.status === "DRY_RUN_OK")).toHaveLength(2);
    expect(await prisma.guide.count({ where: { orgId: s.org.id } })).toBe(before); // dry run creates nothing
    const csv = await exceptionReportCsv(alice, r.batchId);
    expect(csv).toContain("expenses-v2-copy.pdf");
    expect(csv).toContain("RECONCILIATION");
    // source evidence stored even for dry runs and never deleted
    expect(await prisma.asset.count({ where: { purpose: "IMPORT_SOURCE", originalName: { in: ["expenses-v2.pdf", "notes.md"] } } })).toBeGreaterThanOrEqual(2);
    // grouping keys are derived
    const dryItem = b.items.find((i) => i.filename === "expenses-v2.pdf")!;
    const created = await materialiseDryRun(alice, dryItem.id);
    expect(await prisma.guide.count({ where: { orgId: s.org.id } })).toBe(before + 1);
    const detail = await getImport(alice, dryItem.id);
    expect(detail.item.status).toBe("NEEDS_REVIEW");
    expect(detail.version!.content.steps.filter((x) => x.kind === "action")).toHaveLength(4);
    expect(created.versionId).toBe(detail.item.versionId);
    await rejectImport(alice, b.items.find((i) => i.filename === "notes.md")!.id, "Not needed");
    expect(await prisma.asset.count({ where: { originalName: "notes.md", purpose: "IMPORT_SOURCE" } })).toBe(1); // rejecting never deletes the source
  });

  it("only authors can import; learners cannot see other people's imports", async () => {
    await expect(createImports(await s.ctx("lena"), [{ name: "a.md", buffer: Buffer.from("# x") }])).rejects.toMatchObject({ status: 403 });
    const alice = await s.ctx("alice");
    const r = await createImports(alice, [{ name: "z.md", buffer: Buffer.from("# Z\n\n## Procedure\n1. Do it.\n2. Do more.\n") }]);
    await drainJobs();
    await expect(getImport(await s.ctx("lena"), r.items[0].id)).rejects.toMatchObject({ status: 404 });
  });
});
