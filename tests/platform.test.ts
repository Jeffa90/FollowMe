// Analytics (no employee metrics), training semantics, feedback privacy, webhooks, retention, admin
import http from "node:http";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { freshOrg } from "./helpers";
import { createGuide, saveContent, getVersionDetail, submitForReview, reviewDecision, approvalDecision, publishVersion } from "@/server/services/guides";
import { analytics } from "@/server/services/analytics";
import { recordView, submitFeedback, listFeedback } from "@/server/services/library";
import { searchLibrary } from "@/server/services/search";
import { ask } from "@/server/ai/qa";
import { acknowledge, markRead, submitQuiz, signoff, trainingReport, myTraining } from "@/server/services/training";
import { createWebhook, signPayload } from "@/server/services/webhooks";
import { drainJobs } from "@/server/jobs";
import { retentionSweep } from "@/server/services/maintenance";
import { updateUser, updateSettings } from "@/server/services/admin";
import { createSession, ctxFromSessionCookie, issueApiToken, ctxFromBearer } from "@/server/session";
import { newStep } from "@/lib/guide-schema";
import { blobStore } from "@/server/storage";
import { storeAsset } from "@/server/services/assets";
import { mockScreenshot } from "@/server/fixtures";
import { verifyAuditChain } from "@/server/audit";

let s: Awaited<ReturnType<typeof freshOrg>>;
let safetyVersion: string, safetyGuide: string, plainGuide: string;
const received: { headers: http.IncomingHttpHeaders; body: string }[] = [];
let server: http.Server; let port = 0;

async function publish(title: string, content: Record<string, unknown> = {}, steps = [newStep("action", { title: "Do it", text: "Do it." })]) {
  const alice = await s.ctx("alice");
  const { guide, version } = await createGuide(alice, { title, templateKey: "general", metadata: { ownerId: s.users.olivia.id, backupOwnerId: s.users.bob.id, escalationUserId: s.users.alan.id } });
  const d = await getVersionDetail(alice, version.id);
  await saveContent(alice, version.id, { ...d.content, purpose: "p", scope: "s", expectedResult: "r", steps, ...content }, d.rev);
  await submitForReview(alice, version.id);
  await reviewDecision(await s.ctx("rita"), version.id, { decision: "APPROVE" });
  await approvalDecision(await s.ctx("alan"), version.id, { decision: "APPROVE" });
  await publishVersion(await s.ctx("pat"), version.id);
  return { guide, version };
}

beforeAll(async () => {
  s = await freshOrg();
  await new Promise<void>((res) => { server = http.createServer((req, resp) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { received.push({ headers: req.headers, body: b }); resp.end("ok"); }); }).listen(0, "127.0.0.1", () => { port = (server.address() as { port: number }).port; res(); }); });
  const safety = await publish("Lock out a machine", { competency: { acknowledgementRequired: true, quizRequired: true, checklistRequired: true, reassessmentMonths: 12, quiz: [{ question: "Who removes your lock?", options: ["Anyone", "Only you"], correctIndex: 1 }, { question: "Rely on the stop button?", options: ["Yes", "No"], correctIndex: 1 }], checklist: ["Isolates all energy sources", "Verifies zero energy"] } });
  safetyGuide = safety.guide.id; safetyVersion = safety.version.id;
  plainGuide = (await publish("Book a meeting room")).guide.id;
});

describe("analytics improve processes and never score people", () => {
  it("reports guide/search/feedback/review/publication/legacy/unanswered metrics with no person-level data", async () => {
    const lena = await s.ctx("lena");
    for (let i = 0; i < 3; i++) await recordView(lena, safetyGuide, safetyVersion);
    await searchLibrary(lena, "lock out machine"); await searchLibrary(lena, "quantum flux capacitor"); await searchLibrary(lena, "quantum flux capacitor");
    await submitFeedback(lena, plainGuide, { kind: "RATING", rating: 2 }); await submitFeedback(lena, plainGuide, { kind: "RATING", rating: 3 });
    await ask(lena, "How do I get a parking permit for the moon base?");
    const a = await analytics(await s.ctx("olivia").then(async (c) => ({ ...c, roles: ["ADMIN" as const] })));
    expect(a.usage.views).toBe(3);
    expect(a.usage.topGuides[0].title).toBe("Lock out a machine");
    expect(a.search.total).toBe(3);
    expect(a.search.failed[0]).toEqual({ query: "quantum flux capacitor", count: 2 });
    expect(a.search.successRate).toBeCloseTo(1 / 3, 2);
    expect(a.feedback.averageRating).toBe(2.5);
    expect(a.feedback.lowestRated[0].title).toBe("Book a meeting room");
    expect(a.publication.published).toBe(2);
    expect(a.publication.medianDaysCreateToPublish).not.toBeNull();
    expect(a.unansweredQuestions[0].question).toMatch(/parking permit/);
    expect(a.reviews.live).toBe(2);
    expect(a.training.length).toBe(1);
    // no individual data anywhere: no user ids, names, emails, and no per-person keys
    const json = JSON.stringify(a);
    for (const u of Object.values(s.users)) { expect(json).not.toContain(u.id); expect(json).not.toContain(u.name); expect(json).not.toContain(u.email); }
    expect(json).not.toMatch(/"(userId|user|person|employee|ranking|rank|leaderboard|productivity|score|performance)"/i);
    expect(a.notice).toMatch(/does not rank, score or assess people/);
    // view/search logs themselves hold no user attribution
    expect(Object.keys((await prisma.searchLog.findFirstOrThrow()) )).not.toContain("userId");
    expect(Object.keys((await prisma.viewEvent.findFirstOrThrow()))).not.toContain("userId");
    await expect(analytics(await s.ctx("lena"))).rejects.toMatchObject({ status: 403 });
  });
});

describe("training and competency: opening a guide is not proof of competency", () => {
  it("only explicit acknowledgement, a passed quiz and a sign-off create records; reports are aggregate only", async () => {
    const lena = await s.ctx("lena");
    await recordView(lena, safetyGuide, safetyVersion); // opening
    expect(await prisma.acknowledgement.count()).toBe(0);
    await markRead(lena, safetyVersion);
    expect(await prisma.acknowledgement.count({ where: { kind: "READ" } })).toBe(1);
    expect(await prisma.acknowledgement.count({ where: { kind: "ACKNOWLEDGED" } })).toBe(0);
    // failing then passing the quiz
    expect((await submitQuiz(lena, safetyVersion, { answers: [0, 1] })).passed).toBe(false);
    const pass = await submitQuiz(lena, safetyVersion, { answers: [1, 1] });
    expect(pass).toMatchObject({ score: 2, total: 2, passed: true });
    await acknowledge(lena, safetyVersion);
    // sign-off rules: trainer/supervisor only, not self, all checklist items demonstrated
    const checklist = [{ item: "Isolates all energy sources", done: true }, { item: "Verifies zero energy", done: false }];
    await expect(signoff(lena, safetyVersion, { learnerId: s.users.lena.id, checklist, outcome: "COMPETENT" })).rejects.toMatchObject({ status: 403 });
    const arun = await s.ctx("arun");
    await expect(signoff(arun, safetyVersion, { learnerId: s.users.lena.id, checklist, outcome: "COMPETENT" })).rejects.toMatchObject({ status: 409 });
    const done = await signoff(arun, safetyVersion, { learnerId: s.users.lena.id, checklist: checklist.map((c) => ({ ...c, done: true })), outcome: "COMPETENT" });
    expect(done.reassessOn!.getTime()).toBeGreaterThan(Date.now() + 300 * 86400_000);
    await expect(signoff(arun, safetyVersion, { learnerId: s.users.arun.id, checklist: checklist.map((c) => ({ ...c, done: true })), outcome: "COMPETENT" })).rejects.toMatchObject({ status: 403 }); // no self sign-off
    // leo has not passed the quiz -> cannot be signed off competent
    await expect(signoff(arun, safetyVersion, { learnerId: s.users.leo.id, checklist: checklist.map((c) => ({ ...c, done: true })), outcome: "COMPETENT" })).rejects.toMatchObject({ status: 409 });
    const mine = await myTraining(lena);
    expect(mine[0]).toMatchObject({ quizPassed: true, read: true });
    const report = await trainingReport(await s.ctx("olivia"));
    expect(report[0]).toMatchObject({ acknowledged: 1, quizPassed: 1, competent: 1 });
    expect(JSON.stringify(report)).not.toContain(s.users.lena.name);
    expect(JSON.stringify(report)).not.toContain(s.users.lena.id);
  });
});

describe("feedback privacy and webhooks", () => {
  it("owner sees feedback without the submitter's identity", async () => {
    const rows = await listFeedback(await s.ctx("olivia"), plainGuide);
    expect(rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(rows)).not.toContain(s.users.lena.id);
    await expect(listFeedback(await s.ctx("lena"), plainGuide)).rejects.toMatchObject({ status: 404 });
  });

  it("publication events are delivered to subscribers with a verifiable HMAC signature; SSRF targets are refused", async () => {
    const ada = await s.ctx("ada");
    const wh = await createWebhook(ada, { url: `http://127.0.0.1:${port}/hook`, events: ["guide.published"] });
    await publish("Webhook trigger guide");
    await drainJobs();
    expect(received).toHaveLength(1);
    const r = received[0];
    expect(JSON.parse(r.body)).toMatchObject({ event: "guide.published", data: { title: "Webhook trigger guide" } });
    const ts = String(r.headers["x-followme-timestamp"]);
    expect(r.headers["x-followme-signature"]).toBe(signPayload(wh.secret, ts, r.body));
    expect(await prisma.webhookDelivery.count({ where: { status: "DELIVERED" } })).toBe(1);
    process.env.WEBHOOK_ALLOW_LOCAL = "false";
    await expect(createWebhook(ada, { url: "http://127.0.0.1:9/hook", events: ["guide.published"] })).rejects.toMatchObject({ status: 400 });
    await expect(createWebhook(ada, { url: "https://169.254.169.254/latest/meta-data", events: ["guide.published"] })).rejects.toMatchObject({ status: 400 });
    await expect(createWebhook(ada, { url: "https://user:pw@example.com/x", events: ["guide.published"] })).rejects.toMatchObject({ status: 400 });
    process.env.WEBHOOK_ALLOW_LOCAL = "true";
    await expect(createWebhook(await s.ctx("alice"), { url: "https://example.com/x", events: ["guide.published"] })).rejects.toMatchObject({ status: 403 });
    server.close();
  });
});

describe("retention, legal hold and administration", () => {
  it("expires analytics logs and abandoned captures per policy, but never under legal hold, and never shared blobs", async () => {
    const old = new Date(Date.now() - 400 * 86400_000);
    await prisma.searchLog.create({ data: { orgId: s.org.id, query: "old", normalised: "old", resultCount: 0, at: old } });
    const alice = await s.ctx("alice");
    const shot = await mockScreenshot({ app: "A", screen: "B", button: "C" });
    const cs = await prisma.captureSession.create({ data: { orgId: s.org.id, userId: alice.userId, status: "STOPPED", startedAt: old } });
    const ev = await storeAsset(alice, { buffer: shot.buf, filename: "e.png", purpose: "EVIDENCE", allow: ["png"], captureSessionId: cs.id });
    const keep = await storeAsset(alice, { buffer: shot.buf, filename: "c.png", purpose: "CONTENT", allow: ["png"] }); // same bytes => shared blob
    await prisma.organization.update({ where: { id: s.org.id }, data: { legalHold: true } });
    expect(await retentionSweep(s.org.id)).toEqual({ skipped: "legal-hold" });
    expect(await prisma.captureSession.count({ where: { id: cs.id } })).toBe(1);
    await prisma.organization.update({ where: { id: s.org.id }, data: { legalHold: false } });
    const r = await retentionSweep(s.org.id);
    expect(r).toMatchObject({ captureSessions: 1, assets: 1 });
    expect(r).toMatchObject({ searchLogs: expect.any(Number) });
    expect(await prisma.captureSession.count({ where: { id: cs.id } })).toBe(0);
    expect(await prisma.asset.count({ where: { id: ev.id } })).toBe(0);
    expect(await blobStore().exists(keep.storageKey)).toBe(true); // blob still referenced by another asset
    expect(await prisma.searchLog.count({ where: { query: "old" } })).toBe(0);
    // published content untouched
    expect(await prisma.guide.count({ where: { orgId: s.org.id, liveVersionId: { not: null } } })).toBeGreaterThan(0);
  });

  it("deactivating a user revokes sessions and API tokens immediately; admin changes are audited; audit chain stays valid", async () => {
    const sess = await createSession(s.users.leo.id);
    expect(await ctxFromSessionCookie(sess.jwt)).not.toBeNull();
    const tok = await issueApiToken(await s.ctx("leo"), "t", ["capture"]);
    expect(await ctxFromBearer(`Bearer ${tok.token}`)).not.toBeNull();
    await updateUser(await s.ctx("ada"), s.users.leo.id, { active: false });
    expect(await ctxFromSessionCookie(sess.jwt)).toBeNull();
    expect(await ctxFromBearer(`Bearer ${tok.token}`)).toBeNull();
    await expect(updateUser(await s.ctx("alice"), s.users.leo.id, { active: true })).rejects.toMatchObject({ status: 403 });
    await updateSettings(await s.ctx("ada"), { aiPolicy: { enabled: true, externalAllowed: false } });
    await expect(updateSettings(await s.ctx("ada"), { capturePolicy: { redactPatterns: [{ name: "bad", regex: "(" }] } })).rejects.toMatchObject({ status: 409 });
    expect(await verifyAuditChain(s.org.id)).toMatchObject({ ok: true });
  });
});

import { createMap, updateMap, publishMap, getMap, listMaps } from "@/server/services/maps";
describe("process maps assemble published guides into an end-to-end process", () => {
  it("validates structure, requires published guides, and resolves references against the viewer's permissions", async () => {
    const docId = (await prisma.guide.findUniqueOrThrow({ where: { id: plainGuide } })).documentId;
    const olivia = await s.ctx("olivia");
    const m = await createMap(await s.ctx("alice"), { title: "Book and use a room" });
    const content = { triggers: ["Employee needs a room"], inputs: ["Date and attendees"], outputs: ["Room confirmation"], policies: ["Facilities policy"], forms: [],
      nodes: [{ id: "a", type: "task", title: "Book the room", role: "Employee", guideDocumentId: docId, controls: ["Manager approval above 10 people"], next: [{ to: "b", label: "" }] },
        { id: "b", type: "decision", title: "Is a caterer needed?", role: "Employee", controls: [], next: [{ to: "c", label: "Yes" }, { to: "d", label: "No" }] },
        { id: "c", type: "handoff", title: "Hand over to Facilities", role: "Facilities", controls: [], next: [{ to: "d", label: "" }] },
        { id: "d", type: "task", title: "Confirm booking", role: "Facilities", controls: [], next: [] }] };
    await updateMap(await s.ctx("alice"), m.id, { content });
    await expect(publishMap(await s.ctx("alice"), m.id)).rejects.toMatchObject({ status: 403 });
    await updateMap(await s.ctx("alice"), m.id, { content: { ...content, nodes: [...content.nodes, { id: "z", type: "task", title: "Orphan step", role: "", controls: [], next: [{ to: "nope", label: "" }] }] } });
    await expect(publishMap(olivia, m.id)).rejects.toMatchObject({ status: 422 });
    await updateMap(await s.ctx("alice"), m.id, { content });
    await publishMap(olivia, m.id);
    await expect(updateMap(await s.ctx("alice"), m.id, { content })).rejects.toMatchObject({ status: 409 }); // published maps are immutable
    const v = await getMap(await s.ctx("lena"), m.id);
    expect(v.refs[docId]).toMatchObject({ available: true });
    // a guide the viewer cannot see is shown as unavailable rather than leaking its title
    await prisma.guide.update({ where: { id: plainGuide }, data: { classification: "RESTRICTED" } });
    expect((await getMap(await s.ctx("lena"), m.id)).refs[docId]).toEqual({ title: docId, available: false });
    await prisma.guide.update({ where: { id: plainGuide }, data: { classification: "INTERNAL" } });
    const draft = await createMap(await s.ctx("alice"), { title: "Hidden draft" });
    expect((await listMaps(await s.ctx("lena"))).map((x) => x.id)).not.toContain(draft.id);
    await expect(getMap(await s.ctx("lena"), draft.id)).rejects.toMatchObject({ status: 404 });
  });
});
