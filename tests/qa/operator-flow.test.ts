/**
 * QA: full operator flow (acceptance item 16) driven end-to-end through the
 * workflow layer against the seeded workbook catalog:
 *
 *   agency → advisor creates request → itinerary + TWO scenarios (one a
 *   multi-city stay Yerevan [1,3) → Dilijan [3,5) → Yerevan [5,6)) →
 *   calculate preview (both valid, different totals, never summed) →
 *   assign validator → submit → validator requests changes → advisor revises
 *   → resubmit → approve → issue → document hash == snapshot hash →
 *   accept a chosen scenario.
 *
 * Audit-log entries are asserted for every step. All senders/PDF are mocked.
 */

import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { ensureSchema, getPrisma } from "../travel-db/helpers";
import { TEST_DOCS_DIR, actorOf, saveContent, type Fixtures } from "../workflow/fixtures";

vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(async () => ({ providerId: "smtp-test" })),
}));
vi.mock("@/lib/whatsapp", () => ({
  sendWhatsAppMessage: vi.fn(async () => ({ id: { _serialized: "wa-test" } })),
}));
const FAKE_PDF = Buffer.from("%PDF-1.4 qa-operator-flow");
vi.mock("@/lib/travel/pdf/render", () => ({
  renderQuotationPdf: vi.fn(async () => FAKE_PDF),
}));

let prisma: PrismaClient;
let workflow: typeof import("@/lib/travel/workflow");
let resolve: typeof import("@/lib/travel/resolve");
let engine: typeof import("@/lib/travel/engine");

const START = "2026-10-01";
const END = "2026-10-06"; // 5 nights / 6 days

const TRAVELERS = {
  adults: 2,
  children: 0,
  infants: 0,
  paying: 2,
  complimentary: 0,
  leaders: 0,
  staff: 0,
};

const DBL = {
  roomType: "DBL",
  rooms: 1,
  adults: 2,
  children: 0,
  infants: 0,
  extraBeds: 0,
  capacityAdults: 2,
  capacityChildren: 1,
  capacityTotal: 3,
  extraBedAllowed: true,
  extraBedIncludedInRate: false,
  wholeUnit: false,
};

describe("operator flow: request → scenarios → review cycle → issue → accept", () => {
  it("runs the whole chain with audit entries and hash-bound issuance", async () => {
    ensureSchema();
    prisma = await getPrisma();
    workflow = await import("@/lib/travel/workflow");
    resolve = await import("@/lib/travel/resolve");
    engine = await import("@/lib/travel/engine");

    // --- Catalog: seed the workbook evidence into the throwaway DB ----------
    const { seedTravelCatalog } = await import("@/scripts/seed-travel-catalog");
    await seedTravelCatalog();
    await prisma.travelSettings.update({
      where: { id: "default" },
      data: { documentsDir: TEST_DOCS_DIR },
    });

    const cascade = await prisma.hotelProduct.findFirst({ where: { name: "3★ Cascade Hotel" } });
    const dilijan = await prisma.hotelProduct.findFirst({ where: { name: "4★ Dilijan Ani Forest Hills" } });
    expect(cascade).toBeTruthy();
    expect(dilijan).toBeTruthy();

    // Agency + people + an ACTIVATED policy (the seeded legacy one is inactive).
    const agency = await prisma.agency.create({
      data: { shortCode: "QAAG", name: "QA Agency", contactEmail: "ops@qaag.test" },
    });
    const advisor = await prisma.user.create({
      data: { email: "qa-advisor@test.io", name: "QA Advisor", password: "x", role: "ADVISOR", phone: "37410000001" },
    });
    const validator = await prisma.user.create({
      data: { email: "qa-validator@test.io", name: "QA Validator", password: "x", role: "VALIDATOR", phone: "37410000002" },
    });
    await prisma.pricingPolicyVersion.create({
      data: {
        name: "QA policy",
        type: "MARKUP_ON_COST",
        rate: "0.14",
        roundingIncrement: "1",
        quoteCurrency: "USD",
        active: true,
      },
    });
    // FX USD=365 effective 2026-01-01 is seeded from the workbook.

    const adv = actorOf(advisor as Fixtures["advisor"]);
    const val = actorOf(validator as Fixtures["validator"]);

    // --- Step 1: advisor creates the request --------------------------------
    const { request, version } = await workflow.createRequest(adv, {
      agencyId: agency.id,
      agencyRef: "AG-REF-1",
      title: "Armenia 5N multi-city",
      destinations: ["Yerevan", "Dilijan"],
      startDate: START,
      endDate: END,
      travelers: TRAVELERS,
    });
    expect(request.packageCode).toMatch(/^QAAG-\d{4}-\d{2}-\d{2}-0001$/);
    const packageCode = request.packageCode;

    // --- Step 2: itinerary + two scenarios (one multi-city 2+2+1) -----------
    await saveContent(prisma, adv, request.id, version.id, {
      scenarios: [
        {
          key: "MULTI",
          label: "Multi-city: Yerevan–Dilijan–Yerevan",
          stays: [
            { hotelProductId: cascade!.id, hotelName: cascade!.name, city: "Yerevan", checkIn: "2026-10-01", checkOut: "2026-10-03", allocations: [DBL] },
            { hotelProductId: dilijan!.id, hotelName: dilijan!.name, city: "Dilijan", checkIn: "2026-10-03", checkOut: "2026-10-05", allocations: [DBL] },
            { hotelProductId: cascade!.id, hotelName: cascade!.name, city: "Yerevan", checkIn: "2026-10-05", checkOut: "2026-10-06", allocations: [DBL] },
          ],
        },
        {
          key: "SINGLE",
          label: "Single hotel: Cascade only",
          stays: [
            { hotelProductId: cascade!.id, hotelName: cascade!.name, city: "Yerevan", checkIn: START, checkOut: END, allocations: [DBL] },
          ],
        },
      ],
      itineraryDays: Array.from({ length: 6 }, (_, i) => ({
        dayOffset: i,
        date: `2026-10-0${i + 1}`,
        narrative: `Day ${i + 1}`,
        overnightCity: i >= 2 && i <= 3 ? "Dilijan" : "Yerevan",
      })),
      serviceLines: [
        { scenarioKey: null, category: "TICKETS", label: "Garni temple", basis: "PER_PERSON", currency: "AMD", unitRate: "1500", quantity: "1", participants: 2, includedElsewhere: false, isStaffCost: false },
        { scenarioKey: null, category: "TICKETS", label: "Lavash baking", basis: "GROUP", currency: "AMD", unitRate: "10000", quantity: "1", includedElsewhere: false, isStaffCost: false },
      ],
    });

    // --- Step 3: preview calculation (what POST /versions/[id]/calculate does)
    const previewInput = await resolve.buildEngineInputForVersion(version.id);
    const preview = engine.calculate(previewInput);
    expect(preview.valid).toBe(true);
    expect(preview.scenarios).toHaveLength(2);
    const byLabel = new Map(preview.scenarios.map((s) => [s.label, s]));
    const multi = byLabel.get("Multi-city: Yerevan–Dilijan–Yerevan")!;
    const single = byLabel.get("Single hotel: Cascade only")!;
    expect(multi.valid).toBe(true);
    expect(single.valid).toBe(true);
    expect(multi.nights).toBe(5);
    expect(multi.days).toBe(6);

    // Multi-city accommodation: 2×27000 + 2×40000 + 1×27000 = 161000 AMD.
    expect(multi.totals.byCategory.ACCOMMODATION.AMD).toBe("161000");
    // Single-hotel accommodation: 5×27000 = 135000 AMD.
    expect(single.totals.byCategory.ACCOMMODATION.AMD).toBe("135000");
    // Shared services reach both scenarios: 2×1500 + 10000 = 13000 AMD.
    expect(multi.totals.byCategory.TICKETS.AMD).toBe("13000");
    expect(single.totals.byCategory.TICKETS.AMD).toBe("13000");
    // Scenarios are alternatives: different totals, never summed together.
    expect(multi.sell).not.toBe(single.sell);
    expect(multi.sell).toBe("544"); // (174000/365)×1.14 → roundUp1
    expect(single.sell).toBe("463"); // (148000/365)×1.14 → roundUp1

    // --- Step 4: assign validator --------------------------------------------
    await workflow.assignValidator(adv, request.id, { validatorId: validator.id });

    // --- Step 5: submit -------------------------------------------------------
    const sub1 = await workflow.submit(adv, request.id);
    expect(sub1.result.valid).toBe(true);

    // --- Step 6: validator requests changes -----------------------------------
    const chReq = await workflow.review(val, version.id, {
      action: "REQUEST_CHANGES",
      reason: "Add a guide for the Dilijan leg",
      snapshotHash: sub1.hash,
    });
    expect(chReq.status).toBe("CHANGES_REQUESTED");

    // --- Step 7: advisor revises (edit allowed in CHANGES_REQUESTED) ---------
    await saveContent(prisma, adv, request.id, version.id, {
      scenarios: [
        {
          key: "MULTI",
          label: "Multi-city: Yerevan–Dilijan–Yerevan",
          stays: [
            { hotelProductId: cascade!.id, hotelName: cascade!.name, city: "Yerevan", checkIn: "2026-10-01", checkOut: "2026-10-03", allocations: [DBL] },
            { hotelProductId: dilijan!.id, hotelName: dilijan!.name, city: "Dilijan", checkIn: "2026-10-03", checkOut: "2026-10-05", allocations: [DBL] },
            { hotelProductId: cascade!.id, hotelName: cascade!.name, city: "Yerevan", checkIn: "2026-10-05", checkOut: "2026-10-06", allocations: [DBL] },
          ],
        },
        {
          key: "SINGLE",
          label: "Single hotel: Cascade only",
          stays: [
            { hotelProductId: cascade!.id, hotelName: cascade!.name, city: "Yerevan", checkIn: START, checkOut: END, allocations: [DBL] },
          ],
        },
      ],
      serviceLines: [
        { scenarioKey: null, category: "TICKETS", label: "Garni temple", basis: "PER_PERSON", currency: "AMD", unitRate: "1500", quantity: "1", participants: 2, includedElsewhere: false, isStaffCost: false },
        { scenarioKey: null, category: "TICKETS", label: "Lavash baking", basis: "GROUP", currency: "AMD", unitRate: "10000", quantity: "1", includedElsewhere: false, isStaffCost: false },
        { scenarioKey: null, category: "GUIDES", label: "English guide, Dilijan day", basis: "GUIDE_DAY", currency: "AMD", unitRate: "30000", quantity: "1", includedElsewhere: false, isStaffCost: true },
      ],
    });
    // The old snapshot must be gone before resubmission.
    expect(await prisma.calculationSnapshot.findUnique({ where: { versionId: version.id } })).toBeNull();

    // --- Step 8: resubmit → new hash ------------------------------------------
    const sub2 = await workflow.submit(adv, request.id);
    expect(sub2.hash).not.toBe(sub1.hash);
    expect(await prisma.workflowEvent.count({ where: { requestId: request.id, type: "RESUBMITTED" } })).toBe(1);

    // --- Step 9: approve on the exact new snapshot ----------------------------
    const appr = await workflow.review(val, version.id, { action: "APPROVE", snapshotHash: sub2.hash });
    expect(appr.status).toBe("APPROVED");

    // --- Step 10: issue — document hash binds to the snapshot hash -----------
    const issued = await workflow.issue(adv, version.id, {});
    expect(issued.idempotent).toBe(false);
    const snapshot = await prisma.calculationSnapshot.findUnique({ where: { versionId: version.id } });
    expect(issued.document.snapshotHash).toBe(snapshot!.hash);
    expect(issued.document.snapshotHash).toBe(sub2.hash);
    expect(issued.document.sha256).toBe(createHash("sha256").update(FAKE_PDF).digest("hex"));
    const issuedVersion = await prisma.quoteVersion.findUnique({ where: { id: version.id } });
    expect(issuedVersion?.status).toBe("ISSUED");

    // --- Step 11: accept with the multi-city scenario -------------------------
    const multiScenario = await prisma.scenario.findFirst({
      where: { versionId: version.id, label: "Multi-city: Yerevan–Dilijan–Yerevan" },
    });
    const outcome = await workflow.recordOutcome(adv, version.id, {
      outcome: "ACCEPTED",
      scenarioId: multiScenario!.id,
    });
    expect(outcome.status).toBe("ACCEPTED");
    const accepted = await prisma.quoteVersion.findUnique({ where: { id: version.id } });
    expect(accepted?.outcomeScenarioId).toBe(multiScenario!.id);

    // --- Package code preserved across the whole chain ------------------------
    const finalRequest = await prisma.travelRequest.findUnique({ where: { id: request.id } });
    expect(finalRequest?.packageCode).toBe(packageCode);
    expect(finalRequest?.status).toBe("ACCEPTED");

    // --- Audit trail: one entry per step ---------------------------------------
    const logs = await prisma.log.findMany({
      where: { details: { contains: packageCode } },
      orderBy: { createdAt: "asc" },
    });
    const actions = logs.map((l) => l.action);
    expect(actions).toContain("REQUEST_CREATED");
    expect(actions).toContain("VALIDATOR_ASSIGNED");
    expect(actions.filter((a) => a === "QUOTE_CONTENT_SAVED").length).toBe(2);
    expect(actions.filter((a) => a === "QUOTE_SUBMITTED").length).toBe(2);
    expect(logs.some((l) => l.action === "QUOTE_SUBMITTED" && l.details?.startsWith("Resubmitted"))).toBe(true);
    expect(actions.filter((a) => a === "QUOTE_REVIEWED").length).toBe(2);
    expect(actions).toContain("QUOTE_ISSUED");
    expect(actions).toContain("QUOTE_OUTCOME_RECORDED");
  }, 60000);
});
