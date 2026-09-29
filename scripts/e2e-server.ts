// Starts an isolated FollowMe instance for Playwright: fresh database, seeded demo data, production build.
import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

try { process.loadEnvFile(".env"); } catch { /* optional */ }
const PORT = process.env.E2E_PORT ?? "3100";
const base = process.env.TEST_DATABASE_URL ?? "postgresql://followme:followme@localhost:5432/followme_test";
const dbName = "followme_e2e";
const url = base.replace(/\/[^/]+$/, `/${dbName}`);

const admin = new pg.Client({ connectionString: base.replace(/\/[^/]+$/, "/postgres") });
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
await admin.query(`CREATE DATABASE "${dbName}"`);
await admin.end();

const storage = path.resolve(".tmp/e2e-storage");
fs.rmSync(storage, { recursive: true, force: true });
const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: url, STORAGE_LOCAL_DIR: storage, APP_BASE_URL: `http://localhost:${PORT}`, DEMO_MODE: "true", AUTH_MODE: "local", JOBS_INLINE: "true", SESSION_SECRET: "e2e-secret-e2e-secret-e2e-secret-12345", NODE_ENV: "production" } as NodeJS.ProcessEnv;
execSync("npx prisma migrate deploy", { env, stdio: "inherit" });
execSync("npx tsx prisma/seed.ts", { env, stdio: "inherit" });
const child = spawn("npx", ["next", "start", "-p", PORT], { env, stdio: "inherit" });
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { child.kill(sig); process.exit(0); });
child.on("exit", (c: number | null) => process.exit(c ?? 0));
