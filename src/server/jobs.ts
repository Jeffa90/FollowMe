// Postgres-backed queue (FOR UPDATE SKIP LOCKED). Workers: `npm run worker`, or inline in dev (JOBS_INLINE=true).
import { hostname } from "node:os";
import { prisma } from "./db";
import { env } from "./env";

export type JobHandler = (payload: any, job: { id: string; orgId: string | null }) => Promise<unknown>;
const handlers = new Map<string, JobHandler>();

export function registerJob(type: string, h: JobHandler) {
  handlers.set(type, h);
}

export async function enqueue(type: string, payload: unknown, opts: { orgId?: string; runAt?: Date; maxAttempts?: number; queue?: string } = {}) {
  const job = await prisma.job.create({
    data: { type, payload: payload as object, orgId: opts.orgId, runAt: opts.runAt ?? new Date(), maxAttempts: opts.maxAttempts ?? 3, queue: opts.queue ?? "default" },
  });
  if (env().JOBS_INLINE === "true") setImmediate(() => void drainJobs().catch((e) => console.error("inline job error", e)));
  return job;
}

async function claim() {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "Job" SET status = 'RUNNING', "lockedAt" = now(), "lockedBy" = ${hostname() + ":" + process.pid}, attempts = attempts + 1
    WHERE id = (SELECT id FROM "Job" WHERE status = 'QUEUED' AND "runAt" <= now() ORDER BY "runAt", "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING id`;
  return rows[0]?.id ?? null;
}

/** Run one job; returns false when the queue is empty. */
export async function runOneJob(): Promise<boolean> {
  const id = await claim();
  if (!id) return false;
  const job = await prisma.job.findUniqueOrThrow({ where: { id } });
  const h = handlers.get(job.type);
  try {
    if (!h) throw new Error(`No handler for job type ${job.type}`);
    const result = await h(job.payload, { id: job.id, orgId: job.orgId });
    await prisma.job.update({ where: { id }, data: { status: "DONE", finishedAt: new Date(), result: (result ?? null) as never, lastError: null } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const final = job.attempts >= job.maxAttempts;
    await prisma.job.update({
      where: { id },
      data: { status: final ? "FAILED" : "QUEUED", lastError: msg.slice(0, 2000), finishedAt: final ? new Date() : null, runAt: new Date(Date.now() + 2 ** job.attempts * 1000) },
    });
  }
  return true;
}

let draining = false;
export async function drainJobs(max = 1000) {
  if (draining) return;
  draining = true;
  try {
    for (let i = 0; i < max; i++) if (!(await runOneJob())) break;
  } finally {
    draining = false;
  }
}

/** Reclaim jobs whose worker died mid-run. */
export async function requeueStale(olderThanMs = 10 * 60_000) {
  await prisma.$executeRaw`UPDATE "Job" SET status='QUEUED', "lockedAt"=NULL WHERE status='RUNNING' AND "lockedAt" < ${new Date(Date.now() - olderThanMs)}`;
}
