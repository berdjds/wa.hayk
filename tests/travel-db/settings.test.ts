import { beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { ensureSchema, getPrisma } from "./helpers";

let prisma: PrismaClient;
let settings: typeof import("@/lib/travel/settings");

beforeAll(async () => {
  ensureSchema();
  prisma = await getPrisma();
  settings = await import("@/lib/travel/settings");
});

describe("getTravelSettings", () => {
  it("creates the singleton row with defaults on first read", async () => {
    const s = await settings.getTravelSettings();
    expect(s.id).toBe("default");
    expect(s.companyTz).toBe("Asia/Yerevan");
    const again = await settings.getTravelSettings();
    expect(again.id).toBe(s.id);
    expect(await prisma.travelSettings.count()).toBe(1);
  });
});

describe("getActivePolicy", () => {
  it("returns null when no policy is active, then the active one", async () => {
    expect(await settings.getActivePolicy()).toBeNull();
    await prisma.pricingPolicyVersion.create({
      data: {
        name: "Test policy",
        type: "MARKUP_ON_COST",
        rate: "0.14",
        active: true,
      },
    });
    const active = await settings.getActivePolicy();
    expect(active?.name).toBe("Test policy");
  });
});

describe("getFxMap", () => {
  it("picks the latest effective-dated rate per currency and always includes AMD", async () => {
    await prisma.fXRateVersion.createMany({
      data: [
        { currency: "USD", amdPerUnit: "300", effectiveFrom: "2026-01-01" },
        { currency: "USD", amdPerUnit: "400", effectiveFrom: "2026-06-01" },
        { currency: "EUR", amdPerUnit: "420", effectiveFrom: "2026-03-01" },
      ],
    });

    const march = await settings.getFxMap("2026-03-15");
    expect(march.USD).toBe("300");
    expect(march.EUR).toBe("420");
    expect(march.AMD).toBe("1");

    const july = await settings.getFxMap("2026-07-01");
    expect(july.USD).toBe("400");

    // Before any rate is effective, only AMD resolves.
    const early = await settings.getFxMap("2025-12-31");
    expect(early.USD).toBeUndefined();
    expect(early.AMD).toBe("1");
  });
});

describe("companyToday", () => {
  it("returns YYYY-MM-DD in the requested timezone", async () => {
    const today = await settings.companyToday("Asia/Yerevan");
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("defaults to the configured company timezone", async () => {
    const today = await settings.companyToday();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
