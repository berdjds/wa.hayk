/**
 * Extra-bed resolution rules (review fixes):
 * - EXTRA_BED catalog rows get the same stop-sale / quote-on-request hard
 *   blockers as room rates when the allocation requests extra beds;
 * - an extra-bed row attaches only to the rate periods its own validity
 *   window fully covers;
 * - a manual rate override carries the winning catalog period's extra-bed
 *   supplement (the override re-prices the room, not the supplement).
 *
 * Each test uses its OWN hotel so rate rows never leak between cases.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { ensureSchema, getPrisma } from "./helpers";
import {
  END_DATE,
  START_DATE,
  actorOf,
  createRequestInput,
  dblAllocation,
  saveContent,
  scenarioContent,
  seedFixtures,
  type Fixtures,
} from "../workflow/fixtures";

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => ({ providerId: "smtp-test" })) }));
vi.mock("@/lib/whatsapp", () => ({
  sendWhatsAppMessage: vi.fn(async () => ({ id: { _serialized: "wa-test" } })),
}));
vi.mock("@/lib/travel/pdf/render", () => ({
  renderQuotationPdf: vi.fn(async () => Buffer.from("%PDF-1.4 fake")),
}));

let prisma: PrismaClient;
let workflow: typeof import("@/lib/travel/workflow");
let resolve: typeof import("@/lib/travel/resolve");
let engine: typeof import("@/lib/travel/engine");
let fx: Fixtures;

beforeAll(async () => {
  ensureSchema();
  prisma = await getPrisma();
  workflow = await import("@/lib/travel/workflow");
  resolve = await import("@/lib/travel/resolve");
  engine = await import("@/lib/travel/engine");
  fx = await seedFixtures(prisma);
});

interface RateSpec {
  occupancy: "DBL" | "EXTRA_BED";
  amount: string | null;
  stopSales?: { from: string; to: string; reason?: string }[];
  quoteOnRequest?: boolean;
  validFrom?: string;
  validTo?: string;
}

/** A fresh hotel with the given VERIFIED USD rates. */
async function hotelWithRates(name: string, rates: RateSpec[]) {
  const hotel = await prisma.hotelProduct.create({
    data: {
      name,
      city: "Yerevan",
      capacityAdults: 2,
      capacityChildren: 1,
      capacityTotal: 3,
      extraBedAllowed: true,
    },
  });
  for (const r of rates) {
    await prisma.rateVersion.create({
      data: {
        productType: "HOTEL",
        hotelProductId: hotel.id,
        occupancy: r.occupancy,
        amount: r.amount,
        currency: "USD",
        status: "VERIFIED",
        evidenceRef: `Test!${r.occupancy}-${name}`,
        stopSales: r.stopSales ? JSON.stringify(r.stopSales) : null,
        quoteOnRequest: r.quoteOnRequest ?? false,
        validFrom: r.validFrom ?? null,
        validTo: r.validTo ?? null,
      },
    });
  }
  return hotel;
}

/** Draft version on the hotel, one DBL with 1 extra bed requested. */
async function draftWithExtraBed(hotel: { id: string; name: string }, withOverride = false) {
  const { request, version } = await workflow.createRequest(actorOf(fx.advisor), createRequestInput(fx.agency.id));
  const content = scenarioContent(hotel.id, hotel.name);
  content.scenarios[0].stays[0].allocations = [{ ...dblAllocation(), extraBeds: 1 }];
  if (withOverride) {
    (content.scenarios[0].stays[0] as any).rateOverrides = { DBL: { rate: "120", reason: "negotiated group rate" } };
  }
  await saveContent(prisma, actorOf(fx.advisor), request.id, version.id, content);
  return { request, version };
}

const DBL_RATE: RateSpec = { occupancy: "DBL", amount: "100" };

describe("extra-bed hard blockers", () => {
  it("a stop-sold extra-bed row blocks when extra beds are requested", async () => {
    const hotel = await hotelWithRates("EB StopSale Hotel", [
      DBL_RATE,
      { occupancy: "EXTRA_BED", amount: "10", stopSales: [{ from: "2026-10-02", to: "2026-10-03", reason: "renovation" }] },
    ]);
    const { version } = await draftWithExtraBed(hotel);
    await expect(resolve.buildEngineInputForVersion(version.id)).rejects.toMatchObject({
      code: "STOP_SALE",
    });
  });

  it("a quote-on-request extra-bed row blocks when extra beds are requested", async () => {
    const hotel = await hotelWithRates("EB QoR Hotel", [
      DBL_RATE,
      { occupancy: "EXTRA_BED", amount: "10", quoteOnRequest: true },
    ]);
    const { version } = await draftWithExtraBed(hotel);
    await expect(resolve.buildEngineInputForVersion(version.id)).rejects.toMatchObject({
      code: "QUOTE_ON_REQUEST",
    });
  });

  it("no extra beds requested → the same rows do not block", async () => {
    const hotel = await hotelWithRates("EB NoBeds Hotel", [
      DBL_RATE,
      {
        occupancy: "EXTRA_BED",
        amount: "10",
        stopSales: [{ from: START_DATE, to: END_DATE }],
        quoteOnRequest: true,
      },
    ]);
    const { request, version } = await workflow.createRequest(actorOf(fx.advisor), createRequestInput(fx.agency.id));
    await saveContent(prisma, actorOf(fx.advisor), request.id, version.id, scenarioContent(hotel.id, hotel.name));
    await expect(resolve.buildEngineInputForVersion(version.id)).resolves.toBeTruthy();
  });
});

describe("extra-bed attachment semantics", () => {
  it("a manual override keeps the winning catalog period's supplement", async () => {
    const hotel = await hotelWithRates("EB Override Hotel", [
      DBL_RATE,
      { occupancy: "EXTRA_BED", amount: "10" },
    ]);
    const { version } = await draftWithExtraBed(hotel, true);

    const input = await resolve.buildEngineInputForVersion(version.id);
    const periods = input.scenarios[0].stays[0].rates.DBL;
    const overridePeriod = periods.find((p) => p.sourceRef?.includes("manual override"))!;
    // The override re-prices the room (120) but inherits the supplement (10).
    expect(overridePeriod.rate).toBe("120");
    expect(overridePeriod.extraBedRate).toBe("10");

    const out = engine.calculate(input);
    const sc = out.scenarios[0];
    expect(sc.valid).toBe(true);
    // 3 nights × (120 room + 10 extra bed) = 390 USD.
    expect(sc.totals.byCategory.ACCOMMODATION.USD).toBe("390");
    expect(sc.nightly.every((n) => n.extraBedCharge === "10")).toBe(true);
  });

  it("an extra-bed row attaches only to periods its validity covers", async () => {
    const hotel = await hotelWithRates("EB Seasonal Hotel", [
      { occupancy: "DBL", amount: "100", validFrom: "2026-10-01", validTo: "2026-10-03" },
      { occupancy: "DBL", amount: "200", validFrom: "2026-10-03", validTo: "2026-10-04" },
      // The supplement exists only for the first season.
      { occupancy: "EXTRA_BED", amount: "10", validFrom: "2026-10-01", validTo: "2026-10-03" },
    ]);

    const { version } = await draftWithExtraBed(hotel);
    const input = await resolve.buildEngineInputForVersion(version.id);
    const periods = input.scenarios[0].stays[0].rates.DBL;
    const first = periods.find((p) => p.from === "2026-10-01")!;
    const second = periods.find((p) => p.from === "2026-10-03")!;
    expect(first.extraBedRate).toBe("10");
    expect(second.extraBedRate).toBeUndefined();

    const sc = engine.calculate(input).scenarios[0];
    expect(sc.valid).toBe(true);
    // (100+10) × 2 nights + 200 × 1 night = 420 USD.
    expect(sc.totals.byCategory.ACCOMMODATION.USD).toBe("420");
  });
});
