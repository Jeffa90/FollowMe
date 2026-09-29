// Security tests: authentication, CSRF, BOLA/cross-org isolation, RBAC over HTTP, validation, uploads, capture guardrails, headers
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { freshOrg, call } from "./helpers";
import { seedBase } from "@/server/seed";
import { createGuide, saveContent, getVersionDetail, submitForReview, reviewDecision, approvalDecision, publishVersion } from "@/server/services/guides";
import { issueApiToken } from "@/server/session";
import { resetEnvCache, env } from "@/server/env";
import { EncryptedStore, LocalStore } from "@/server/storage";
import { mockScreenshot } from "@/server/fixtures";
import { newStep } from "@/lib/guide-schema";
import { proxy } from "@/proxy";
import * as loginRoute from "@/app/api/auth/login/route";
import * as guidesRoute from "@/app/api/guides/route";
import * as guideRoute from "@/app/api/guides/[id]/route";
import * as versionRoute from "@/app/api/versions/[id]/route";
import * as contentRoute from "@/app/api/versions/[id]/content/route";
import * as workflowRoute from "@/app/api/versions/[id]/workflow/route";
import * as imageRoute from "@/app/api/versions/[id]/steps/[stepId]/image/route";
import * as assetsRoute from "@/app/api/assets/route";
import * as assetRoute from "@/app/api/assets/[id]/route";
import * as searchRoute from "@/app/api/search/route";
import * as adminUsers from "@/app/api/admin/users/route";
import * as capSessions from "@/app/api/capture/sessions/route";
import * as capSession from "@/app/api/capture/sessions/[id]/route";
import * as capEvents from "@/app/api/capture/sessions/[id]/events/route";
import * as capPolicy from "@/app/api/capture/policy/route";
import * as tokenRoute from "@/app/api/auth/token/route";
import * as importItem from "@/app/api/imports/[id]/route";
import * as exportRoute from "@/app/api/versions/[id]/export/route";

let s: Awaited<ReturnType<typeof freshOrg>>;
let other: Awaited<ReturnType<typeof seedBase>>;
let guideId: string, versionId: string, draftId: string, draftGuideId: string, stepId: string;

async function makeGuide(title: string, publishIt: boolean) {
  const alice = await s.ctx("alice");
  const { guide, version } = await createGuide(alice, { title, metadata: { ownerId: s.users.olivia.id, backupOwnerId: s.users.bob.id, escalationUserId: s.users.alan.id } });
  const d = await getVersionDetail(alice, version.id);
  const step = newStep("action", { title: "Do it", text: "Do it." });
  await saveContent(alice, version.id, { ...d.content, purpose: "p", scope: "s", expectedResult: "r", steps: [step] }, d.rev);
  if (publishIt) {
    await submitForReview(alice, version.id);
    await reviewDecision(await s.ctx("rita"), version.id, { decision: "APPROVE" });
    await approvalDecision(await s.ctx("alan"), version.id, { decision: "APPROVE" });
    await publishVersion(await s.ctx("pat"), version.id);
  }
  return { guide, version, step };
}

beforeAll(async () => {
  s = await freshOrg();
  const pub = await makeGuide("Published guide", true);
  guideId = pub.guide.id; versionId = pub.version.id; stepId = pub.step.id;
  const dr = await makeGuide("Secret draft", false);
  draftId = dr.version.id; draftGuideId = dr.guide.id;
  other = await seedBase("other-org");
});

describe("authentication & CSRF", () => {
  it("rejects unauthenticated calls", async () => {
    for (const [h, params] of [[guidesRoute.GET, {}], [guideRoute.GET, { id: guideId }], [versionRoute.GET, { id: versionId }], [searchRoute.GET, {}], [adminUsers.GET, {}]] as const) {
      const r = await call(h as never, { params, url: "http://localhost:3000/api/search?q=x" });
      expect(r.status).toBe(401);
    }
  });

  it("requires a valid CSRF token on cookie-authenticated mutations and blocks cross-origin requests", async () => {
    const body = { title: "New", templateKey: "general" };
    expect((await call(guidesRoute.POST, { userId: s.users.alice.id, body, noCsrf: true })).status).toBe(403);
    expect((await call(guidesRoute.POST, { userId: s.users.alice.id, body, headers: { "x-csrf-token": "wrong" }, noCsrf: true })).status).toBe(403);
    expect((await call(guidesRoute.POST, { userId: s.users.alice.id, body, headers: { origin: "https://evil.example" } })).status).toBe(403);
    expect((await call(guidesRoute.POST, { userId: s.users.alice.id, body, headers: { origin: "http://localhost:3000" } })).status).toBe(200);
    expect((await call(guidesRoute.GET, { userId: s.users.alice.id })).status).toBe(200); // reads need no CSRF token
  });

  it("scoped API tokens only work on token-enabled endpoints and only with the right scope", async () => {
    const t = await issueApiToken(await s.ctx("alice"), "ext", ["capture"]);
    expect((await call(guidesRoute.GET, { bearer: t.token })).status).toBe(401); // session-only endpoint
    expect((await call(capPolicy.GET, { bearer: t.token })).status).toBe(200);
    expect((await call(capPolicy.GET, { bearer: "fmt_forged" })).status).toBe(401);
    // tokens cannot be minted from a token
    expect((await call(tokenRoute.POST, { bearer: t.token, body: { name: "x", scopes: ["capture"] } })).status).toBe(401);
    const noScope = await prisma.apiToken.create({ data: { orgId: s.org.id, userId: s.users.alice.id, name: "n", scopes: [], tokenHash: (await import("@/server/session")).hashToken("fmt_noscope"), expiresAt: new Date(Date.now() + 1e9) } });
    void noScope;
    expect((await call(capPolicy.GET, { bearer: "fmt_noscope" })).status).toBe(401);
  });

  it("login is rate limited and sets HttpOnly SameSite cookies (CSRF cookie readable by the client)", async () => {
    const r = await call(loginRoute.POST, { body: { email: "alice@contoso.example" } });
    expect(r.status).toBe(200);
    const cookies = r.res.headers.getSetCookie();
    expect(cookies.find((c) => c.startsWith("fm_session="))).toMatch(/HttpOnly.*SameSite=Lax/);
    expect(cookies.find((c) => c.startsWith("fm_csrf="))).not.toMatch(/HttpOnly/);
    expect((await call(loginRoute.POST, { body: { email: "nobody@contoso.example" } })).status).toBe(401);
    let last = 0;
    for (let i = 0; i < 25; i++) last = (await call(loginRoute.POST, { body: { email: "nobody@contoso.example" } })).status;
    expect(last).toBe(429);
  });

  it("the local role-simulation login cannot be enabled in production without an explicit demo opt-in", () => {
    const save = { ...process.env };
    try {
      (process.env as Record<string, string>).NODE_ENV = "production"; process.env.AUTH_MODE = "local"; delete process.env.DEMO_MODE; resetEnvCache();
      expect(() => env()).toThrow(/not permitted when NODE_ENV=production/);
      process.env.AUTH_MODE = "entra"; resetEnvCache();
      expect(env().AUTH_MODE).toBe("entra");
    } finally { Object.assign(process.env, save); resetEnvCache(); }
  });
});

describe("broken object-level authorisation and tenant isolation", () => {
  it("another organisation cannot read or touch any object by id (404, not 403)", async () => {
    const eve = other.users.alice; // same role, different org
    const asset = await prisma.asset.findFirst({ where: { orgId: s.org.id } });
    const sess = await prisma.captureSession.create({ data: { orgId: s.org.id, userId: s.users.alice.id } });
    const item = await prisma.importItem.create({ data: { orgId: s.org.id, createdById: s.users.alice.id, filename: "f", mime: "text/plain", size: 1, sha256: "x", sourceAssetId: "y" } });
    const checks: [string, Promise<{ status: number }>][] = [
      ["guide", call(guideRoute.GET, { userId: eve.id, params: { id: guideId } })],
      ["version", call(versionRoute.GET, { userId: eve.id, params: { id: versionId } })],
      ["content write", call(contentRoute.PUT, { userId: eve.id, params: { id: draftId }, body: { content: {}, rev: 1 } })],
      ["workflow", call(workflowRoute.POST, { userId: eve.id, params: { id: draftId }, body: { action: "submit" } })],
      ["image", call(imageRoute.GET, { userId: eve.id, params: { id: versionId, stepId } })],
      ["capture session", call(capSession.GET, { userId: eve.id, params: { id: sess.id } })],
      ["import item", call(importItem.GET, { userId: eve.id, params: { id: item.id } })],
      ["export", call(exportRoute.GET, { userId: eve.id, params: { id: versionId }, url: "http://localhost:3000/api/x?format=pdf" })],
      ...(asset ? [["asset", call(assetRoute.GET, { userId: eve.id, params: { id: asset.id } })] as [string, Promise<{ status: number }>]] : []),
    ];
    for (const [name, p] of checks) expect({ name, status: (await p).status }).toEqual({ name, status: 404 });
    // and search never leaks across tenants
    const r = await call(searchRoute.GET, { userId: eve.id, url: "http://localhost:3000/api/search?q=guide" });
    expect(r.data.hits).toEqual([]);
  });

  it("within an organisation, drafts and evidence are hidden from learners and unrelated roles", async () => {
    expect((await call(versionRoute.GET, { userId: s.users.lena.id, params: { id: draftId } })).status).toBe(404);
    expect((await call(guideRoute.GET, { userId: s.users.lena.id, params: { id: draftGuideId } })).data?.versions ?? []).toEqual([]);
    expect((await call(imageRoute.GET, { userId: s.users.lena.id, params: { id: draftId, stepId } })).status).toBe(404);
    const hits = (await call(searchRoute.GET, { userId: s.users.lena.id, url: "http://localhost:3000/api/search?q=secret" })).data.hits;
    expect(hits).toEqual([]);
    // evidence assets (capture screenshots) are private to their creator/owner/auditor
    const shot = await mockScreenshot({ app: "A", screen: "B", button: "C" });
    const ev = await prisma.asset.create({ data: { orgId: s.org.id, sha256: "e", mime: "image/png", size: shot.buf.length, storageKey: "x/y", originalName: "e.png", purpose: "EVIDENCE", createdById: s.users.alice.id } });
    expect((await call(assetRoute.GET, { userId: s.users.lena.id, params: { id: ev.id } })).status).toBe(404);
    expect((await call(assetRoute.GET, { userId: s.users.arun.id, params: { id: ev.id } })).status).toBe(404); // another author is not the creator
  });
});

describe("RBAC over HTTP, validation and uploads", () => {
  it("enforces roles server-side for creation, editing, workflow and administration", async () => {
    expect((await call(guidesRoute.POST, { userId: s.users.lena.id, body: { title: "x" } })).status).toBe(403);
    expect((await call(adminUsers.GET, { userId: s.users.alice.id })).status).toBe(403);
    expect((await call(adminUsers.GET, { userId: s.users.ada.id })).status).toBe(200);
    expect((await call(contentRoute.PUT, { userId: s.users.alan.id, params: { id: draftId }, body: { content: {}, rev: 1 } })).status).toBe(403); // approvers may read working versions but never edit content
    expect((await call(workflowRoute.POST, { userId: s.users.alice.id, params: { id: versionId }, body: { action: "publish" } })).status).toBe(403);
    expect((await call(workflowRoute.POST, { userId: s.users.pat.id, params: { id: draftId }, body: { action: "publish" } })).status).toBe(409); // not approved
    expect((await call(contentRoute.PUT, { userId: s.users.alice.id, params: { id: versionId }, body: { content: { title: "hack" }, rev: 1 } })).status).toBe(409); // published is immutable
  });

  it("validates input: malformed JSON, schema errors, unsafe URLs, foreign asset references", async () => {
    expect((await call(guidesRoute.POST, { userId: s.users.alice.id, raw: "{not json", headers: { "content-type": "application/json" } })).status).toBe(400);
    const bad = await call(guidesRoute.POST, { userId: s.users.alice.id, body: { title: "" } });
    expect(bad.status).toBe(400); expect(bad.data.error.code).toBe("validation_failed");
    const d = await getVersionDetail(await s.ctx("alice"), draftId);
    const xss = { ...d.content, steps: [newStep("action", { title: "x", text: "y", links: [{ label: "click", url: "javascript:alert(1)" }] })] };
    expect((await call(contentRoute.PUT, { userId: s.users.alice.id, params: { id: draftId }, body: { content: xss, rev: d.rev } })).status).toBe(422);
    const foreign = await prisma.asset.create({ data: { orgId: other.org.id, sha256: "f", mime: "image/png", size: 1, storageKey: "o/f", originalName: "f.png", purpose: "CONTENT" } });
    const ref = { ...d.content, steps: [newStep("action", { title: "x", text: "y", image: { assetId: foreign.id, alt: "a", annotations: [] } })] };
    expect((await call(contentRoute.PUT, { userId: s.users.alice.id, params: { id: draftId }, body: { content: ref, rev: d.rev } })).status).toBe(422); // cannot reference another tenant's file
  });

  it("uploads: content sniffing, malware signature, SVG/script rejection", async () => {
    const png = (await mockScreenshot({ app: "A", screen: "B", button: "C" })).buf;
    const up = (name: string, data: Buffer | string, type = "image/png") => { const fd = new FormData(); fd.set("file", new File([typeof data === "string" ? data : new Uint8Array(data)], name, { type })); fd.set("purpose", "CONTENT"); return call(assetsRoute.POST, { userId: s.users.alice.id, raw: fd }); };
    expect((await up("ok.png", png)).status).toBe(200);
    expect((await up("evil.png", "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>", "image/svg+xml")).status).toBe(422);
    expect((await up("evil.svg", "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>", "image/svg+xml")).status).toBe(422);
    expect((await up("exe.png", Buffer.from("MZ\x90\x00\x03\x00\x00\x00 fake exe"))).status).toBe(422);
    expect((await up("eicar.png", "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*")).status).toBe(422);
    expect((await up("polyglot.png", Buffer.concat([png, Buffer.from("<script>alert(1)</script>")]))).status).toBe(200); // still a valid PNG; served with nosniff + sandbox CSP as an image only
    const id = (await up("ok2.png", png)).data.id;
    const served = await call(assetRoute.GET, { userId: s.users.alice.id, params: { id } });
    expect(served.res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(served.res.headers.get("content-security-policy")).toContain("sandbox");
    expect((await call(assetsRoute.POST, { userId: s.users.lena.id, raw: (() => { const fd = new FormData(); fd.set("file", new File([new Uint8Array(png)], "a.png")); return fd; })() })).status).toBe(403);
  });

  it("stored files are encrypted at rest and storage keys cannot traverse paths", async () => {
    const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "enc-"));
    const store = new EncryptedStore(new LocalStore(dir), Buffer.alloc(32, 7));
    await store.put("a/b/blob", Buffer.from("top secret screenshot bytes"));
    expect(fs.readFileSync(path.join(dir, "a/b/blob")).includes(Buffer.from("top secret"))).toBe(false);
    expect((await store.get("a/b/blob")).toString()).toBe("top secret screenshot bytes");
    const raw = fs.readFileSync(path.join(dir, "a/b/blob")); raw[40] ^= 1; fs.writeFileSync(path.join(dir, "a/b/blob"), raw);
    await expect(store.get("a/b/blob")).rejects.toThrow(); // tamper detection (GCM auth tag)
    await expect(new LocalStore(dir).get("../../etc/passwd")).rejects.toThrow(/Invalid storage key/);
  });
});

describe("capture guardrails enforced server-side", () => {
  let token: string;
  beforeAll(async () => { token = (await issueApiToken(await s.ctx("alice"), "ext", ["capture"])).token; });
  const ev = (o: Record<string, unknown>) => ({ seq: 1, type: "click", at: new Date().toISOString(), url: "https://app.example/page?token=SECRET#frag", pageTitle: "Page - App", target: { tag: "button", role: "button", name: "Save" }, ...o });

  it("never stores values, keystrokes, query strings or unredacted patterns, and rejects restricted domains", async () => {
    const start = await call(capSessions.POST, { bearer: token, body: { startUrl: "https://app.example/start?x=1", extensionVersion: "0.1.0" } });
    expect(start.status).toBe(200);
    const id = start.data.id;
    const ok = await call(capEvents.POST, { bearer: token, params: { id }, body: ev({ target: { tag: "input", role: "textbox", name: "Contact jane.doe@contoso.example", label: "Email", value: "hunter2", keys: "abcd", inputType: "text" } }) });
    expect(ok.status).toBe(200);
    const stored = await prisma.captureEvent.findFirstOrThrow({ where: { sessionId: id } });
    const dump = JSON.stringify(stored);
    expect(dump).not.toContain("hunter2"); expect(dump).not.toContain("abcd");
    expect(dump).not.toContain("SECRET"); expect(dump).not.toContain("frag"); expect(stored.url).toBe("https://app.example/page");
    expect(dump).not.toContain("jane.doe@contoso.example"); expect(dump).toContain("[redacted]");
    expect((await prisma.captureSession.findUniqueOrThrow({ where: { id } })).startUrl).toBe("https://app.example/start");
    // idempotent retry, bad screenshot
    expect((await call(capEvents.POST, { bearer: token, params: { id }, body: ev({}) })).status).toBe(200);
    expect(await prisma.captureEvent.count({ where: { sessionId: id } })).toBe(1);
    expect((await call(capEvents.POST, { bearer: token, params: { id }, body: ev({ seq: 2, screenshot: "data:text/html;base64,PHNjcmlwdD4=" }) })).status).toBe(422);
    // restricted domain: event rejected, session force-paused, audited
    const r = await call(capEvents.POST, { bearer: token, params: { id }, body: ev({ seq: 3, url: "https://portal.payroll.example/salaries" }) });
    expect(r.status).toBe(422); expect(r.data.error.code).toBe("restricted_domain");
    expect((await prisma.captureSession.findUniqueOrThrow({ where: { id } })).status).toBe("PAUSED");
    expect((await call(capEvents.POST, { bearer: token, params: { id }, body: ev({ seq: 4 }) })).status).toBe(409); // paused sessions accept nothing
    expect(await prisma.auditEvent.count({ where: { action: "CAPTURE_BLOCKED_RESTRICTED" } })).toBe(1);
    expect((await call(capSessions.POST, { bearer: token, body: { startUrl: "https://bank.example/login" } })).status).toBe(403); // cannot even start
    // other users cannot post into your session
    const t2 = (await issueApiToken(await s.ctx("arun"), "ext", ["capture"])).token;
    expect((await call(capEvents.POST, { bearer: t2, params: { id }, body: ev({ seq: 9 }) })).status).toBe(404);
    // only authors can capture
    const tl = (await issueApiToken(await s.ctx("lena"), "ext", ["capture"])).token;
    expect((await call(capSessions.POST, { bearer: tl, body: { startUrl: "https://app.example/" } })).status).toBe(403);
    void capSession;
  });

  it("the capture kill switch stops recording immediately", async () => {
    await prisma.organization.update({ where: { id: s.org.id }, data: { capturePolicy: { enabled: false } } });
    expect((await call(capSessions.POST, { bearer: token, body: { startUrl: "https://app.example/" } })).status).toBe(403);
    const pol = await call(capPolicy.GET, { bearer: token });
    expect(pol.data.enabled).toBe(false);
    await prisma.organization.update({ where: { id: s.org.id }, data: { capturePolicy: { enabled: true, restrictedDomains: ["bank.example", "*.payroll.example"] } } });
  });
});

describe("security headers (CSP nonce, framing, embed allow-list)", () => {
  it("sets a per-request CSP nonce, denies framing everywhere except /embed/, which allows only SharePoint/Teams", () => {
    const a = proxy(new NextRequest("http://localhost:3000/library"));
    const b = proxy(new NextRequest("http://localhost:3000/library"));
    const csp = a.headers.get("content-security-policy")!;
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    expect(csp).toContain("object-src 'none'"); expect(csp).toContain("frame-ancestors 'none'"); expect(csp).toContain("default-src 'self'");
    expect(a.headers.get("x-frame-options")).toBe("DENY");
    expect(csp).not.toEqual(b.headers.get("content-security-policy")); // nonce differs per request
    const embed = proxy(new NextRequest("http://localhost:3000/embed/g/WI-0001")).headers.get("content-security-policy")!;
    expect(embed).toContain("frame-ancestors 'self' https://*.sharepoint.com");
    expect(proxy(new NextRequest("http://localhost:3000/embed/g/WI-0001")).headers.get("x-frame-options")).toBeNull();
    expect(a.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
