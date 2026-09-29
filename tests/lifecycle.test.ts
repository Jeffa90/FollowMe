import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { freshOrg, type Seed } from "./helpers";
import { createGuide, saveContent, submitForReview, reviewDecision, approvalDecision, publishVersion, startRevision, getVersionDetail, markUnderReview, completeReviewNoChange, listVersions } from "@/server/services/guides";
import { searchLibrary } from "@/server/services/search";
import { verifyAuditChain } from "@/server/audit";
import { newStep } from "@/lib/guide-schema";
import type { Ctx } from "@/server/ctx";

let s: Awaited<ReturnType<typeof freshOrg>>;
const owners = () => ({ ownerId: s.users.olivia.id, backupOwnerId: s.users.bob.id, escalationUserId: s.users.alan.id, reviewFrequencyDays: 90 });

async function draft(author: Ctx, title = "Reset a printer queue", extra: Record<string, unknown> = {}) {
  const { guide, version } = await createGuide(author, { title, metadata: { ...owners(), ...extra } });
  const content = (await getVersionDetail(author, version.id)).content;
  await saveContent(author, version.id, {
    ...content, purpose: "Clear a stuck printer queue.", scope: "Office printers.", expectedResult: "Jobs print again.",
    steps: [newStep("action", { title: "Open the print server console", text: "Open **Print Management** on the server." }), newStep("action", { title: "Clear the queue", text: "Right-click the queue and choose **Cancel all documents**." })],
  }, 1);
  return { guide, version };
}
async function publish(versionId: string) {
  await submitForReview(await s.ctx("alice"), versionId);
  await reviewDecision(await s.ctx("rita"), versionId, { decision: "APPROVE" });
  await approvalDecision(await s.ctx("alan"), versionId, { decision: "APPROVE" });
  await publishVersion(await s.ctx("pat"), versionId);
}

beforeAll(async () => { s = await freshOrg(); });

describe("guide lifecycle", () => {
  it("runs Draft -> In Review -> Ready -> Approved -> Published with audit and search visibility", async () => {
    const alice = await s.ctx("alice");
    const { guide, version } = await draft(alice);
    // Draft is invisible to learners and to normal search
    const lena = await s.ctx("lena");
    expect((await searchLibrary(lena, "printer queue")).hits).toHaveLength(0);
    await expect(getVersionDetail(lena, version.id)).rejects.toMatchObject({ status: 404 });

    await submitForReview(alice, version.id);
    expect((await prisma.guideVersion.findUniqueOrThrow({ where: { id: version.id } })).status).toBe("IN_REVIEW");
    // still not searchable
    expect((await searchLibrary(lena, "printer queue")).hits).toHaveLength(0);

    await reviewDecision(await s.ctx("rita"), version.id, { decision: "APPROVE", comment: "ok" });
    expect((await prisma.guideVersion.findUniqueOrThrow({ where: { id: version.id } })).status).toBe("READY_FOR_APPROVAL");
    await approvalDecision(await s.ctx("alan"), version.id, { decision: "APPROVE", comment: "approved" });
    expect((await prisma.guideVersion.findUniqueOrThrow({ where: { id: version.id } })).status).toBe("APPROVED");
    expect((await searchLibrary(lena, "printer queue")).hits).toHaveLength(0); // approved != published
    await publishVersion(await s.ctx("pat"), version.id);

    const hits = (await searchLibrary(lena, "printer queue")).hits;
    expect(hits).toHaveLength(1);
    expect(hits[0].documentId).toBe(guide.documentId);
    const v = await prisma.guideVersion.findUniqueOrThrow({ where: { id: version.id } });
    expect(v.status).toBe("PUBLISHED");
    expect(v.reviewDate!.getTime()).toBeGreaterThan(Date.now() + 80 * 86400_000);
    expect((v.controlSnapshot as { approvals: unknown[] }).approvals).toHaveLength(2);

    const actions = (await prisma.auditEvent.findMany({ where: { guideId: guide.id }, orderBy: { seq: "asc" } })).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["GUIDE_CREATED", "SUBMITTED_FOR_REVIEW", "REVIEW_APPROVE", "APPROVAL_APPROVE", "PUBLISHED"]));
    expect(await verifyAuditChain(s.org.id)).toMatchObject({ ok: true });
  });

  it("blocks submission until governance metadata exists", async () => {
    const alice = await s.ctx("alice");
    const { guide, version } = await createGuide(alice, { title: "No owners", metadata: { backupOwnerId: null } });
    const c = (await getVersionDetail(alice, version.id)).content;
    await saveContent(alice, version.id, { ...c, purpose: "p", scope: "s", expectedResult: "r", steps: [newStep("action", { title: "Do it", text: "Do the thing." })] }, 1);
    await expect(submitForReview(alice, version.id)).rejects.toMatchObject({ status: 422 });
    void guide;
  });

  it("enforces role-based permissions and segregation of duties", async () => {
    const { version } = await draft(await s.ctx("alice"), "Segregation guide");
    const alice = await s.ctx("alice");
    await submitForReview(alice, version.id);
    // learner / author / approver cannot review
    await expect(reviewDecision(await s.ctx("lena"), version.id, { decision: "APPROVE" })).rejects.toMatchObject({ status: 404 }); // learners cannot even see in-review drafts
    await expect(reviewDecision(alice, version.id, { decision: "APPROVE" })).rejects.toMatchObject({ status: 403 });
    await expect(reviewDecision(await s.ctx("alan"), version.id, { decision: "APPROVE" })).rejects.toMatchObject({ status: 403 });
    // request changes needs a comment
    await expect(reviewDecision(await s.ctx("rita"), version.id, { decision: "REQUEST_CHANGES", comment: "" })).rejects.toMatchObject({ status: 422 });
    await reviewDecision(await s.ctx("rita"), version.id, { decision: "APPROVE" });
    // an approver who is also the author cannot approve; make alice an approver to test
    await prisma.user.update({ where: { id: s.users.alice.id }, data: { roles: ["AUTHOR", "APPROVER", "PUBLISHER"] } });
    const aliceAll = await s.ctx("alice");
    await expect(approvalDecision(aliceAll, version.id, { decision: "APPROVE" })).rejects.toMatchObject({ status: 403 });
    await approvalDecision(await s.ctx("alan"), version.id, { decision: "APPROVE" });
    await expect(publishVersion(aliceAll, version.id)).rejects.toMatchObject({ status: 403 }); // author cannot publish own
    await expect(publishVersion(await s.ctx("alan"), version.id)).rejects.toMatchObject({ status: 403 }); // not a publisher
    await prisma.user.update({ where: { id: s.users.alice.id }, data: { roles: ["AUTHOR"] } });
    await publishVersion(await s.ctx("pat"), version.id);
  });

  it("supports changes requested and re-submission as a new cycle", async () => {
    const alice = await s.ctx("alice");
    const { version } = await draft(alice, "Cycle guide");
    await submitForReview(alice, version.id);
    await reviewDecision(await s.ctx("rita"), version.id, { decision: "REQUEST_CHANGES", comment: "Add a warning." });
    expect((await prisma.guideVersion.findUniqueOrThrow({ where: { id: version.id } })).status).toBe("CHANGES_REQUESTED");
    // editable again
    const d = await getVersionDetail(alice, version.id);
    await saveContent(alice, version.id, { ...d.content, steps: [...d.content.steps, newStep("warning", { text: "Wear gloves." })] }, d.rev);
    await submitForReview(alice, version.id);
    await reviewDecision(await s.ctx("rita"), version.id, { decision: "APPROVE" }); // new cycle: allowed again
    expect((await prisma.guideVersion.findUniqueOrThrow({ where: { id: version.id } })).submissionCycle).toBe(2);
  });

  it("supports multi-stage approval routes", async () => {
    const multi = await prisma.workflow.findFirstOrThrow({ where: { orgId: s.org.id, key: "multi" } });
    const alice = await s.ctx("alice");
    const { version } = await draft(alice, "Multi-stage guide", { workflowId: multi.id });
    await submitForReview(alice, version.id);
    await reviewDecision(await s.ctx("rita"), version.id, { decision: "APPROVE" });
    await approvalDecision(await s.ctx("alan"), version.id, { decision: "APPROVE" });
    expect((await prisma.guideVersion.findUniqueOrThrow({ where: { id: version.id } })).status).toBe("READY_FOR_APPROVAL");
    // stage 2 requires the process owner/backup
    await expect(approvalDecision(await s.ctx("amy"), version.id, { decision: "APPROVE" })).rejects.toMatchObject({ status: 403 });
    await approvalDecision(await s.ctx("olivia"), version.id, { decision: "APPROVE" });
    expect((await prisma.guideVersion.findUniqueOrThrow({ where: { id: version.id } })).status).toBe("APPROVED");
  });

  it("Journey C: revising a published guide never overwrites the historical version", async () => {
    const alice = await s.ctx("alice");
    const { guide, version } = await draft(alice, "Revision guide");
    await publish(version.id);
    const before = await prisma.guideVersion.findUniqueOrThrow({ where: { id: version.id } });

    // published content cannot be edited via the service
    await expect(saveContent(alice, version.id, { ...before.content as object, title: "hack" }, before.rev)).rejects.toMatchObject({ status: 409 });
    // ...nor by SQL (database trigger)
    await expect(prisma.$executeRaw`UPDATE "GuideVersion" SET content = '{}'::jsonb WHERE id = ${version.id}`).rejects.toThrow(/immutable/);
    await expect(prisma.$executeRaw`DELETE FROM "GuideVersion" WHERE id = ${version.id}`).rejects.toThrow(/cannot be deleted/);

    // revision requires a change summary and starts as v2 draft while v1 stays live
    await expect(startRevision(alice, guide.id, { summary: "" })).rejects.toMatchObject({ status: 422 });
    const v2 = await startRevision(alice, guide.id, { summary: "Add a step to restart the spooler" });
    expect(v2.number).toBe(2);
    expect((await prisma.guide.findUniqueOrThrow({ where: { id: guide.id } })).liveVersionId).toBe(version.id);
    await expect(startRevision(alice, guide.id, { summary: "another" })).rejects.toMatchObject({ status: 409 });

    const d2 = await getVersionDetail(alice, v2.id);
    await saveContent(alice, v2.id, { ...d2.content, steps: [...d2.content.steps, newStep("action", { title: "Restart the spooler", text: "Restart the **Print Spooler** service." })] }, d2.rev);
    // learners still see v1 only (search hits the live version)
    const lena = await s.ctx("lena");
    expect((await searchLibrary(lena, "spooler")).hits).toHaveLength(0);
    await publish(v2.id);
    expect((await searchLibrary(lena, "spooler")).hits).toHaveLength(1);

    const after = await prisma.guideVersion.findUniqueOrThrow({ where: { id: version.id } });
    expect(after.status).toBe("SUPERSEDED");
    expect(after.contentHash).toBe(before.contentHash);
    expect(after.content).toEqual(before.content);
    expect(after.supersededByNumber).toBe(2);
    expect((await prisma.guide.findUniqueOrThrow({ where: { id: guide.id } })).liveVersionId).toBe(v2.id);

    // historical access: auditor yes, learner no
    expect((await listVersions(await s.ctx("aud"), guide.id)).map((v) => v.number)).toEqual([2, 1]);
    expect((await listVersions(lena, guide.id)).map((v) => v.number)).toEqual([2]);
    await expect(getVersionDetail(lena, version.id)).rejects.toMatchObject({ status: 404 });
    expect((await getVersionDetail(await s.ctx("aud"), version.id)).status).toBe("SUPERSEDED");
  });

  it("urgent correction is fast-tracked but controlled and audited", async () => {
    const alice = await s.ctx("alice");
    const { guide, version } = await draft(alice, "Urgent guide");
    await publish(version.id);
    await expect(startRevision(alice, guide.id, { summary: "x", urgent: { reason: "Wrong voltage stated in step 2" } })).rejects.toMatchObject({ status: 403 });
    const pat = await s.ctx("pat");
    await expect(startRevision(pat, guide.id, { summary: "Correct voltage", urgent: { reason: "Wrong voltage stated in step 2", authorId: s.users.pat.id } })).rejects.toMatchObject({ status: 422 });
    const u = await startRevision(pat, guide.id, { summary: "Correct voltage", urgent: { reason: "Wrong voltage stated in step 2", authorId: s.users.arun.id } });
    await prisma.user.update({ where: { id: s.users.pat.id }, data: { roles: ["PUBLISHER"] } });
    const d = await getVersionDetail(pat, u.id);
    // publishers may not edit content (author role required): an author edits on their behalf
    await expect(saveContent(pat, u.id, d.content, d.rev)).rejects.toMatchObject({ status: 403 });
    await saveContent(await s.ctx("arun"), u.id, { ...d.content, purpose: "Clear a stuck printer queue (corrected)." }, d.rev);
    await submitForReview(await s.ctx("arun"), u.id);
    expect((await prisma.guideVersion.findUniqueOrThrow({ where: { id: u.id } })).status).toBe("READY_FOR_APPROVAL"); // review phase skipped
    await approvalDecision(await s.ctx("alan"), u.id, { decision: "APPROVE" });
    await publishVersion(pat, u.id);
    const rec = await prisma.reviewRecommendation.findFirst({ where: { guideId: guide.id, source: "URGENT_FOLLOWUP" } });
    expect(rec).toBeTruthy();
    const acts = (await prisma.auditEvent.findMany({ where: { guideId: guide.id } })).map((e) => e.action);
    expect(acts).toContain("URGENT_CORRECTION_STARTED");
  });

  it("owner can mark under review and complete a review without changing content", async () => {
    const { guide, version } = await draft(await s.ctx("alice"), "Under review guide");
    await publish(version.id);
    const olivia = await s.ctx("olivia");
    await markUnderReview(olivia, guide.id, "Annual review");
    expect((await prisma.guideVersion.findUniqueOrThrow({ where: { id: version.id } })).status).toBe("UNDER_REVIEW");
    // still live and searchable
    expect((await searchLibrary(await s.ctx("lena"), "printer queue")).hits.some((h) => h.guideId === guide.id)).toBe(true);
    const before = await prisma.guideVersion.findUniqueOrThrow({ where: { id: version.id } });
    await completeReviewNoChange(olivia, guide.id, "Checked; no change needed");
    const after = await prisma.guideVersion.findUniqueOrThrow({ where: { id: version.id } });
    expect(after.status).toBe("PUBLISHED");
    expect(after.contentHash).toBe(before.contentHash);
  });

  it("audit events are append-only at database level", async () => {
    const e = await prisma.auditEvent.findFirstOrThrow({ where: { orgId: s.org.id } });
    await expect(prisma.auditEvent.update({ where: { id: e.id }, data: { summary: "tampered" } })).rejects.toThrow(/append-only/);
    await expect(prisma.auditEvent.delete({ where: { id: e.id } })).rejects.toThrow(/append-only/);
  });
});
