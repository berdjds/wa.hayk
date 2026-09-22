/**
 * Shared fixture for the PDF tests: a two-scenario quotation (alternatives,
 * never summed) with an EngineOutput-shaped snapshot. Money stays in decimal
 * strings, exactly as the engine produced it.
 */
import type {
  EngineInput,
  EngineOutput,
  ScenarioResult,
} from "@/lib/travel/contracts";
import {
  FX,
  POLICY,
  T,
  alloc,
  makeInput,
  makeScenario,
  makeService,
  makeStay,
} from "../engine/helpers";
import type { QuotationPdfBranding, QuotationPdfInput, QuotationPdfItineraryDay } from "@/lib/travel/pdf/types";

/** Company branding as frozen into displayJson at submit time. */
export const FIXTURE_BRANDING: QuotationPdfBranding = {
  companyName: "Nare Travel & Tours",
  companyPhone: "+374 10 530053",
  companyEmail: "info@naretravel.am",
  companyAddress: "15 Abovyan St, Yerevan, Armenia",
  companyWebsite: "www.naretravel.am",
  brandColor: "#0d4f8b",
};

/** Day-by-day itinerary as frozen into displayJson at submit time. */
export const FIXTURE_ITINERARY_DAYS: QuotationPdfItineraryDay[] = [
  {
    dayOffset: 0,
    date: "2026-10-01",
    narrative: "Arrival in Yerevan, transfer to the hotel and welcome dinner.",
    overnightCity: "Yerevan / Երևան",
    services: [
      { serviceProductId: null, label: "Airport transfer" },
      { serviceProductId: "svc-welcome-dinner", label: "Welcome dinner" },
    ],
  },
  {
    dayOffset: 1,
    date: "2026-10-02",
    narrative: "Full-day Yerevan city tour with a guide.",
    overnightCity: "Yerevan / Երևան",
    services: [{ serviceProductId: "svc-city-tour", label: "Yerevan city tour" }],
  },
  {
    dayOffset: 2,
    date: "2026-10-03",
    narrative: null,
    overnightCity: null,
    services: [],
  },
];

export const FIXTURE_SELL_A = "1679000.00";
export const FIXTURE_SELL_B = "1842500.00";
export const FIXTURE_SOURCEREF = "RateVersion clx-autumn-2026";
export const FIXTURE_NIGHTLY_RATE = "28500.75";

function buildInputs(): EngineInput {
  const travelers = T({ adults: 18, children: 4, infants: 1, paying: 22, leaders: 1, staff: 1 });

  const yerevanStay = makeStay({
    ref: "ST-YER",
    hotelName: "Grand Hotel Yerevan / Գրանդ Հյուրանոց",
    city: "Yerevan / Երևան",
    checkIn: "2026-10-01",
    checkOut: "2026-10-06",
    board: "BB (breakfast / նախաճաշ)",
    roomAllocations: [
      alloc({ roomType: "STANDARD", rooms: 8, adults: 16 }),
      alloc({ roomType: "TRIPLE", rooms: 2, adults: 4, children: 2, capacityAdults: 2, capacityChildren: 1, capacityTotal: 3 }),
    ],
    rates: {
      STANDARD: [
        { from: "2026-10-01", to: "2026-10-06", rate: FIXTURE_NIGHTLY_RATE, currency: "AMD", priority: 0, sourceRef: FIXTURE_SOURCEREF },
      ],
      TRIPLE: [
        { from: "2026-10-01", to: "2026-10-06", rate: "36500.00", currency: "AMD", priority: 0, sourceRef: FIXTURE_SOURCEREF },
      ],
    },
  });

  const scA = makeScenario({
    ref: "SC-A",
    label: "Yerevan City Stay",
    tourStart: "2026-10-01",
    tourEnd: "2026-10-06",
    travelers,
    stays: [yerevanStay],
    services: [
      makeService({ ref: "L-TRF", label: "Airport transfers (round trip)", category: "TRANSPORTATION", basis: "VEHICLE_TRIP", currency: "USD", unitRate: "60.00", quantity: "2", participants: 22 }),
      makeService({ ref: "L-GUIDE", label: "Yerevan city tour with guide", category: "GUIDES", basis: "GUIDE_DAY", currency: "AMD", unitRate: "30000.00", quantity: "5", isStaffCost: true }),
      makeService({ ref: "L-DINNER", label: "Welcome dinner", category: "GUEST_MEALS", basis: "PERSON_MEAL", currency: "AMD", unitRate: "4000.00", quantity: "1", participants: 22, includedElsewhere: true }),
      makeService({
        ref: "L-MUSEUM",
        label: "Museum entrance fees",
        category: "TICKETS",
        basis: "PER_PERSON",
        currency: "AMD",
        unitRate: "2500.00",
        quantity: "1",
        participants: 22,
        override: { originalRate: "3000.00", reason: "Group discount negotiated", actorId: "user-1" },
      }),
    ],
  });

  const scB = makeScenario({
    ref: "SC-B",
    label: "Yerevan–Dilijan Loop",
    tourStart: "2026-10-01",
    tourEnd: "2026-10-06",
    travelers,
    stays: [
      makeStay({ ...yerevanStay, ref: "ST-YER-1", checkIn: "2026-10-01", checkOut: "2026-10-03" }),
      makeStay({
        ref: "ST-DIL",
        hotelName: "Dilijan Forest Resort",
        city: "Dilijan / Դիլիջան",
        checkIn: "2026-10-03",
        checkOut: "2026-10-05",
        board: "HB",
        roomAllocations: [alloc({ roomType: "STANDARD", rooms: 10, adults: 20 })],
        rates: {
          STANDARD: [
            { from: "2026-10-03", to: "2026-10-05", rate: "31000.00", currency: "AMD", priority: 0, sourceRef: FIXTURE_SOURCEREF },
          ],
        },
      }),
      makeStay({ ...yerevanStay, ref: "ST-YER-2", checkIn: "2026-10-05", checkOut: "2026-10-06" }),
    ],
    services: scA.services,
  });

  return makeInput([scA, scB], {
    fx: FX({ rates: { USD: "385" }, quoteCurrency: "AMD" }),
    policy: POLICY({ type: "MARKUP_ON_COST", rate: "0.14", roundingIncrement: "1", minProfit: "150000", minProfitCurrency: "AMD" }),
  });
}

function scenarioResultA(): ScenarioResult {
  return {
    ref: "SC-A",
    label: "Yerevan City Stay",
    valid: true,
    issues: [
      { code: "UNUSED_BEDS", severity: "WARNING", scenarioRef: "SC-A", lineRef: "ST-YER", message: "2 bed(s) allocated but unused" },
    ],
    nights: 5,
    days: 6,
    totals: {
      byCategory: {
        ACCOMMODATION: { AMD: "1187500.00" },
        TRANSPORTATION: { USD: "120.00" },
        GUIDES: { AMD: "150000.00" },
        TICKETS: { AMD: "55000.00" },
        GUEST_MEALS: { AMD: "33000.00" },
      },
      costByCurrency: { AMD: "1425500.00", USD: "120.00" },
      costQuote: "1471700.00",
    },
    nightly: [
      { date: "2026-10-01", stayRef: "ST-YER", roomType: "STANDARD", rooms: 8, rate: FIXTURE_NIGHTLY_RATE, currency: "AMD", extraBeds: 0, extraBedCharge: "0", sourceRef: FIXTURE_SOURCEREF },
      { date: "2026-10-02", stayRef: "ST-YER", roomType: "STANDARD", rooms: 8, rate: FIXTURE_NIGHTLY_RATE, currency: "AMD", extraBeds: 0, extraBedCharge: "0", sourceRef: FIXTURE_SOURCEREF },
    ],
    policyTarget: "1678938.00",
    policyFloor: "1621700.00",
    unroundedSell: "1678874.00",
    roundingAdjustment: "126.00",
    sell: FIXTURE_SELL_A,
    profit: "207300.00",
    margin: "0.1235",
    perPayingPerson: "76318.18",
    lines: [],
    trace: [
      "Grand Hotel Yerevan / Գրանդ Հյուրանոց — STANDARD, 2026-10-01 → 2026-10-05 (5 nights): 8 rooms × 28,501 AMD/night = 1,140,030 AMD (RateVersion clx-autumn-2026)",
      "Grand Hotel Yerevan / Գրանդ Հյուրանոց — TRIPLE, 2026-10-01 → 2026-10-05 (5 nights): 2 rooms × 36,500 AMD/night = 365,000 AMD (RateVersion clx-autumn-2026)",
      "\"Airport transfers (round trip)\" [VEHICLE_TRIP]: 60 × 2 = 120 USD",
      "\"Yerevan city tour with guide\" [GUIDE_DAY]: 30,000 × 5 = 150,000 AMD",
      "\"Museum entrance fees\" [PER_PERSON]: 2,500 × 22 pax × 1 = 55,000 AMD",
      "\"Welcome dinner\": included elsewhere — charged 0",
      "fx: 1,425,500 AMD → 1,425,500 AMD (rate 1 AMD/AMD, quote rate 1)",
      "fx: 120 USD → 46,200 AMD (rate 385 AMD/USD, quote rate 1)",
      "policy MARKUP_ON_COST 0.14: target = 1,471,700 × 1.14 = 1,678,938",
      "policy floor: (1,471,700 + minProfit 150,000 AMD) = 1,621,700",
      "sell: unrounded 1,678,874 → sell 1,679,000 (rounding adjustment 126); profit 207,300",
    ],
  };
}

function scenarioResultB(): ScenarioResult {
  return {
    ref: "SC-B",
    label: "Yerevan–Dilijan Loop",
    valid: true,
    issues: [],
    nights: 5,
    days: 6,
    totals: {
      byCategory: {
        ACCOMMODATION: { AMD: "1310000.00" },
        TRANSPORTATION: { USD: "180.00" },
        GUIDES: { AMD: "150000.00" },
      },
      costByCurrency: { AMD: "1460000.00", USD: "180.00" },
      costQuote: "1529300.00",
    },
    nightly: [
      { date: "2026-10-03", stayRef: "ST-DIL", roomType: "STANDARD", rooms: 10, rate: "31000.00", currency: "AMD", extraBeds: 0, extraBedCharge: "0", sourceRef: FIXTURE_SOURCEREF },
    ],
    policyTarget: "1743402.00",
    policyFloor: "1679300.00",
    unroundedSell: "1742488.00",
    roundingAdjustment: "12.00",
    sell: FIXTURE_SELL_B,
    profit: "313200.00",
    margin: "0.1700",
    perPayingPerson: "83750.00",
    lines: [],
    trace: [
      "Grand Hotel Yerevan / Գրանդ Հյուրանոց — STANDARD, 2026-10-01 → 2026-10-02 (2 nights): 8 rooms × 28,501 AMD/night = 456,012 AMD (RateVersion clx-autumn-2026)",
      "Dilijan Forest Resort — STANDARD, 2026-10-03 → 2026-10-04 (2 nights): 10 rooms × 31,000 AMD/night = 620,000 AMD (RateVersion clx-autumn-2026)",
      "Grand Hotel Yerevan / Գրանդ Հյուրանոց — STANDARD, 2026-10-05 → 2026-10-05 (1 night): 8 rooms × 28,501 AMD/night = 228,006 AMD (RateVersion clx-autumn-2026)",
      "fx: 1,460,000 AMD → 1,460,000 AMD (rate 1 AMD/AMD, quote rate 1)",
      "fx: 180 USD → 69,300 AMD (rate 385 AMD/USD, quote rate 1)",
      "policy MARKUP_ON_COST 0.14: target = 1,529,300 × 1.14 = 1,743,402",
      "policy floor: (1,529,300 + minProfit 150,000 AMD) = 1,679,300",
      "sell: unrounded 1,742,488 → sell 1,842,500 (rounding adjustment 12); profit 313,200",
    ],
  };
}

export function makeFixture(overrides: Partial<QuotationPdfInput> = {}): QuotationPdfInput {
  const snapshot: EngineOutput = {
    valid: true,
    engineVersion: "1.0.0",
    scenarios: [scenarioResultA(), scenarioResultB()],
    issues: [
      { code: "UNUSED_BEDS", severity: "WARNING", scenarioRef: "SC-A", lineRef: "ST-YER", message: "2 bed(s) allocated but unused" },
    ],
  };
  return {
    snapshotHash: "abcdef0123456789deadbeef00112233445566778899aabbccddeeff0011",
    versionLabel: "v02",
    packageCode: "ACME-2026-09-21-0001",
    kind: "CLIENT",
    draft: false,
    agency: {
      name: "ACME Travel LLC",
      shortCode: "ACME",
      contactName: "Ani Sargsyan",
      contactEmail: "ani@acme-travel.am",
      contactPhone: "+374 10 000000",
    },
    request: {
      title: "Armenia Autumn Group Tour",
      startDate: "2026-10-01",
      endDate: "2026-10-06",
      agencyRef: "ACME-GRP-77",
      travelers: T({ adults: 18, children: 4, infants: 1, paying: 22, leaders: 1, staff: 1 }),
      destinations: ["Yerevan / Երևան", "Dilijan / Դիլիջան"],
    },
    issuedAt: "2026-09-21T09:00:00.000Z",
    validUntil: "2026-10-15",
    terms: "Rates are subject to availability at the time of booking.\nA 30% deposit is required to confirm services.",
    snapshot,
    inputs: buildInputs(),
    ...overrides,
  };
}
