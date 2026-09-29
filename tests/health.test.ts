// Journey F + content health, recommendations, orphaned guides, duplicates, exceptions, reusable blocks
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { freshOrg } from "./helpers";
import { createGuide, saveContent, getVersionDetail, submitForReview, reviewDecision, approvalDecision, publishVersion } from "@/server/services/guides";
import { runOrgHealthScan, runHealth, resolveRecommendation, acceptException } from "@/server/services/health";
import { submitFeedback } from "@/server/services/library";
import { updateUser } from "@/server/services/admin";
import { createBlock, blockImpact, reviseBlock } from "@/server/services/blocks";
import { newStep } from "@/lib/guide-schema";
import { searchLibrary } from "@/server/services/search";

let s: Awaited<ReturnType<typeof freshOrg>>;
const gid: Record<string, string> = {}, vid: Record<string, string> = {};

async function publish(key: string, title: string, steps = [newStep("action", { title: "Do the first thing", text: "Do the first thing carefully." }), newStep("action", { title: "Do the second thing", text: "Then do the second thing." })], extra: Record<string, unknown> = {}, meta: Record<string, unknown> = {}) {
  const alice = await s.ctx("alice");
  const { guide, version } = await createGuide(alice, { title, metadata: { ownerId: s.users.olivia.id, backupOwnerId: s.users.bob.id, escalationUserId: s.users.alan.id, reviewFrequencyDays: 30, ...meta } });
  const d = await getVersionDetail(alice, version.id);
  await saveContent(alice, version.id, { ...d.content, purpose: `Explains ${title}.`, scope: "All staff.", expectedResult: "Done.", steps, ...extra }, d.rev);
  await submitForReview(alice, version.id);
  await reviewDecision(await s.ctx("rita"), version.id, { decision: "APPROVE" });
  await approvalDecision(await s.ctx("alan"), version.id, { decision: "APPROVE" });
  await publishVersion(await s.ctx("pat"), version.id);
  gid[key] = guide.id; vid[key] = version.id;
  return { guide, version };
}

beforeAll(async () => {
  s = await freshOrg();
  await publish("stale", "Raise a purchase requisition", [newStep("action", { title: "Run ME21", text: "Run transaction **ME21** and complete the header." }), newStep("action", { title: "Save", text: "Click **Save**." })], { prerequisites: ["SAP access"] }, { sapTransactions: ["ME21"] });
});

describe("Journey F: overdue / outdated guides create review recommendations without changing approved content", () => {
  it("detects overdue review, retired references and outdated-content reports, and files recommendations only", async () => {
    // make it overdue (review date is governed metadata; content is untouched)
    await prisma.guideVersion.update({ where: { id: vid.stale }, data: { reviewDate: new Date(Date.now() - 20 * 86400_000) } });
    await submitFeedback(await s.ctx("lena"), gid.stale, { kind: "OUTDATED", comment: "The screen now says ME21N" });
    await submitFeedback(await s.ctx("lena"), gid.stale, { kind: "OUTDATED", comment: "Button moved" });
    const before = await prisma.guideVersion.findUniqueOrThrow({ where: { id: vid.stale } });
    const guideBefore = await prisma.guide.findUniqueOrThrow({ where: { id: gid.stale } });
    const versionsBefore = await prisma.guideVersion.count({ where: { guideId: gid.stale } });

    const summary = await runOrgHealthScan(s.org.id);
    expect(summary.recommendationsCreated).toBeGreaterThanOrEqual(3);
    const recs = await prisma.reviewRecommendation.findMany({ where: { guideId: gid.stale, status: "OPEN" } });
    expect(recs.map((r) => r.source).sort()).toEqual(expect.arrayContaining(["OVERDUE_REVIEW", "OUTDATED_REPORTS", "RETIRED_REFERENCE"]));
    expect(JSON.stringify(recs.map((r) => r.reasons))).toMatch(/ME21N/); // explains and proposes the replacement
    const findings = await runHealth(s.org.id, vid.stale);
    expect(findings.find((f) => f.ruleId === "review.overdue")!.message).toMatch(/due 20 day/);
    expect(findings.every((f) => f.explanation.length > 10)).toBe(true); // explainable

    // approved content, status and pointers are untouched
    const after = await prisma.guideVersion.findUniqueOrThrow({ where: { id: vid.stale } });
    expect(after.content).toEqual(before.content);
    expect(after.contentHash).toBe(before.contentHash);
    expect(after.status).toBe("PUBLISHED");
    expect((await prisma.guide.findUniqueOrThrow({ where: { id: gid.stale } })).liveVersionId).toBe(guideBefore.liveVersionId);
    expect(await prisma.guideVersion.count({ where: { guideId: gid.stale } })).toBe(versionsBefore);
    // owner was notified
    expect(await prisma.notification.count({ where: { userId: s.users.olivia.id, kind: "review_recommendation" } })).toBeGreaterThan(0);
    // idempotent: a second scan does not duplicate open recommendations
    const again = await runOrgHealthScan(s.org.id);
    expect(again.recommendationsCreated).toBe(0);
    expect(await prisma.reviewRecommendation.count({ where: { guideId: gid.stale, status: "OPEN" } })).toBe(recs.length);
    // still findable by learners while under recommendation
    expect((await searchLibrary(await s.ctx("lena"), "purchase requisition")).hits).toHaveLength(1);
  });

  it("only the owner (or publisher/admin) acts on a recommendation; accepting starts a review, still without editing content", async () => {
    const rec = await prisma.reviewRecommendation.findFirstOrThrow({ where: { guideId: gid.stale, source: "OVERDUE_REVIEW", status: "OPEN" } });
    await expect(resolveRecommendation(await s.ctx("lena"), rec.id, "ACCEPTED", "")).rejects.toMatchObject({ status: 403 });
    await expect(resolveRecommendation(await s.ctx("alice"), rec.id, "ACCEPTED", "")).rejects.toMatchObject({ status: 403 });
    await expect(resolveRecommendation(await s.ctx("olivia"), rec.id, "DISMISSED", "")).rejects.toMatchObject({ status: 403 }); // dismissal needs a reason
    const hash = (await prisma.guideVersion.findUniqueOrThrow({ where: { id: vid.stale } })).contentHash;
    const r = await resolveRecommendation(await s.ctx("olivia"), rec.id, "ACCEPTED", "Reviewing now");
    expect(r.markedUnderReview).toBe(true);
    const v = await prisma.guideVersion.findUniqueOrThrow({ where: { id: vid.stale } });
    expect(v.status).toBe("UNDER_REVIEW");
    expect(v.contentHash).toBe(hash);
    const other = await prisma.reviewRecommendation.findFirstOrThrow({ where: { guideId: gid.stale, source: "OUTDATED_REPORTS", status: "OPEN" } });
    await resolveRecommendation(await s.ctx("olivia"), other.id, "DISMISSED", "Already fixed in the revision");
    expect((await prisma.auditEvent.count({ where: { guideId: gid.stale, action: { startsWith: "RECOMMENDATION_" } } }))).toBe(2);
  });
});

describe("orphaned guides, duplicates, exceptions", () => {
  it("detects and reports guides whose owner becomes inactive", async () => {
    const tina = await prisma.user.create({ data: { orgId: s.org.id, email: "tina@contoso.example", name: "Tina Leaver", roles: ["PROCESS_OWNER"] } });
    const { guide } = await publish("orph", "Reset a shared mailbox password", undefined, {}, { ownerId: tina.id, backupOwnerId: s.users.olivia.id });
    await updateUser(await s.ctx("ada"), tina.id, { active: false }); // also runs a scan
    const g = await prisma.guide.findUniqueOrThrow({ where: { id: guide.id } });
    expect(g.orphanedSince).toBeTruthy();
    expect((await prisma.reviewRecommendation.findFirst({ where: { guideId: guide.id, source: "ORPHANED", status: "OPEN" } }))).toBeTruthy();
    expect(await prisma.notification.count({ where: { userId: s.users.olivia.id, kind: "orphaned_guide" } })).toBeGreaterThan(0); // backup owner told
    // deactivated user's sessions/tokens are revoked immediately
    await expect(updateUser(await s.ctx("ada"), s.users.ada.id, { active: false })).rejects.toMatchObject({ status: 409 }); // cannot deactivate yourself
    // reassigning ownership clears the orphan state on the next scan
    await prisma.guide.update({ where: { id: guide.id }, data: { ownerId: s.users.olivia.id, backupOwnerId: s.users.alan.id } });
    await runOrgHealthScan(s.org.id);
    expect((await prisma.guide.findUniqueOrThrow({ where: { id: guide.id } })).orphanedSince).toBeNull();
  });

  it("finds near-duplicate guides", async () => {
    const steps = () => [newStep("action", { title: "Open the visitor system", text: "Open the visitor management system." }), newStep("action", { title: "Register the visitor", text: "Enter the visitor name and host and click Register." }), newStep("action", { title: "Print the badge", text: "Print the visitor badge and hand it over." })];
    await publish("dupA", "Register a visitor", steps());
    await publish("dupB", "Register a visitor at reception", steps());
    const r = await runOrgHealthScan(s.org.id);
    expect(r.duplicatePairs).toBeGreaterThanOrEqual(1);
    expect((await prisma.healthFinding.findFirst({ where: { guideId: gid.dupA, ruleId: { startsWith: "duplicate.near" } } }))).toBeTruthy();
    expect((await prisma.reviewRecommendation.findFirst({ where: { source: "DUPLICATE", status: "OPEN" } }))).toBeTruthy();
  });

  it("classifies findings, and only owners/approvers/admins can accept a blocking finding as an exception (audited)", async () => {
    const alice = await s.ctx("alice");
    const { guide, version } = await createGuide(alice, { title: "Exception demo", metadata: { ownerId: s.users.olivia.id, backupOwnerId: s.users.bob.id, escalationUserId: s.users.alan.id } });
    const d = await getVersionDetail(alice, version.id);
    await saveContent(alice, version.id, { ...d.content, purpose: "Demo.", scope: "Demo.", steps: [newStep("action", { title: "Do it", text: "Do it." })] }, d.rev); // expected result missing (required by template)
    let f = await runHealth(s.org.id, version.id);
    const blocking = f.find((x) => x.ruleId === "template.required.expectedResult")!;
    expect(blocking.effectiveSeverity).toBe("BLOCKING_ERROR");
    expect(f.some((x) => x.effectiveSeverity === "SUGGESTION")).toBe(true);
    await expect(submitForReview(alice, version.id)).rejects.toMatchObject({ status: 422 });
    await expect(acceptException(alice, blocking.id, "author accepting own error")).rejects.toMatchObject({ status: 403 });
    await expect(acceptException(await s.ctx("aud"), blocking.id, "auditor cannot")).rejects.toMatchObject({ status: 403 });
    await acceptException(await s.ctx("olivia"), blocking.id, "Result is obvious for this trivial task");
    f = await runHealth(s.org.id, version.id);
    expect(f.find((x) => x.ruleId === "template.required.expectedResult")!.effectiveSeverity).toBe("ACCEPTED_EXCEPTION");
    await submitForReview(alice, version.id); // now allowed
    expect((await prisma.auditEvent.count({ where: { guideId: guide.id, action: "HEALTH_EXCEPTION_ACCEPTED" } }))).toBe(1);
  });
});

describe("reusable blocks: impact first, no silent changes to approved content", () => {
  it("shows affected guides, requires acknowledgement of impact, files recommendations and never rewrites published guides", async () => {
    const olivia = await s.ctx("olivia");
    const blk = await createBlock(olivia, { key: "privacy-note", kind: "PRIVACY", title: "Personal data", body: "Do not copy personal data into chat." });
    const alice = await s.ctx("alice");
    const step = newStep("block", { title: blk.title, blockRef: { blockId: blk.id, version: 1, kind: "PRIVACY", title: blk.title, body: blk.body } });
    const { version: v1 } = await publish("blk", "Handle customer records", [newStep("action", { title: "Open the record", text: "Open the customer record." }), step]);
    // and a draft that uses it
    const { guide: g2, version: v2 } = await createGuide(alice, { title: "Draft using the block", metadata: { ownerId: s.users.olivia.id } });
    const d2 = await getVersionDetail(alice, v2.id);
    await saveContent(alice, v2.id, { ...d2.content, steps: [newStep("block", { title: blk.title, blockRef: { blockId: blk.id, version: 1, kind: "PRIVACY", title: blk.title, body: blk.body } })] }, d2.rev);

    const impact = await blockImpact(olivia, blk.id);
    expect(impact.affected.map((a) => a.status).sort()).toEqual(["DRAFT", "PUBLISHED"]);
    await expect(reviseBlock(olivia, blk.id, { title: blk.title, body: "New wording", acknowledgeImpactCount: 0 })).rejects.toMatchObject({ status: 409 });
    const before = await prisma.guideVersion.findUniqueOrThrow({ where: { id: v1.id } });
    const r = await reviseBlock(olivia, blk.id, { title: blk.title, body: "Never copy personal data into chat, email or files.", acknowledgeImpactCount: 2 });
    expect(r).toEqual({ version: 2, affected: 2 });
    const after = await prisma.guideVersion.findUniqueOrThrow({ where: { id: v1.id } });
    expect(after.contentHash).toBe(before.contentHash); // the published guide still shows the approved wording
    expect(JSON.stringify(after.content)).toContain("Do not copy personal data into chat.");
    const rec = await prisma.reviewRecommendation.findFirstOrThrow({ where: { source: "BLOCK_CHANGE", guideId: gid.blk } });
    expect(JSON.stringify(rec.reasons)).toMatch(/Re-approval is required/);
    expect(await prisma.notification.count({ where: { kind: "block_changed" } })).toBeGreaterThanOrEqual(2);
    expect((await prisma.contentBlockVersion.count({ where: { blockId: blk.id } }))).toBe(2);
    void g2;
    // learners cannot manage blocks
    await expect(createBlock(await s.ctx("lena"), { key: "x-block", kind: "WARNING", title: "x", body: "yy" })).rejects.toMatchObject({ status: 403 });
  });
});
