/**
 * QA: workbook reconciliation spot-checks (RECONCILIATION.md) against the
 * seeded catalog in a throwaway DB: exact template codes, Cascade SGL 24000
 * VERIFIED, Cozy House extra-bed conflict staging, Grand Hotel stop-sales,
 * Georgia Vista 4N PAX-4 band 216 USD, Lavash GROUP basis.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { ensureSchema, getPrisma } from "../travel-db/helpers";

let prisma: PrismaClient;

beforeAll(async () => {
  ensureSchema();
  prisma = await getPrisma();
  const { seedTravelCatalog } = await import("@/scripts/seed-travel-catalog");
  await seedTravelCatalog();
}, 120000);

describe("seeded catalog spot-checks", () => {
  it("has exactly the 13 workbook template codes, verbatim", async () => {
    const templates = await prisma.packageTemplate.findMany({ select: { code: true } });
    expect(templates.map((t) => t.code).sort()).toEqual(
      [
        "ARM-S26-0304A",
        "ARM-S26-0405A",
        "ARM-S26-0405B",
        "ARM-S26-0506A",
        "ARM-S26-0506B",
        "ARM-S26-0607A",
        "ARM-S26-0708A",
        "ARMG-S26-0304A",
        "ARMG-S26-0405A",
        "ARMG-S26-0506B",
        "ARMGG-S26-0506A", // double-G typo preserved verbatim (plan §3.6)
        "COM-S26-0607A",
        "GEO-S26-0405A",
      ].sort(),
    );
  });

  it("Cascade SGL is 24000 AMD VERIFIED (legacy fixture source)", async () => {
    const cascade = await prisma.hotelProduct.findFirst({
      where: { name: "3★ Cascade Hotel" },
      include: { rates: true },
    });
    const sgl = cascade?.rates.find((r) => r.occupancy === "SGL");
    expect(sgl).toMatchObject({ amount: "24000", currency: "AMD", status: "VERIFIED" });
    expect(sgl?.evidenceRef).toBe("Tour Calculator!C9");
  });

  it("Cozy House extra bed is staged NEEDS_REVIEW with the conflict note", async () => {
    const cozy = await prisma.hotelProduct.findFirst({
      where: { name: "4★ Dilijan Cozy House" },
      include: { rates: true },
    });
    expect(cozy?.extraBedAllowed).toBe(false);
    const bed = cozy?.rates.find((r) => r.occupancy === "EXTRA_BED");
    expect(bed?.status).toBe("NEEDS_REVIEW");
    expect(bed?.amount).toBe("10000"); // F36 catalog value preserved as evidence
    expect(bed?.notes).toContain("LY89");
  });

  it("Grand Hotel Yerevan rates carry the stop-sales window JSON", async () => {
    const grand = await prisma.hotelProduct.findFirst({
      where: { name: "5★ Grand Hotel Yerevan" },
      include: { rates: true },
    });
    expect(grand).toBeTruthy();
    for (const rate of grand!.rates) {
      expect(rate.stopSales, `rate ${rate.id} ${rate.occupancy}`).toBeTruthy();
      const windows = JSON.parse(rate.stopSales!);
      expect(windows[0]).toMatchObject({ from: "2026-10-01", to: "2026-11-01" });
      expect(windows[0].reason).toContain("GW40");
    }
  });

  it('Georgia Vista 4N/5D PAX-4 band rate is "216" USD per person', async () => {
    const vista = await prisma.serviceProduct.findFirst({
      where: { name: "Georgia 4N/5D — Vista hotel or similar (3★)" },
      include: { rates: true },
    });
    const pax4 = vista?.rates.find((r) => r.notes?.includes("paxBand: 4"));
    expect(pax4).toMatchObject({ amount: "216", currency: "USD", status: "VERIFIED" });
    expect(vista?.basis).toBe("PER_PERSON");
  });

  it("Georgia Brim/Orion 4N/5D PAX-4 band (D215=331 > C215=327) is NEEDS_REVIEW", async () => {
    // Non-monotonic band pricing: the 4-PAX per-person rate exceeds the 2-PAX
    // rate — almost certainly a workbook typo; never activate it silently.
    const brim = await prisma.serviceProduct.findFirst({
      where: { name: "Georgia 4N/5D — Brim - Orion hotels or similar (4★)" },
      include: { rates: true },
    });
    expect(brim).toBeTruthy();
    const pax4 = brim!.rates.find((r) => r.notes?.includes("paxBand: 4"));
    expect(pax4?.amount).toBe("331"); // evidence preserved
    expect(pax4?.status).toBe("NEEDS_REVIEW");
    expect(pax4?.notes).toContain("NON-MONOTONIC");
    expect(pax4?.notes).toContain("D215");
    // The monotonic neighbors stay VERIFIED.
    for (const band of [2, 6]) {
      const r = brim!.rates.find((x) => x.notes?.includes(`paxBand: ${band}`));
      expect(r?.status, `PAX ${band}`).toBe("VERIFIED");
    }
  });

  it("Grand Hotel Yerevan rates are quote-on-request with the GW40 note", async () => {
    const grand = await prisma.hotelProduct.findFirst({
      where: { name: "5★ Grand Hotel Yerevan" },
      include: { rates: true },
    });
    expect(grand).toBeTruthy();
    for (const rate of grand!.rates) {
      expect(rate.quoteOnRequest, `rate ${rate.id} ${rate.occupancy}`).toBe(true);
      expect(rate.notes).toContain("May 2026 quote-on-request per supplier email GW40 (unverified)");
    }
  });

  it("Lavash baking is priced per GROUP, not per person", async () => {
    const lavash = await prisma.serviceProduct.findFirst({
      where: { name: "Lavash Baking" },
      include: { rates: true },
    });
    expect(lavash?.basis).toBe("GROUP");
    expect(lavash?.category).toBe("TICKETS");
    expect(lavash?.rates[0]?.amount).toBe("10000");
    expect(lavash?.rates[0]?.status).toBe("VERIFIED");
  });
});
