import os from "node:os";
import path from "node:path";
import fs from "node:fs";
try { process.loadEnvFile(".env"); } catch { /* optional */ }
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://followme:followme@localhost:5432/followme_test";
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret-1234";
process.env.APP_BASE_URL = "http://localhost:3000";
process.env.JOBS_INLINE = "false";
process.env.AUTH_MODE = "local";
process.env.AI_PROVIDER = "local";
process.env.WEBHOOK_ALLOW_LOCAL = "true";
process.env.STORAGE_DRIVER = "local";
process.env.STORAGE_LOCAL_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "followme-test-"));
