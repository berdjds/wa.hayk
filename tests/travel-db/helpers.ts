/**
 * Shared setup for travel-db tests: each test FILE gets its own throwaway
 * SQLite database, created with `prisma db push` before the Prisma client is
 * imported (the client reads DATABASE_URL at instantiation).
 */

import { execSync } from "child_process";
import path from "path";
import type { PrismaClient } from "@prisma/client";

const rand = `${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
export const TEST_DATABASE_URL = `file:/tmp/wacontrol-test-${rand}.db`;

process.env.DATABASE_URL = TEST_DATABASE_URL;

let pushed = false;

export function ensureSchema(): void {
  if (pushed) return;
  execSync("npx prisma db push --skip-generate", {
    cwd: path.resolve(__dirname, "..", ".."),
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "pipe",
  });
  pushed = true;
}

/** Lazily imports the Prisma client AFTER DATABASE_URL has been set. */
export async function getPrisma(): Promise<PrismaClient> {
  const { prisma } = await import("@/lib/prisma");
  return prisma;
}
