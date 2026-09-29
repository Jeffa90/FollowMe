// Capture -> guide at service level: evidence separation, regenerate, append, compare with an existing guide, crop, templates
import { beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { prisma } from "@/server/db";
import { freshOrg } from "./helpers";
import { startSession, recordEvent, setSessionStatus, generateGuideFromSession, appendSessionToVersion, regenerateStep, compareSessionWithGuide, discardSession, getSession } from "@/server/services/capture";
import { createGuide, getVersionDetail, saveContent, submitForReview, reviewDecision, approvalDecision, publishVersion, updateMetadata } from "@/server/services/guides";
import { cropAsset, readAsset } from "@/server/services/assets";
import { updateTemplateDefinition } from "@/server/services/admin";
import { runHealth } from "@/server/services/health";
import { mockScreenshot } from "@/server/fixtures";
import { flattenSteps } from "@/lib/guide-schema";
import { DEFAULT_TEMPLATES } from "@/lib/templates";

let s: Awaited<ReturnType<typeof freshOrg>>;
let shot: Awaited<ReturnType<typeof mockScreenshot>>;
const dataUrl = () => `data:image/png;base64,${shot.buf.toString("base64")}`;

async function record(ctx: Awaited<ReturnType<typeof s.ctx>>, sequence: { type: string; name: string; page?: string; role?: string; extra?: object }[]) {
  const sess = await startSession(ctx, { startUrl: "https://app.example/start" });
  let seq = 0;
  for (const e of sequence) {
    await recordEvent(ctx, sess.id, { seq: seq++, type: e.type, at: new Date(Date.now() + seq * 4000).toISOString(), url: `https://app.example/${e.page ?? "p"}`, pageTitle: "Portal - Contoso Portal", target: { tag: "button", role: e.role ?? "button", name: e.name, selectorHint: `b#${seq}` }, viewport: { width: 960, height: 600 }, rect: { x: 260, y: 250, w: 160, h: 46 }, screenshot: dataUrl(), ...e.extra });
  }
  await setSessionStatus(ctx, sess.id, "STOPPED");
  return sess.id;
}

beforeAll(async () => { s = await freshOrg(); shot = await mockScreenshot({ app: "Portal", screen: "Home", button: "Approve request" }); });

describe("capture → guide", () => {
  it("keeps original evidence separate from editable content, generates steps, and supports regeneration", async () => {
    const alice = await s.ctx("alice");
    const sid = await record(alice, [{ type: "click", name: "New request" }, { type: "click", name: "Approve request" }]);
    const g = await generateGuideFromSession(alice, sid, { templateKey: "general" });
    expect(g.steps).toBe(2);
    const d = await getVersionDetail(alice, g.versionId);
    const evidence = await prisma.asset.findMany({ where: { captureSessionId: sid, purpose: "EVIDENCE" } });
    const content = await prisma.asset.findMany({ where: { captureSessionId: sid, purpose: "CONTENT" } });
    expect(evidence).toHaveLength(2); expect(content).toHaveLength(2);
    const first = d.content.steps[0];
    expect(content.map((a) => a.id)).toContain(first.image!.assetId);
    expect(first.image!.sourceAssetId).toBe(evidence.find((e) => e.id === first.image!.sourceAssetId)!.id);
    expect(first.image!.annotations[0].kind).toBe("box"); // highlight of the target area
    expect(first.origin).toMatchObject({ type: "capture" });
    expect(d.source).toBe("CAPTURE");
    // editing the step never changes the evidence event
    const before = await prisma.captureEvent.findFirstOrThrow({ where: { id: first.origin.eventId! } });
    d.content.steps[0].text = "Totally reworded by the author.";
    await saveContent(alice, g.versionId, d.content, d.rev);
    expect(await prisma.captureEvent.findFirstOrThrow({ where: { id: first.origin.eventId! } })).toEqual(before);
    // regenerate proposes wording from the ORIGINAL evidence (author decides whether to apply)
    const r = await regenerateStep(alice, g.versionId, first.id);
    expect(r.text).toBe("Click **New request**.");
    // suggestions from generation are stored separately, not inserted
    const sug = await prisma.aiSuggestion.findMany({ where: { versionId: g.versionId } });
    expect(sug.every((x) => x.provider === "rules" && x.status === "PENDING")).toBe(true);
    expect(flattenSteps((await getVersionDetail(alice, g.versionId)).content.steps).some((x) => x.kind === "warning")).toBe(false);
    // a second generation from the same recording is refused; capture evidence is private to its creator
    await expect(generateGuideFromSession(alice, sid, {})).rejects.toMatchObject({ status: 409 });
    await expect(getSession(await s.ctx("arun"), sid)).rejects.toMatchObject({ status: 404 });
    expect((await getSession(await s.ctx("aud"), sid)).events).toHaveLength(2); // auditors may inspect evidence
    const ev = await prisma.asset.findFirstOrThrow({ where: { id: evidence[0].id } });
    await expect(readAsset(await s.ctx("arun"), ev.id)).rejects.toMatchObject({ status: 404 });
    await expect(prisma.asset.update({ where: { id: ev.id }, data: { sha256: "x" } })).rejects.toThrow(/immutable/);
  });

  it("adds missed steps by recording again (insert after a chosen step)", async () => {
    const alice = await s.ctx("alice");
    const g = await generateGuideFromSession(alice, await record(alice, [{ type: "click", name: "Open queue" }, { type: "click", name: "Close ticket" }]), {});
    const missed = await record(alice, [{ type: "click", name: "Assign ticket" }]);
    const d0 = await getVersionDetail(alice, g.versionId);
    const r = await appendSessionToVersion(alice, g.versionId, missed, d0.content.steps[0].id);
    expect(r.inserted).toBe(1);
    const d1 = await getVersionDetail(alice, g.versionId);
    expect(d1.content.steps.map((x) => x.title)).toEqual(["Click Open queue", "Click Assign ticket", "Click Close ticket"]);
  });

  it("compares a new recording with a published guide, reports changed/missing/new steps, and files a recommendation without touching approved content", async () => {
    const alice = await s.ctx("alice");
    const { guide, version } = await createGuide(alice, { title: "Approve a request", metadata: { ownerId: s.users.olivia.id, backupOwnerId: s.users.bob.id, escalationUserId: s.users.alan.id } });
    const orig = await generateGuideFromSession(alice, await record(alice, [{ type: "click", name: "New request" }, { type: "click", name: "Approve request" }]), {});
    const od = await getVersionDetail(alice, orig.versionId);
    await updateMetadata(alice, orig.guideId, { ownerId: s.users.olivia.id, backupOwnerId: s.users.bob.id, escalationUserId: s.users.alan.id });
    await saveContent(alice, orig.versionId, { ...od.content, purpose: "p", scope: "s", expectedResult: "r", steps: od.content.steps }, od.rev);
    await submitForReview(alice, orig.versionId);
    await reviewDecision(await s.ctx("rita"), orig.versionId, { decision: "APPROVE" });
    await approvalDecision(await s.ctx("alan"), orig.versionId, { decision: "APPROVE" });
    await publishVersion(await s.ctx("pat"), orig.versionId);
    void guide; void version;
    // the UI changed: the button is now called "Authorise", and a new confirmation step exists
    const changed = await record(alice, [{ type: "click", name: "New request" }, { type: "click", name: "Authorise" }, { type: "click", name: "Confirm decision" }]);
    const hash = (await prisma.guideVersion.findUniqueOrThrow({ where: { id: orig.versionId } })).contentHash;
    const r = await compareSessionWithGuide(alice, changed, orig.guideId, { fileRecommendation: true });
    expect(r.mismatches).toBeGreaterThanOrEqual(1);
    expect(r.diff.steps.some((x) => x.status === "added" || x.status === "changed" || x.status === "removed")).toBe(true);
    const rec = await prisma.reviewRecommendation.findFirstOrThrow({ where: { id: r.recommendationId! } });
    expect(rec.source).toBe("RECORDING_MISMATCH");
    expect(rec.status).toBe("OPEN");
    const after = await prisma.guideVersion.findUniqueOrThrow({ where: { id: orig.versionId } });
    expect(after.contentHash).toBe(hash); expect(after.status).toBe("PUBLISHED");
    // a recording identical to the guide files nothing
    const same = await record(alice, [{ type: "click", name: "New request" }, { type: "click", name: "Approve request" }]);
    expect((await compareSessionWithGuide(alice, same, orig.guideId, { fileRecommendation: true })).recommendationId).toBeNull();
  });

  it("discarded recordings cannot be turned into guides; unprocessed sessions can be discarded", async () => {
    const alice = await s.ctx("alice");
    const sid = await record(alice, [{ type: "click", name: "Something" }]);
    await discardSession(alice, sid);
    expect((await prisma.captureSession.findUniqueOrThrow({ where: { id: sid } })).status).toBe("DISCARDED");
    await expect(generateGuideFromSession(alice, sid, {})).rejects.toBeTruthy();
  });
});

describe("image tools and configurable templates", () => {
  it("crop creates a NEW asset and leaves the original untouched", async () => {
    const alice = await s.ctx("alice");
    const { guide, version } = await createGuide(alice, { title: "Crop test" });
    const { storeAsset } = await import("@/server/services/assets");
    const a = await storeAsset(alice, { buffer: shot.buf, filename: "s.png", purpose: "CONTENT", allow: ["png"], guideId: guide.id });
    const c = await cropAsset(alice, a.id, { x: 0.25, y: 0.4, w: 0.25, h: 0.12 }, guide.id);
    expect(c.id).not.toBe(a.id);
    const m = await sharp((await readAsset(alice, c.id)).buffer).metadata();
    expect(m.width).toBe(240); expect(m.height).toBe(72);
    expect((await prisma.asset.findUniqueOrThrow({ where: { id: a.id } })).sha256).toBe(a.sha256);
    await expect(cropAsset(alice, a.id, { x: 0.9, y: 0.9, w: 0.5, h: 0.5 }, guide.id)).resolves.toBeTruthy(); // clamped to the image
    await expect(cropAsset(alice, a.id, { x: 2, y: 0, w: 1, h: 1 }, guide.id)).rejects.toMatchObject({ status: 400 });
    await expect(cropAsset(await s.ctx("lena"), a.id, { x: 0, y: 0, w: 0.5, h: 0.5 })).rejects.toMatchObject({ status: 403 });
    void version;
  });

  it("templates are configurable per organisation and drive required-field checks", async () => {
    const ada = await s.ctx("ada");
    const tpl = await prisma.template.findFirstOrThrow({ where: { orgId: s.org.id, key: "general" } });
    const def = JSON.parse(JSON.stringify(tpl.definition));
    def.sections = def.sections.map((x: { key: string }) => (x.key === "hazards" ? { ...x, enabled: true, required: true } : x));
    await updateTemplateDefinition(ada, tpl.id, def);
    const alice = await s.ctx("alice");
    const { version } = await createGuide(alice, { title: "Template check", templateKey: "general" });
    const f = await runHealth(s.org.id, version.id);
    expect(f.find((x) => x.ruleId === "template.required.hazards")!.effectiveSeverity).toBe("BLOCKING_ERROR");
    await expect(updateTemplateDefinition(alice, tpl.id, def)).rejects.toMatchObject({ status: 403 });
    await expect(updateTemplateDefinition(ada, tpl.id, { sections: [] })).rejects.toBeTruthy();
    // four distinct seeded templates: SAP, administrative, safety, general controlled procedure
    expect(DEFAULT_TEMPLATES.map((t) => t.key)).toEqual(["general", "sap", "admin", "safety"]);
    expect(DEFAULT_TEMPLATES.find((t) => t.key === "sap")!.definition.requiredMeta).toEqual(["sapTransactions", "systems"]);
    expect(DEFAULT_TEMPLATES.find((t) => t.key === "safety")!.definition.sections.filter((x) => x.required).map((x) => x.key)).toEqual(expect.arrayContaining(["ppe", "hazards", "training", "competency"]));
  });
});
