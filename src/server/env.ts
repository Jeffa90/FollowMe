import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_BASE_URL: z.string().default("http://localhost:3000"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  AUTH_MODE: z.enum(["local", "entra"]).default("local"),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./storage"),
  ASSET_ENCRYPTION_KEY: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_REGION: z.string().default("us-east-1"),
  AI_PROVIDER: z.string().default("local"),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),
  AI_BASE_URL: z.string().optional(),
  MALWARE_SCANNER: z.enum(["builtin", "clamav"]).default("builtin"),
  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: z.coerce.number().default(3310),
  OCR_PROVIDER: z.enum(["tesseract", "none"]).default("tesseract"),
  JOBS_INLINE: z.string().default("true"),
  NODE_ENV: z.string().default("development"),
  // Explicit opt-in that allows the local role-simulation login in a production build (demos/e2e only, never real deployments).
  DEMO_MODE: z.string().default("false"),
});

let cached: z.infer<typeof schema> | undefined;
export function env() {
  if (!cached) {
    // Empty strings in .env templates count as "unset"
    const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""));
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new Error("Invalid environment: " + parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    }
    // `next build` evaluates route modules to collect page data but serves nothing; the guard still applies to `next start`.
    const building = process.env.NEXT_PHASE === "phase-production-build";
    if (parsed.data.NODE_ENV === "production" && parsed.data.AUTH_MODE === "local" && !building) {
      if (parsed.data.DEMO_MODE !== "true") throw new Error("AUTH_MODE=local (role simulation) is not permitted when NODE_ENV=production. Set AUTH_MODE=entra, or DEMO_MODE=true for a throwaway demo.");
      console.warn("[followme] WARNING: DEMO_MODE=true with local role simulation in a production build. Anyone can sign in as any user. Never use in a real deployment.");
    }
    cached = parsed.data;
  }
  return cached;
}
export function resetEnvCache() {
  cached = undefined;
}
