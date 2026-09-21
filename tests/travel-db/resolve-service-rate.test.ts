/**
 * Service rate resolution (Phase 2): a ServiceLine linked to a catalog
 * ServiceProduct (serviceProductId set, no hand-typed unitRate, no override)
 * is priced from the VERIFIED RateVersion(productType: SERVICE) band valid on
 * the line's date (or the request start date when not day-linked).
 *
 * Covered rules, mirroring the hotel path:
 * - validity bands are [validFrom, validTo) with open ends covering everything;
 * - the highest priority wins; an equal-priority tie is AMBIGUOUS_RATE;
 * - quoteOnRequest is a hard resolution blocker;
 * - a TBC winner (amount null) leaves unitRate null → engine MISSING_RATE;
 * - a manual overrideRate always beats the catalog;
 * - lines without serviceProductId behave exactly as before.
 *
 * Each test uses its OWN service product so rate rows never leak between cases.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { ensureSchema, getPrisma } from "./helpers";
import {
  actorOf,
  createRequestInput,
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

interface ServiceRateSpec {
  amount: string | null;
  currency?: string;
  validFrom?: string;
  validTo?: string;
  priority?: number;
  quoteOnRequest?: boolean;
  status?: string;
  vehicleTypeId?: string | null;
}

/** A fresh service product with the given VERIFIED rates. */
async function serviceWithRates(name: string, rates: ServiceRateSpec[]) {
  const product = await prisma.serviceProduct.create({
    data: { name, category: "TICKETS", basis: "GROUP" },
  });
  for (const r of rates) {
    await prisma.rateVersion.create({
      data: {
        productType: "SERVICE",
        serviceProductId: product.id,
        vehicleTypeId: r.vehicleTypeId ?? null,
        amount: r.amount,
        currency: r.currency ?? "USD",
        status: r.status ?? "VERIFIED",
        evidenceRef: `Test!SVC-${name}`,
        validFrom: r.validFrom ?? null,
        validTo: r.validTo ?? null,
        priority: r.priority ?? 0,
        quoteOnRequest: r.quoteOnRequest ?? false,
      },
    });
  }
  return product;
}

interface LineOpts {
  date?: string;
  unitRate?: string;
  overrideRate?: string;
  vehicleTypeId?: string;
}

/**
 * Draft version on the fixture hotel, with one service line created directly
 * (bypasses saveVersionContent so each case controls the exact line fields).
 */
async function draftWithServiceLine(serviceProductId: string | null, line: LineOpts = {}) {
  const { request, version } = await workflow.createRequest(
    actorOf(fx.advisor),
    createRequestInput(fx.agency.id),
  );
  await saveContent(
    prisma,
    actorOf(fx.advisor),
    request.id,
    version.id,
    scenarioContent(fx.hotel.id, fx.hotel.name),
  );
  await prisma.serviceLine.create({
    data: {
      versionId: version.id,
      category: "TICKETS",
      label: "Museum tickets",
      basis: "GROUP",
      currency: "AMD",
      unitRate: line.unitRate ?? null,
      quantity: "1",
      serviceProductId,
      date: line.date ?? null,
      vehicleTypeId: line.vehicleTypeId ?? null,
      overrideRate: line.overrideRate ?? null,
      overrideReason: line.overrideRate ? "negotiated group rate" : null,
      overrideById: line.overrideRate ? fx.advisor.id : null,
    },
  });
  return { request, version };
}

function blockerCodes(res: { issues: { code: string; severity: string }[] }) {
  return res.issues.filter((i) => i.severity === "BLOCKER").map((i) => i.code);
}

describe("service rate resolution", () => {
  it("prices a linked line from the band covering its date", async () => {
    const product = await serviceWithRates("Happy Path", [{ amount: "50" }]);
    const { version } = await draftWithServiceLine(product.id, { date: "2026-10-02" });

    const input = await resolve.buildEngineInputForVersion(version.id);
    const line = input.scenarios[0].services[0];
    expect(line.unitRate).toBe("50");
    expect(line.currency).toBe("USD");
    expect(line.sourceRef).toContain("RateVersion");

    const sc = engine.calculate(input).scenarios[0];
    expect(sc.valid).toBe(true);
    // GROUP basis: 50 × 1 occurrence.
    expect(sc.totals.byCategory.TICKETS.USD).toBe("50");
  });

  it("the highest-priority covering band wins", async () => {
    const product = await serviceWithRates("Priority", [
      { amount: "50" },
      { amount: "70", priority: 5 },
    ]);
    const { version } = await draftWithServiceLine(product.id, { date: "2026-10-02" });

    const input = await resolve.buildEngineInputForVersion(version.id);
    expect(input.scenarios[0].services[0].unitRate).toBe("70");
  });

  it("picks the band valid on the line's own date, not the tour start", async () => {
    const product = await serviceWithRates("Seasonal", [
      { amount: "40", validFrom: "2026-10-01", validTo: "2026-10-02" },
      { amount: "60", validFrom: "2026-10-02", validTo: "2026-10-03" },
    ]);
    const { version } = await draftWithServiceLine(product.id, { date: "2026-10-02" });

    const input = await resolve.buildEngineInputForVersion(version.id);
    // [from, to) is exclusive on the right: 2026-10-02 belongs to the 60 band.
    expect(input.scenarios[0].services[0].unitRate).toBe("60");
  });

  it("falls back to the request start date when the line has no date", async () => {
    const product = await serviceWithRates("No Date", [
      { amount: "40", validFrom: "2026-10-01", validTo: "2026-10-02" },
    ]);
    const { version } = await draftWithServiceLine(product.id);

    const input = await resolve.buildEngineInputForVersion(version.id);
    expect(input.scenarios[0].services[0].unitRate).toBe("40");
  });

  it("a TBC winner leaves the rate missing → engine MISSING_RATE blocker", async () => {
    const product = await serviceWithRates("TBC", [{ amount: null }]);
    const { version } = await draftWithServiceLine(product.id, { date: "2026-10-02" });

    const input = await resolve.buildEngineInputForVersion(version.id);
    expect(input.scenarios[0].services[0].unitRate).toBeNull();

    const sc = engine.calculate(input).scenarios[0];
    expect(blockerCodes(sc)).toContain("MISSING_RATE");
    expect(sc.valid).toBe(false);
  });

  it("a quote-on-request rate is a hard resolution blocker", async () => {
    const product = await serviceWithRates("QoR", [{ amount: "50", quoteOnRequest: true }]);
    const { version } = await draftWithServiceLine(product.id, { date: "2026-10-02" });

    await expect(resolve.buildEngineInputForVersion(version.id)).rejects.toMatchObject({
      code: "QUOTE_ON_REQUEST",
    });
  });

  it("overlapping equal-priority bands are ambiguous", async () => {
    const product = await serviceWithRates("Ambiguous", [{ amount: "50" }, { amount: "60" }]);
    const { version } = await draftWithServiceLine(product.id, { date: "2026-10-02" });

    await expect(resolve.buildEngineInputForVersion(version.id)).rejects.toMatchObject({
      code: "AMBIGUOUS_RATE",
    });
  });

  it("no band covering the date → engine MISSING_RATE blocker", async () => {
    const product = await serviceWithRates("Expired", [
      { amount: "50", validFrom: "2026-01-01", validTo: "2026-06-01" },
    ]);
    const { version } = await draftWithServiceLine(product.id, { date: "2026-10-02" });

    const input = await resolve.buildEngineInputForVersion(version.id);
    expect(input.scenarios[0].services[0].unitRate).toBeNull();

    const sc = engine.calculate(input).scenarios[0];
    expect(blockerCodes(sc)).toContain("MISSING_RATE");
    expect(sc.valid).toBe(false);
  });

  it("unverified (NEEDS_REVIEW) rates are not usable", async () => {
    const product = await serviceWithRates("Unverified", [{ amount: "50", status: "NEEDS_REVIEW" }]);
    const { version } = await draftWithServiceLine(product.id, { date: "2026-10-02" });

    const input = await resolve.buildEngineInputForVersion(version.id);
    expect(input.scenarios[0].services[0].unitRate).toBeNull();
    const sc = engine.calculate(input).scenarios[0];
    expect(blockerCodes(sc)).toContain("MISSING_RATE");
  });

  it("a manual override beats the catalog rate", async () => {
    const product = await serviceWithRates("Override", [{ amount: "50" }]);
    const { version } = await draftWithServiceLine(product.id, {
      date: "2026-10-02",
      overrideRate: "80",
    });

    const input = await resolve.buildEngineInputForVersion(version.id);
    const line = input.scenarios[0].services[0];
    expect(line.unitRate).toBe("80");
    expect(line.override).toMatchObject({ originalRate: null, actorId: fx.advisor.id });

    const sc = engine.calculate(input).scenarios[0];
    expect(sc.valid).toBe(true);
    expect(sc.totals.byCategory.TICKETS.AMD).toBe("80");
  });

  it("an override also wins over a quote-on-request band", async () => {
    const product = await serviceWithRates("QoR Override", [
      { amount: "50", quoteOnRequest: true },
    ]);
    const { version } = await draftWithServiceLine(product.id, {
      date: "2026-10-02",
      overrideRate: "80",
    });

    const input = await resolve.buildEngineInputForVersion(version.id);
    expect(input.scenarios[0].services[0].unitRate).toBe("80");
  });

  it("a hand-typed unitRate on a linked line is kept as-is", async () => {
    const product = await serviceWithRates("Typed", [{ amount: "50" }]);
    const { version } = await draftWithServiceLine(product.id, {
      date: "2026-10-02",
      unitRate: "30",
    });

    const input = await resolve.buildEngineInputForVersion(version.id);
    expect(input.scenarios[0].services[0].unitRate).toBe("30");
  });

  it("an unlinked line behaves exactly as before", async () => {
    const { version } = await draftWithServiceLine(null);

    const input = await resolve.buildEngineInputForVersion(version.id);
    const line = input.scenarios[0].services[0];
    expect(line.unitRate).toBeNull();

    const sc = engine.calculate(input).scenarios[0];
    expect(blockerCodes(sc)).toContain("MISSING_RATE");
    expect(sc.valid).toBe(false);
  });
});

describe("vehicle-scoped service rates", () => {
  let sedanId: string;
  let minivanId: string;

  beforeAll(async () => {
    const sedan = await prisma.vehicleType.create({ data: { name: "Test Sedan", seats: 3 } });
    const minivan = await prisma.vehicleType.create({ data: { name: "Test Minivan", seats: 5 } });
    sedanId = sedan.id;
    minivanId = minivan.id;
  });

  it("the vehicle-specific row wins for a line with that vehicle", async () => {
    const product = await serviceWithRates("Vehicle Match", [
      { amount: "50" }, // vehicle-agnostic base
      { amount: "60", vehicleTypeId: sedanId, priority: 1 },
      { amount: "80", vehicleTypeId: minivanId, priority: 1 },
    ]);
    const { version } = await draftWithServiceLine(product.id, {
      date: "2026-10-02",
      vehicleTypeId: sedanId,
    });

    const input = await resolve.buildEngineInputForVersion(version.id);
    const line = input.scenarios[0].services[0];
    expect(line.unitRate).toBe("60");
    expect(line.vehicleTypeId).toBe(sedanId);
  });

  it("the vehicle row wins even when the base row has higher priority", async () => {
    // Subset selection is by vehicle first; priority only ranks rows inside
    // the chosen subset.
    const product = await serviceWithRates("Vehicle Subset", [
      { amount: "50", priority: 5 },
      { amount: "60", vehicleTypeId: sedanId, priority: 1 },
    ]);
    const { version } = await draftWithServiceLine(product.id, {
      date: "2026-10-02",
      vehicleTypeId: sedanId,
    });

    const input = await resolve.buildEngineInputForVersion(version.id);
    expect(input.scenarios[0].services[0].unitRate).toBe("60");
  });

  it("falls back to the vehicle-agnostic base row when no vehicle row covers the date", async () => {
    const product = await serviceWithRates("Vehicle Fallback", [
      { amount: "50" },
      { amount: "60", vehicleTypeId: sedanId, priority: 1, validFrom: "2027-01-01", validTo: "2027-02-01" },
    ]);
    const { version } = await draftWithServiceLine(product.id, {
      date: "2026-10-02",
      vehicleTypeId: sedanId,
    });

    const input = await resolve.buildEngineInputForVersion(version.id);
    expect(input.scenarios[0].services[0].unitRate).toBe("50");
  });

  it("a line without a vehicle selection keeps the old behavior", async () => {
    const plain = await serviceWithRates("No Vehicle Plain", [{ amount: "50" }]);
    const { version: v1 } = await draftWithServiceLine(plain.id, { date: "2026-10-02" });
    const input1 = await resolve.buildEngineInputForVersion(v1.id);
    expect(input1.scenarios[0].services[0].unitRate).toBe("50");
    expect(input1.scenarios[0].services[0].vehicleTypeId).toBeUndefined();

    // Vehicle rows outrank the base row by priority, so a single vehicle row
    // wins for vehicle-less lines too (documented, intended).
    const withVehicle = await serviceWithRates("No Vehicle Row Wins", [
      { amount: "50" },
      { amount: "60", vehicleTypeId: sedanId, priority: 1 },
    ]);
    const { version: v2 } = await draftWithServiceLine(withVehicle.id, { date: "2026-10-02" });
    const input2 = await resolve.buildEngineInputForVersion(v2.id);
    expect(input2.scenarios[0].services[0].unitRate).toBe("60");
  });

  it("a TBC vehicle row blocks a vehicle-selected line — no silent fallback to the base rate", async () => {
    const product = await serviceWithRates("Vehicle TBC", [
      { amount: "50" },
      { amount: null, vehicleTypeId: sedanId, priority: 1 },
    ]);
    const { version } = await draftWithServiceLine(product.id, {
      date: "2026-10-02",
      vehicleTypeId: sedanId,
    });

    const input = await resolve.buildEngineInputForVersion(version.id);
    expect(input.scenarios[0].services[0].unitRate).toBeNull();

    const sc = engine.calculate(input).scenarios[0];
    expect(blockerCodes(sc)).toContain("MISSING_RATE");
    expect(sc.valid).toBe(false);
  });

  it("equal-priority rows within one vehicle bracket are ambiguous, across vehicles are not", async () => {
    const product = await serviceWithRates("Vehicle Ambiguity", [
      { amount: "50" },
      { amount: "60", vehicleTypeId: sedanId, priority: 1 },
      { amount: "70", vehicleTypeId: sedanId, priority: 1 },
      { amount: "80", vehicleTypeId: minivanId, priority: 1 },
    ]);
    const { version: amb } = await draftWithServiceLine(product.id, {
      date: "2026-10-02",
      vehicleTypeId: sedanId,
    });
    await expect(resolve.buildEngineInputForVersion(amb.id)).rejects.toMatchObject({
      code: "AMBIGUOUS_RATE",
    });

    // The minivan bracket has a single row — unaffected by the sedan tie.
    const { version: ok } = await draftWithServiceLine(product.id, {
      date: "2026-10-02",
      vehicleTypeId: minivanId,
    });
    const input = await resolve.buildEngineInputForVersion(ok.id);
    expect(input.scenarios[0].services[0].unitRate).toBe("80");
  });
});
