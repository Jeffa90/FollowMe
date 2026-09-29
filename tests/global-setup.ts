import { execSync } from "node:child_process";
import pg from "pg";

export default async function setup() {
  try { process.loadEnvFile(".env"); } catch { /* optional */ }
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://followme:followme@localhost:5432/followme_test";
  const u = new URL(url);
  const dbName = u.pathname.slice(1);
  const admin = new pg.Client({ connectionString: url.replace(`/${dbName}`, "/postgres") });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
}
