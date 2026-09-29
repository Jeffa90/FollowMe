import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "./env";

const g = globalThis as unknown as { __prisma?: PrismaClient };

export const prisma: PrismaClient =
  g.__prisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: env().DATABASE_URL, max: 10 }),
  });
if (process.env.NODE_ENV !== "production") g.__prisma = prisma;

export type Tx = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];
export type Db = PrismaClient | Tx;
