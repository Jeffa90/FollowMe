// Publication events for downstream systems (Power Automate, SharePoint sync, LMS). Signed, retried, SSRF-guarded.
import { createHmac, randomBytes } from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import { z } from "zod";
import { prisma } from "../db";
import { enqueue, registerJob } from "../jobs";
import { audit } from "../audit";
import type { Ctx } from "../ctx";
import { badRequest, forbidden } from "../errors";
import { hasRole } from "../ctx";

export const WEBHOOK_EVENTS = ["guide.published", "guide.archived", "guide.review_recommended"] as const;

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const l = ip.toLowerCase();
  return l === "::1" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80") || l === "::";
}

/** Reject non-https, credentials in URL, and hosts resolving to private/loopback/link-local ranges (SSRF). */
export async function assertSafeWebhookUrl(raw: string, allowInsecureLocal = false) {
  let u: URL;
  try { u = new URL(raw); } catch { throw badRequest("Invalid URL"); }
  if (u.username || u.password) throw badRequest("Credentials in URL are not allowed");
  if (allowInsecureLocal) return;
  if (u.protocol !== "https:") throw badRequest("Webhook URLs must use https");
  const addrs = net.isIP(u.hostname) ? [{ address: u.hostname }] : await dns.lookup(u.hostname, { all: true }).catch(() => []);
  if (!addrs.length) throw badRequest("Webhook host does not resolve");
  if (addrs.some((a) => isPrivateIp(a.address))) throw badRequest("Webhook host resolves to a private or loopback address");
}

const allowLocal = () => process.env.WEBHOOK_ALLOW_LOCAL === "true"; // tests / dev only

export async function createWebhook(ctx: Ctx, input: unknown) {
  if (!hasRole(ctx, "ADMIN")) throw forbidden();
  const { url, events } = z.object({ url: z.string().url().max(500), events: z.array(z.enum(WEBHOOK_EVENTS)).min(1) }).parse(input);
  await assertSafeWebhookUrl(url, allowLocal());
  const secret = randomBytes(24).toString("hex");
  const w = await prisma.webhookSubscription.create({ data: { orgId: ctx.orgId, url, events, secret } });
  await audit(ctx, null, { action: "WEBHOOK_CREATED", entityType: "WebhookSubscription", entityId: w.id, summary: `Webhook created for ${new URL(url).host}`, detail: { events } });
  return { id: w.id, url, events, secret }; // secret shown once
}

export async function emitEvent(orgId: string, event: string, payload: Record<string, unknown>) {
  const subs = await prisma.webhookSubscription.findMany({ where: { orgId, active: true, events: { has: event } } });
  for (const s of subs) {
    const d = await prisma.webhookDelivery.create({ data: { orgId, subscriptionId: s.id, event, payload: { event, occurredAt: new Date().toISOString(), data: payload } as object } });
    await enqueue("webhook.deliver", { deliveryId: d.id }, { orgId, maxAttempts: 5 });
  }
}

export function signPayload(secret: string, timestamp: string, body: string) {
  return "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

registerJob("webhook.deliver", async ({ deliveryId }: { deliveryId: string }) => {
  const d = await prisma.webhookDelivery.findUniqueOrThrow({ where: { id: deliveryId }, include: { subscription: true } });
  await assertSafeWebhookUrl(d.subscription.url, allowLocal());
  const body = JSON.stringify(d.payload);
  const ts = String(Math.floor(Date.now() / 1000));
  await prisma.webhookDelivery.update({ where: { id: d.id }, data: { attempts: { increment: 1 } } });
  const res = await fetch(d.subscription.url, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
    headers: { "content-type": "application/json", "x-followme-event": d.event, "x-followme-timestamp": ts, "x-followme-signature": signPayload(d.subscription.secret, ts, body) },
    body,
  });
  await prisma.webhookDelivery.update({ where: { id: d.id }, data: { responseCode: res.status, status: res.ok ? "DELIVERED" : "FAILED", deliveredAt: res.ok ? new Date() : null, lastError: res.ok ? null : `HTTP ${res.status}` } });
  if (!res.ok) throw new Error(`Webhook responded ${res.status}`);
});
