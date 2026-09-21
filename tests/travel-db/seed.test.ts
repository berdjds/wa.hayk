import { beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { ensureSchema, getPrisma } from "./helpers";

let prisma: PrismaClient;
let seed: typeof import("@/scripts/seed-travel-catalog");

beforeAll(async () => {
  ensureSchema();
  prisma = await getPrisma();
  seed = await import("@/scripts/seed-travel-catalog");
});

describe("seedTravelCatalog", () => {
  it("activates the workbook catalog", async () => {
    const summary = await seed.seedTravelCatalog();
    expect(summary.vehicles).toBe(4);
    expect(summary.hotels).toBe(34);
    expect(summary.templates).toBe(13);
    // 89 workbook service rows + 6 Georgia band products
    expect(summary.services).toBe(95);
    expect(summary.ratesByStatus.VERIFIED).toBeGreaterThan(0);
    expect(summary.ratesByStatus.NEEDS_REVIEW).toBeGreaterThan(0);
  });

  it("is idempotent: a second run yields the same counts", async () => {
    const first = await seed.seedTravelCatalog();
    const second = await seed.seedTravelCatalog();
    expect(second).toEqual(first);
  });

  it("flags the catalog/agreement conflicts from the plan", async () => {
    const cozy = await prisma.hotelProduct.findFirst({
      where: { name: "4★ Dilijan Cozy House" },
    });
    expect(cozy?.extraBedAllowed).toBe(false);

    const grand = await prisma.hotelProduct.findFirst({
      where: { name: "5★ Grand Hotel Yerevan" },
      include: { rates: true },
    });
    expect(grand?.rates[0]?.stopSales).toContain("2026-10-01");
    expect(grand?.rates[0]?.stopSales).toContain("GW40");

    const teghenis = await prisma.hotelProduct.findFirst({
      where: { name: "3★ Tsaghkadzor Teghenis (Cottages)" },
    });
    expect(teghenis?.kind).toBe("COTTAGE_UNIT");
    expect(teghenis?.capacityTotal).toBe(5);
  });

  it("applies the correct pricing bases to services", async () => {
    const lavash = await prisma.serviceProduct.findFirst({ where: { name: "Lavash Baking" } });
    expect(lavash?.basis).toBe("GROUP");

    const jeep = await prisma.serviceProduct.findFirst({ where: { name: "Garni Jeep (1-3 pax)" } });
    expect(jeep?.basis).toBe("CAPACITY_BLOCK");
    expect(jeep?.capacity).toBe(3);

    const boat = await prisma.serviceProduct.findFirst({
      where: { name: "Sevan Boat Trip (1-25 pax)" },
    });
    expect(boat?.capacity).toBe(25);

    const groupTour = await prisma.serviceProduct.findFirst({
      where: { name: { startsWith: "Group Tour: The Arch of Yeghishe Charents" } },
    });
    expect(groupTour?.basis).toBe("PER_PERSON");
    expect(groupTour?.weekdays).toBe("[3,5,7]"); // Wed-Fri-Sun, F69

    const guide = await prisma.serviceProduct.findFirst({ where: { name: "English Full Day" } });
    expect(guide?.basis).toBe("GUIDE_DAY");

    const leader = await prisma.serviceProduct.findFirst({
      where: { name: "Tour Leader Meals" },
      include: { rates: true },
    });
    expect(leader?.category).toBe("TOUR_LEADER");
    expect(leader?.rates[0]?.amount).toBe("0"); // legitimate zero, not missing
  });

  it("stores Georgia PAX bands as USD per-person rate versions", async () => {
    const vista = await prisma.serviceProduct.findFirst({
      where: { name: "Georgia 4N/5D — Vista hotel or similar (3★)" },
      include: { rates: true },
    });
    expect(vista).not.toBeNull();
    expect(vista?.rates.length).toBe(3);
    const pax4 = vista!.rates.find((r) => r.notes?.includes("paxBand: 4"));
    // Plan §3.6/§9: 4 PAX Vista 4-night = 216 USD PP
    expect(pax4?.amount).toBe("216");
    expect(pax4?.currency).toBe("USD");
    expect(pax4?.priority).toBe(2);
  });

  it("keeps template codes verbatim and records provenance", async () => {
    const typo = await prisma.packageTemplate.findUnique({
      where: { code: "ARMGG-S26-0506A" },
      include: { versions: true },
    });
    expect(typo).not.toBeNull();
    expect(typo?.versions[0]?.legacyMarkup).toBe("0.16");
    expect(typo?.versions[0]?.provenance).toContain("Mass Calculation row 109");
    expect(typo?.versions[0]?.provenance).toContain("Jermuk");

    const geo = await prisma.packageTemplate.findUnique({
      where: { code: "GEO-S26-0405A" },
      include: { versions: true },
    });
    // No C-cell duration in the workbook; derived from 5 itinerary days.
    expect(geo?.versions[0]?.nights).toBe(4);
    expect(geo?.versions[0]?.days).toBe(5);
    const days = JSON.parse(geo!.versions[0]!.daysJson);
    expect(days.length).toBe(5);
    expect(days[0].dayOffset).toBe(0);
  });

  it("seeds settings, legacy FX, inactive policy and demo users", async () => {
    const settings = await prisma.travelSettings.findUnique({ where: { id: "default" } });
    expect(settings?.companyTz).toBe("Asia/Yerevan");

    const fx = await prisma.fXRateVersion.findUnique({
      where: { currency_effectiveFrom: { currency: "USD", effectiveFrom: "2026-01-01" } },
    });
    expect(fx?.amdPerUnit).toBe("365");

    const policy = await prisma.pricingPolicyVersion.findFirst({
      where: { name: "Legacy workbook markup 14%" },
    });
    expect(policy?.type).toBe("MARKUP_ON_COST");
    expect(policy?.rate).toBe("0.14");
    expect(policy?.active).toBe(false); // admin must consciously activate
    expect(policy?.minProfit).toBeNull();

    const advisor = await prisma.user.findUnique({
      where: { email: "advisor1@wacontrol.local" },
    });
    expect(advisor?.role).toBe("ADVISOR");
    const validator = await prisma.user.findUnique({
      where: { email: "validator1@wacontrol.local" },
    });
    expect(validator?.role).toBe("VALIDATOR");
  });
});
