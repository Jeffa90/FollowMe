import { defineConfig } from "prisma/config";

try {
  process.loadEnvFile(".env");
} catch {
  /* .env is optional (CI / containers inject env vars) */
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "postgresql://followme:followme@localhost:5432/followme",
  },
});
