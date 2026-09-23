import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { calculate, enumerateNights } from "@/lib/travel/engine";
import { COST_CATEGORIES, type PolicyInput } from "@/lib/travel/contracts";
import { FX, POLICY, T, alloc, makeInput, makeScenario, makeService, makeStay } from "./helpers";

function blockerCodes(res: { issues: { code: string; severity: string }[] }) {
  return res.issues.filter((i) => i.severity === "BLOCKER").map((i) => i.code);
}

describe("tour dates", () => {
  it("2026-10-01 → 2026-10-06 computes 5 nights / 6 days", () => {
    const sc = makeScenario({
      tourStart: "2026-10-01",
      tourEnd: "2026-10-06",
      selfArrangedNights: enumerateNights("2026-10-01", "2026-10-06").map((date) => ({
        date,
        reason: "client books own hotels",
      })),
    });
    const res = calculate(makeInput([sc])).scenarios[0];
    expect(res.nights).toBe(5);
    expect(res.days).toBe(6);
    expect(res.valid).toBe(true);
  });

  it("same-day tour is 1 day / 0 nights", () => {
    const res = calculate(makeInput([makeScenario()])).scenarios[0];
    expect(res.nights).toBe(0);
    expect(res.days).toBe(1);
    expect(res.valid).toBe(true);
  });

  it("a 12-night trip and a Dec→Jan year boundary compute correctly", () => {
    const mk = (tourStart: string, tourEnd: string) =>
      makeScenario({
        tourStart,
        tourEnd,
        selfArrangedNights: enumerateNights(tourStart, tourEnd).map((date) => ({
          date,
          reason: "self-arranged",
        })),
      });
    const [a, b] = calculate(makeInput([mk("2026-03-01", "2026-03-13"), mk("2026-12-30", "2027-01-02")])).scenarios;
    expect([a.nights, a.days]).toEqual([12, 13]);
    expect([b.nights, b.days]).toEqual([3, 4]);
    expect(a.valid && b.valid).toBe(true);
  });

  it("end < start → DATE_ORDER blocker", () => {
    const res = calculate(
      makeInput([makeScenario({ tourStart: "2026-10-06", tourEnd: "2026-10-01" })]),
    ).scenarios[0];
    expect(blockerCodes(res)).toContain("DATE_ORDER");
    expect(res.valid).toBe(false);
  });

  it("invalid calendar dates → INVALID_DATE blocker", () => {
    const res = calculate(
      makeInput([makeScenario({ tourStart: "2026-02-30", tourEnd: "2026-10-01" })]),
    ).scenarios[0];
    expect(blockerCodes(res)).toContain("INVALID_DATE");
    expect(res.valid).toBe(false);
  });
});

describe("nightly hotel expansion", () => {
  it("seasonal crossing: 2 rooms, [d1,d3)@28000 + [d3,d4)@32000 → 176000 AMD", () => {
    const stay = makeStay({
      checkIn: "2026-10-01",
      checkOut: "2026-10-04",
      roomAllocations: [alloc({ rooms: 2, adults: 4 })],
      rates: {
        STANDARD: [
          { from: "2026-10-01", to: "2026-10-03", rate: "28000", currency: "AMD", priority: 0, sourceRef: "RateVersion autumn" },
          { from: "2026-10-03", to: "2026-10-04", rate: "32000", currency: "AMD", priority: 0 },
        ],
      },
    });
    const sc = makeScenario({
      tourStart: "2026-10-01",
      tourEnd: "2026-10-04",
      travelers: T({ adults: 4, paying: 4 }),
      stays: [stay],
    });
    const res = calculate(makeInput([sc])).scenarios[0];
    expect(res.valid).toBe(true);
    // 2 rooms × 28000 × 2 nights + 2 rooms × 32000 × 1 night
    expect(res.totals.byCategory.ACCOMMODATION.AMD).toBe("176000");
    expect(res.nightly).toHaveLength(3);
    expect(res.nightly[2].rate).toBe("32000");
    // Consolidated trace (v0.13.2): one line per rate group, hotel name not ref,
    // comma-grouped money, evidence parenthetical without internal ids.
    expect(res.trace.some((t) => t.includes("Test Hotel — STANDARD, 2026-10-01 → 2026-10-02 (2 nights): 2 rooms × 28,000 AMD/night = 112,000 AMD (RateVersion autumn)"))).toBe(true);
    expect(res.trace.some((t) => t.includes("Test Hotel — STANDARD, 2026-10-03 → 2026-10-03 (1 night): 2 rooms × 32,000 AMD/night = 64,000 AMD"))).toBe(true);
    expect(res.trace.some((t) => t.includes("stay S1"))).toBe(false);
  });

  it("prices per night across a Dec→Jan season boundary", () => {
    const stay = makeStay({
      checkIn: "2026-12-30",
      checkOut: "2027-01-02",
      roomAllocations: [alloc()],
      rates: {
        STANDARD: [
          { from: "2026-12-30", to: "2027-01-01", rate: "28000", currency: "AMD", priority: 0 },
          { from: "2027-01-01", to: "2027-01-02", rate: "32000", currency: "AMD", priority: 0 },
        ],
      },
    });
    const sc = makeScenario({ tourStart: "2026-12-30", tourEnd: "2027-01-02", stays: [stay] });
    const res = calculate(makeInput([sc])).scenarios[0];
    expect(res.valid).toBe(true);
    expect(res.totals.byCategory.ACCOMMODATION.AMD).toBe("88000"); // 28000×2 + 32000
  });

  it("whole-unit cottage: 90000/night × 3 nights charged once per unit, not per bedroom", () => {
    const stay = makeStay({
      checkIn: "2026-10-01",
      checkOut: "2026-10-04",
      roomAllocations: [
        alloc({ roomType: "COTTAGE_2BR", rooms: 1, adults: 5, capacityAdults: 6, capacityTotal: 6, wholeUnit: true }),
      ],
      rates: {
        COTTAGE_2BR: [{ from: "2026-10-01", to: "2026-10-04", rate: "90000", currency: "AMD", priority: 0 }],
      },
    });
    const sc = makeScenario({
      tourStart: "2026-10-01",
      tourEnd: "2026-10-04",
      travelers: T({ adults: 5, paying: 5 }),
      stays: [stay],
    });
    const res = calculate(makeInput([sc])).scenarios[0];
    expect(res.valid).toBe(true);
    expect(res.totals.byCategory.ACCOMMODATION.AMD).toBe("270000");
  });

  it("extra beds add the supplement unless the rate already includes them (TPL)", () => {
    const tour = { tourStart: "2026-10-01", tourEnd: "2026-10-02" };
    const withBed = makeStay({
      checkIn: tour.tourStart,
      checkOut: tour.tourEnd,
      roomAllocations: [
        alloc({ roomType: "DBL", rooms: 2, adults: 5, capacityAdults: 2, capacityTotal: 3, extraBeds: 1, extraBedAllowed: true }),
      ],
      rates: { DBL: [{ from: "2026-10-01", to: "2026-10-02", rate: "30000", currency: "AMD", priority: 0, extraBedRate: "5000" }] },
    });
    const resBed = calculate(
      makeInput([makeScenario({ ...tour, travelers: T({ adults: 5, paying: 5 }), stays: [withBed] })]),
    ).scenarios[0];
    expect(resBed.valid).toBe(true);
    expect(resBed.totals.byCategory.ACCOMMODATION.AMD).toBe("65000"); // 2×30000 + 1×5000
    expect(resBed.nightly[0].extraBedCharge).toBe("5000");

    const tpl = makeStay({
      checkIn: tour.tourStart,
      checkOut: tour.tourEnd,
      roomAllocations: [
        alloc({ roomType: "TPL", rooms: 1, adults: 3, capacityAdults: 3, capacityTotal: 3, extraBeds: 1, extraBedAllowed: true, extraBedIncludedInRate: true }),
      ],
      rates: { TPL: [{ from: "2026-10-01", to: "2026-10-02", rate: "45000", currency: "AMD", priority: 0, extraBedRate: "8000" }] },
    });
    const resTpl = calculate(
      makeInput([makeScenario({ ...tour, travelers: T({ adults: 3, paying: 3 }), stays: [tpl] })]),
    ).scenarios[0];
    expect(resTpl.valid).toBe(true);
    expect(resTpl.totals.byCategory.ACCOMMODATION.AMD).toBe("45000"); // no double charge
    expect(resTpl.nightly[0].extraBedCharge).toBe("0");
  });

  it("null rate on a SELECTED room type blocks; on an unused one it does not; \"0\" is valid", () => {
    const stayWithNull = makeStay({
      roomAllocations: [alloc()],
      rates: { STANDARD: [{ from: "2026-10-01", to: "2026-10-02", rate: null, currency: "AMD", priority: 0 }] },
    });
    const resNull = calculate(
      makeInput([makeScenario({ tourStart: "2026-10-01", tourEnd: "2026-10-02", stays: [stayWithNull] })]),
    ).scenarios[0];
    expect(blockerCodes(resNull)).toContain("MISSING_RATE");
    expect(resNull.valid).toBe(false);
    // Missing rates must never leak into money fields.
    expect(resNull.totals.byCategory.ACCOMMODATION).toEqual({});
    expect(resNull.nightly).toEqual([]);

    const stayUnusedNull = makeStay({
      roomAllocations: [
        alloc(),
        alloc({ roomType: "SUITE", rooms: 0, adults: 0 }),
      ],
      rates: {
        STANDARD: [{ from: "2026-10-01", to: "2026-10-02", rate: "28000", currency: "AMD", priority: 0 }],
        SUITE: [{ from: "2026-10-01", to: "2026-10-02", rate: null, currency: "AMD", priority: 0 }],
      },
    });
    const resUnused = calculate(
      makeInput([makeScenario({ tourStart: "2026-10-01", tourEnd: "2026-10-02", stays: [stayUnusedNull] })]),
    ).scenarios[0];
    expect(blockerCodes(resUnused)).not.toContain("MISSING_RATE");
    expect(resUnused.valid).toBe(true);

    const stayZero = makeStay({
      roomAllocations: [alloc()],
      rates: { STANDARD: [{ from: "2026-10-01", to: "2026-10-02", rate: "0", currency: "AMD", priority: 0 }] },
    });
    const resZero = calculate(
      makeInput([makeScenario({ tourStart: "2026-10-01", tourEnd: "2026-10-02", stays: [stayZero] })]),
    ).scenarios[0];
    expect(resZero.valid).toBe(true);
    expect(resZero.totals.byCategory.ACCOMMODATION.AMD).toBe("0");
  });

  it("equal-priority overlapping periods on the same night → AMBIGUOUS_RATE; higher priority wins", () => {
    const ambiguous = makeStay({
      roomAllocations: [alloc()],
      rates: {
        STANDARD: [
          { from: "2026-10-01", to: "2026-10-02", rate: "28000", currency: "AMD", priority: 1 },
          { from: "2026-10-01", to: "2026-10-02", rate: "30000", currency: "AMD", priority: 1 },
        ],
      },
    });
    const resAmb = calculate(
      makeInput([makeScenario({ tourStart: "2026-10-01", tourEnd: "2026-10-02", stays: [ambiguous] })]),
    ).scenarios[0];
    expect(blockerCodes(resAmb)).toContain("AMBIGUOUS_RATE");

    const prioritized = makeStay({
      roomAllocations: [alloc()],
      rates: {
        STANDARD: [
          { from: "2026-10-01", to: "2026-10-02", rate: "28000", currency: "AMD", priority: 1 },
          { from: "2026-10-01", to: "2026-10-02", rate: "30000", currency: "AMD", priority: 2 },
        ],
      },
    });
    const resPri = calculate(
      makeInput([makeScenario({ tourStart: "2026-10-01", tourEnd: "2026-10-02", stays: [prioritized] })]),
    ).scenarios[0];
    expect(resPri.valid).toBe(true);
    expect(resPri.nightly[0].rate).toBe("30000");
    expect(resPri.totals.byCategory.ACCOMMODATION.AMD).toBe("30000");
  });
});

describe("night coverage", () => {
  const coveredStay = makeStay({
    roomAllocations: [alloc()],
    rates: { STANDARD: [{ from: "2026-10-01", to: "2026-10-03", rate: "28000", currency: "AMD", priority: 0 }] },
  });

  it("uncovered tour night → NIGHT_GAP", () => {
    const stay = { ...coveredStay, checkIn: "2026-10-01", checkOut: "2026-10-02" };
    const res = calculate(
      makeInput([makeScenario({ tourStart: "2026-10-01", tourEnd: "2026-10-03", stays: [stay] })]),
    ).scenarios[0];
    expect(blockerCodes(res)).toContain("NIGHT_GAP");
  });

  it("two stays on the same night → NIGHT_OVERLAP", () => {
    const a = { ...coveredStay, ref: "S1", checkIn: "2026-10-01", checkOut: "2026-10-02" };
    const b = { ...coveredStay, ref: "S2", checkIn: "2026-10-01", checkOut: "2026-10-02" };
    const res = calculate(
      makeInput([makeScenario({ tourStart: "2026-10-01", tourEnd: "2026-10-02", stays: [a, b] })]),
    ).scenarios[0];
    expect(blockerCodes(res)).toContain("NIGHT_OVERLAP");
  });

  it("stay nights outside the tour → OUT_OF_TOUR_STAY", () => {
    const stay = { ...coveredStay, checkIn: "2026-10-02", checkOut: "2026-10-05" };
    const res = calculate(
      makeInput([makeScenario({ tourStart: "2026-10-01", tourEnd: "2026-10-03", stays: [stay] })]),
    ).scenarios[0];
    expect(blockerCodes(res)).toContain("OUT_OF_TOUR_STAY");
  });

  it("self-arranged nights need a non-empty reason", () => {
    const withReason = calculate(
      makeInput([
        makeScenario({
          tourStart: "2026-10-01",
          tourEnd: "2026-10-02",
          selfArrangedNights: [{ date: "2026-10-01", reason: "client's own booking" }],
        }),
      ]),
    ).scenarios[0];
    expect(withReason.valid).toBe(true);

    const noReason = calculate(
      makeInput([
        makeScenario({
          tourStart: "2026-10-01",
          tourEnd: "2026-10-02",
          selfArrangedNights: [{ date: "2026-10-01", reason: "  " }],
        }),
      ]),
    ).scenarios[0];
    expect(blockerCodes(noReason)).toContain("SELF_ARRANGED_NO_REASON");
  });
});

describe("service lines", () => {
  it("PER_PERSON tickets: 4 participants × 1500 AMD = 6000", () => {
    const sc = makeScenario({
      services: [makeService({ category: "TICKETS", basis: "PER_PERSON", unitRate: "1500", participants: 4 })],
    });
    const res = calculate(makeInput([sc])).scenarios[0];
    expect(res.valid).toBe(true);
    expect(res.totals.byCategory.TICKETS.AMD).toBe("6000");
  });

  it("GROUP Lavash 10000 is charged once at any PAX", () => {
    const sc = makeScenario({
      travelers: T({ paying: 9 }),
      services: [makeService({ category: "EXTRA_SERVICES", basis: "GROUP", unitRate: "10000", participants: 9, label: "Lavash baking" })],
    });
    const res = calculate(makeInput([sc])).scenarios[0];
    expect(res.totals.byCategory.EXTRA_SERVICES.AMD).toBe("10000");
  });

  it("CAPACITY_BLOCK jeeps: 7 pax, capacity 3, 20000/unit → 3 units = 60000", () => {
    const sc = makeScenario({
      services: [makeService({ category: "TRANSPORTATION", basis: "CAPACITY_BLOCK", unitRate: "20000", participants: 7, capacity: 3 })],
    });
    const res = calculate(makeInput([sc])).scenarios[0];
    expect(res.totals.byCategory.TRANSPORTATION.AMD).toBe("60000");
  });

  it("CAPACITY_BLOCK without capacity → INVALID_POLICY blocker", () => {
    const sc = makeScenario({
      services: [makeService({ basis: "CAPACITY_BLOCK", unitRate: "20000", participants: 7 })],
    });
    const res = calculate(makeInput([sc])).scenarios[0];
    expect(blockerCodes(res)).toContain("INVALID_POLICY");
  });

  it("CAPACITY_BLOCK tickets: Chir's House 5 pax fits one group of 5 → 10000", () => {
    const sc = makeScenario({
      services: [makeService({ category: "TICKETS", basis: "CAPACITY_BLOCK", unitRate: "10000", participants: 5, capacity: 5, label: "Chir's House" })],
    });
    const res = calculate(makeInput([sc])).scenarios[0];
    expect(res.valid).toBe(true);
    expect(res.totals.byCategory.TICKETS.AMD).toBe("10000");
  });

  it("CAPACITY_BLOCK tickets: Lavash 12 pax, capacity 10 → 2 groups = 20000", () => {
    const sc = makeScenario({
      services: [makeService({ category: "TICKETS", basis: "CAPACITY_BLOCK", unitRate: "10000", participants: 12, capacity: 10, label: "Lavash Baking" })],
    });
    const res = calculate(makeInput([sc])).scenarios[0];
    expect(res.totals.byCategory.TICKETS.AMD).toBe("20000");
  });

  it("CAPACITY_BLOCK tickets: Chir's House 12 pax, capacity 5 → 3 groups = 30000", () => {
    const sc = makeScenario({
      services: [makeService({ category: "TICKETS", basis: "CAPACITY_BLOCK", unitRate: "10000", participants: 12, capacity: 5, label: "Chir's House" })],
    });
    const res = calculate(makeInput([sc])).scenarios[0];
    expect(res.totals.byCategory.TICKETS.AMD).toBe("30000");
  });

  it("CAPACITY_BLOCK tickets: participants omitted falls back to travelers.paying", () => {
    const sc = makeScenario({
      travelers: T({ adults: 9, children: 3, paying: 12 }),
      services: [makeService({ category: "TICKETS", basis: "CAPACITY_BLOCK", unitRate: "10000", capacity: 5, label: "Chir's House" })],
    });
    const res = calculate(makeInput([sc])).scenarios[0];
    expect(res.totals.byCategory.TICKETS.AMD).toBe("30000");
  });

  it("staff costs are never multiplied by guest PAX (guide day 30000 × 3 = 90000)", () => {
    const sc = makeScenario({
      travelers: T({ paying: 12 }),
      services: [
        makeService({ category: "GUIDES", basis: "GUIDE_DAY", unitRate: "30000", quantity: "3", isStaffCost: true, label: "Guide" }),
      ],
    });
    const res = calculate(makeInput([sc])).scenarios[0];
    expect(res.totals.byCategory.GUIDES.AMD).toBe("90000");
  });

  it("includedElsewhere lines charge 0 and are traced, even without a rate", () => {
    const sc = makeScenario({
      services: [makeService({ unitRate: null, includedElsewhere: true, label: "Breakfast (in board)" })],
    });
    const res = calculate(makeInput([sc])).scenarios[0];
    expect(res.valid).toBe(true);
    expect(res.totals.costQuote).toBe("0");
    expect(res.trace.some((t) => t.includes("included elsewhere"))).toBe(true);
  });

  it("null unitRate on a selected line → MISSING_RATE blocker", () => {
    const sc = makeScenario({ services: [makeService({ unitRate: null })] });
    const res = calculate(makeInput([sc])).scenarios[0];
    expect(blockerCodes(res)).toContain("MISSING_RATE");
    expect(res.valid).toBe(false);
  });

  it("every cost category appears in byCategory", () => {
    const sc = makeScenario({
      services: COST_CATEGORIES.map((category, i) =>
        makeService({ ref: `L${i}`, category, basis: "GROUP", unitRate: "100" }),
      ),
    });
    const res = calculate(makeInput([sc])).scenarios[0];
    for (const c of COST_CATEGORIES) {
      expect(res.totals.byCategory).toHaveProperty(c);
      expect(res.totals.byCategory[c].AMD).toBe("100");
    }
    // …and they exist even on an empty scenario.
    const empty = calculate(makeInput([makeScenario()])).scenarios[0];
    for (const c of COST_CATEGORIES) expect(empty.totals.byCategory).toHaveProperty(c);
  });
});

describe("vehicle checks", () => {
  it("6 guests + 1 guide = 7 seats > 6 seats × 1 vehicle → CAPACITY_EXCEEDED", () => {
    const sc = makeScenario({
      vehicleChecks: [{ ref: "V1", label: "Minivan", passengerSeats: 6, vehicles: 1, requiredSeats: 7 }],
    });
    const res = calculate(makeInput([sc])).scenarios[0];
    expect(blockerCodes(res)).toContain("CAPACITY_EXCEEDED");
    expect(res.valid).toBe(false);
  });

  it("2 vehicles pass", () => {
    const sc = makeScenario({
      vehicleChecks: [{ ref: "V1", label: "Minivan", passengerSeats: 6, vehicles: 2, requiredSeats: 7 }],
    });
    const res = calculate(makeInput([sc])).scenarios[0];
    expect(res.valid).toBe(true);
  });
});

describe("FX and multi-currency totals", () => {
  it("Georgia band: PER_PERSON USD 216 × 4 = 864 USD", () => {
    const sc = makeScenario({
      services: [makeService({ category: "EXTRA_SERVICES", basis: "PER_PERSON", currency: "USD", unitRate: "216", participants: 4, label: "Georgia band PP" })],
    });
    const res = calculate(makeInput([sc], { fx: FX({ quoteCurrency: "USD" }) })).scenarios[0];
    expect(res.totals.byCategory.EXTRA_SERVICES.USD).toBe("864");
  });

  it("mixed currencies: 365000 AMD + 864 USD, fx {USD: 365}, quote USD → costQuote 1864", () => {
    const sc = makeScenario({
      services: [
        makeService({ ref: "AMD-LEG", category: "OTHER", basis: "GROUP", currency: "AMD", unitRate: "365000" }),
        makeService({ ref: "USD-LEG", category: "EXTRA_SERVICES", basis: "PER_PERSON", currency: "USD", unitRate: "216", participants: 4 }),
      ],
    });
    const res = calculate(makeInput([sc], { fx: FX({ quoteCurrency: "USD" }) })).scenarios[0];
    expect(res.valid).toBe(true);
    // AMD leg converts to 1000 USD; the USD leg is identity — never double-converted.
    expect(res.totals.costByCurrency.AMD).toBe("1000");
    expect(res.totals.costByCurrency.USD).toBe("864");
    expect(res.totals.costQuote).toBe("1864");
  });

  it("missing FX rate for a used currency → MISSING_FX blocker", () => {
    const sc = makeScenario({ services: [makeService({ currency: "EUR", unitRate: "100" })] });
    const res = calculate(makeInput([sc])).scenarios[0];
    expect(blockerCodes(res)).toContain("MISSING_FX");
    expect(res.valid).toBe(false);
  });

  it("FX rate of \"0\" or negative → INVALID_FX blocker", () => {
    const sc = makeScenario({ services: [makeService({ currency: "USD", unitRate: "100" })] });
    const zero = calculate(makeInput([sc], { fx: FX({ rates: { USD: "0" }, quoteCurrency: "USD" }) })).scenarios[0];
    expect(blockerCodes(zero)).toContain("INVALID_FX");
    const negative = calculate(makeInput([sc], { fx: FX({ rates: { USD: "-5" }, quoteCurrency: "USD" }) })).scenarios[0];
    expect(blockerCodes(negative)).toContain("INVALID_FX");
  });
});

describe("scenario isolation and output shape", () => {
  it("one invalid scenario does not corrupt a valid sibling; output.valid=false", () => {
    const badStay = makeStay({
      roomAllocations: [alloc()],
      rates: { STANDARD: [{ from: "2026-10-01", to: "2026-10-02", rate: null, currency: "AMD", priority: 0 }] },
    });
    const bad = makeScenario({ ref: "BAD", tourStart: "2026-10-01", tourEnd: "2026-10-02", stays: [badStay] });
    const good = makeScenario({ ref: "GOOD", services: [makeService({ unitRate: "5000" })] });
    const out = calculate(makeInput([bad, good]));
    expect(out.valid).toBe(false);
    const [badRes, goodRes] = out.scenarios;
    expect(badRes.valid).toBe(false);
    expect(goodRes.valid).toBe(true);
    expect(goodRes.totals.costQuote).toBe("5000");
    expect(out.engineVersion).toBe("1.0.0");
  });
});

describe("pricing policy (engine level)", () => {
  // adults 4 → floorTravelers (adults + children − infants, v0.15.1) = 4.
  const usdInput = (policy: PolicyInput, services = [makeService({ currency: "USD", basis: "GROUP", unitRate: "1000" })]) =>
    makeInput([makeScenario({ travelers: T({ adults: 4, paying: 4 }), services })], {
      fx: FX({ quoteCurrency: "USD" }),
      policy,
    });

  it("cost 1000 USD, MARKUP 0.14, minProfit 200/traveler, 1 traveler → sell 1200, profit 200 (legacy flat-floor case)", () => {
    const res = calculate(
      makeInput([makeScenario({ travelers: T({ adults: 1, paying: 1 }), services: [makeService({ currency: "USD", basis: "GROUP", unitRate: "1000" })] })], {
        fx: FX({ quoteCurrency: "USD" }),
        policy: POLICY({ minProfit: "200", minProfitCurrency: "USD" }),
      }),
    ).scenarios[0];
    expect(res.valid).toBe(true);
    expect(res.policyTarget).toBe("1140");
    expect(res.policyFloor).toBe("1200");
    expect(res.unroundedSell).toBe("1200");
    expect(res.sell).toBe("1200");
    expect(res.roundingAdjustment).toBe("0");
    expect(res.profit).toBe("200");
    expect(Number(res.margin)).toBeCloseTo(0.16667, 4);
    expect(res.perPayingPerson).toBe("1200");
  });

  it("cost 1000 USD, minProfit 200/traveler × 4 travelers → floor 1800 beats target, profit 800 (v0.14.0)", () => {
    const res = calculate(
      usdInput(POLICY({ minProfit: "200", minProfitCurrency: "USD" })),
    ).scenarios[0];
    expect(res.valid).toBe(true);
    expect(res.policyTarget).toBe("1140");
    expect(res.policyFloor).toBe("1800"); // 1000 + 4 × 200
    expect(res.unroundedSell).toBe("1800");
    expect(res.sell).toBe("1800");
    expect(res.roundingAdjustment).toBe("0");
    expect(res.profit).toBe("800");
    expect(Number(res.margin)).toBeCloseTo(0.44444, 4);
    expect(res.perPayingPerson).toBe("450");
  });

  it("v0.15.1: floor multiplier is travelers excl. infants — 2 adults + 2 children − 1 infant → × 3", () => {
    const res = calculate(
      makeInput(
        [
          makeScenario({
            // infants is the childAges ≤ infantMaxAge subset of children.
            travelers: T({ adults: 2, children: 2, infants: 1, paying: 3 }),
            services: [makeService({ currency: "USD", basis: "GROUP", unitRate: "1000" })],
          }),
        ],
        {
          fx: FX({ quoteCurrency: "USD" }),
          policy: POLICY({ minProfit: "200", minProfitCurrency: "USD" }),
        },
      ),
    ).scenarios[0];
    expect(res.valid).toBe(true);
    expect(res.policyFloor).toBe("1600"); // 1000 + 3 × 200
    expect(res.sell).toBe("1600");
    expect(res.trace.some((t) => t.includes("(3 travelers × 200 USD) + 1,000"))).toBe(true);
  });

  it("v0.15.1: infants > children (manual override) clamps the multiplier to 0 → floor = bare cost", () => {
    const res = calculate(
      makeInput(
        [
          makeScenario({
            travelers: T({ adults: 0, children: 1, infants: 2, paying: 0 }),
            services: [makeService({ currency: "USD", basis: "GROUP", unitRate: "1000" })],
          }),
        ],
        {
          fx: FX({ quoteCurrency: "USD" }),
          policy: POLICY({ type: "MARKUP_ON_COST", rate: undefined, minProfit: "200", minProfitCurrency: "USD" }),
        },
      ),
    ).scenarios[0];
    expect(res.policyFloor).toBe("1000");
    expect(res.sell).toBe("1000");
    expect(res.trace.some((t) => t.includes("(0 travelers × 200 USD) + 1,000"))).toBe(true);
  });

  it("cost 1000 USD, GROSS_MARGIN_ON_SALES 0.14, no floor → sell 1163, profit 163", () => {
    const res = calculate(usdInput(POLICY({ type: "GROSS_MARGIN_ON_SALES" }))).scenarios[0];
    expect(res.valid).toBe(true);
    expect(Number(res.unroundedSell)).toBeCloseTo(1162.7906976744, 6);
    expect(res.sell).toBe("1163");
    expect(res.profit).toBe("163");
  });

  it("feeFraction 0.05 with floor 200/traveler × 4 travelers → unrounded 1894.736…, sell 1895 still ≥ floor, profit nets the fee", () => {
    const res = calculate(
      usdInput({ type: "MARKUP_ON_COST", minProfit: "200", minProfitCurrency: "USD", feeFraction: "0.05", roundingIncrement: "1" }),
    ).scenarios[0];
    expect(res.valid).toBe(true);
    // (1000 + 4 × 200) / 0.95 = 1894.7368…
    expect(Number(res.policyFloor)).toBeCloseTo(1894.7368421053, 8);
    expect(res.unroundedSell).toBe(res.policyFloor);
    expect(res.sell).toBe("1895");
    expect(Number(res.sell)).toBeGreaterThanOrEqual(Number(res.policyFloor));
    expect(res.profit).toBe("800.25"); // 1895 − 1000 − 1895×0.05
  });

  it("rounding increment \"0.5\" rounds up to the nearest half unit", () => {
    const res = calculate(
      usdInput({ type: "MARKUP_ON_COST", minProfit: "200", minProfitCurrency: "USD", feeFraction: "0.05", roundingIncrement: "0.5" }),
    ).scenarios[0];
    expect(res.sell).toBe("1895");
    expect(Number(res.sell)).toBeGreaterThanOrEqual(Number(res.policyFloor));
  });

  it("no rate and no floor → MISSING_POLICY blocker", () => {
    const res = calculate(usdInput({ type: "MARKUP_ON_COST", roundingIncrement: "1" })).scenarios[0];
    expect(blockerCodes(res)).toContain("MISSING_POLICY");
  });

  it("GROSS_MARGIN rate outside [0,1) → INVALID_POLICY", () => {
    const res = calculate(usdInput(POLICY({ type: "GROSS_MARGIN_ON_SALES", rate: "1.2" }))).scenarios[0];
    expect(blockerCodes(res)).toContain("INVALID_POLICY");
  });

  it("fee + margin making the denominator non-positive → INVALID_DENOMINATOR", () => {
    const res = calculate(
      usdInput({ type: "GROSS_MARGIN_ON_SALES", rate: "0.14", feeFraction: "0.95", roundingIncrement: "1" }),
    ).scenarios[0];
    expect(blockerCodes(res)).toContain("INVALID_DENOMINATOR");
  });

  it("perPayingPerson is null when paying = 0", () => {
    const out = calculate(
      makeInput([makeScenario({ travelers: T({ paying: 0 }), services: [makeService()] })]),
    ).scenarios[0];
    expect(out.perPayingPerson).toBeNull();
  });
});

describe("legacy Cascade rounding fixture", () => {
  /**
   * The legacy workbook computed the sell price in two rounding steps:
   * ROUNDUP(cost/fx) to whole USD, then ROUNDUP(that × markup) for the fee.
   * The engine instead computes cost/fx × (1+markup) exactly and rounds UP
   * once at the end. The methods are NOT equivalent in general — the legacy
   * intermediate ROUNDUP inflates the base the markup is applied to:
   *   cost 310000 AMD: legacy 969 vs engine 969 (coincide on this fixture)
   *   cost 300000 AMD: legacy 938 vs engine 937 (legacy overcharges by 1)
   * The engine's single-shot rounding is the intended behavior going forward.
   *
   * The fixture uses Decimal on purpose: Excel's ROUNDUP(850*0.14) sees 119
   * exactly, while binary floats produce 119.00000000000001 and would ceil to
   * 120 — a float artifact, not the legacy behavior.
   */
  function legacyCascadeSell(costAmd: string, fxUsd: string, markup: string): number {
    const costUsd = new Decimal(costAmd).div(fxUsd).ceil();
    const fee = costUsd.times(markup).ceil();
    return costUsd.plus(fee).toNumber();
  }

  const engineSell = (costAmd: string) =>
    calculate(
      makeInput([makeScenario({ services: [makeService({ unitRate: costAmd })] })], {
        fx: FX({ quoteCurrency: "USD" }),
        policy: POLICY(),
      }),
    ).scenarios[0].sell;

  it("cost 310000 AMD, fx USD=365, markup 0.14 → engine sell 969 (matches legacy here)", () => {
    expect(legacyCascadeSell("310000", "365", "0.14")).toBe(969);
    // 310000/365 = 849.315…; × 1.14 = 968.219…; ceil → 969
    expect(engineSell("310000")).toBe("969");
  });

  it("documents the intentional difference: cost 300000 AMD → legacy 938, engine 937", () => {
    expect(legacyCascadeSell("300000", "365", "0.14")).toBe(938);
    expect(engineSell("300000")).toBe("937");
  });
});

// ---------------------------------------------------------------------------

describe("per-line net cost output (v0.11.0)", () => {
  const usdQuote = { fx: FX({ quoteCurrency: "USD" }) };

  it("PER_PERSON: rate × pax × quantity, converted to AMD and quote currency", () => {
    const res = calculate(
      makeInput(
        [
          makeScenario({
            travelers: T({ paying: 2 }),
            services: [
              makeService({
                ref: "L-TICKET",
                label: "Garni ticket",
                category: "TICKETS",
                basis: "PER_PERSON",
                currency: "USD",
                unitRate: "100",
                quantity: "3",
                serviceProductId: "sp-1",
                date: "2026-10-01",
                vehicleTypeId: "veh-1",
              }),
            ],
          }),
        ],
        usdQuote,
      ),
    ).scenarios[0];
    expect(res.valid).toBe(true);
    // 100 USD × 2 pax × 3 qty = 600 USD = 219000 AMD at 365 AMD/USD.
    expect(res.totals.byCategory.TICKETS.USD).toBe("600");
    const line = res.lines.find((l) => l.ref === "L-TICKET")!;
    expect(line).toMatchObject({
      label: "Garni ticket",
      category: "TICKETS",
      basis: "PER_PERSON",
      currency: "USD",
      unitRate: "100",
      quantity: "3",
      participants: null,
      amountSource: "MANUAL",
      amountAmd: "219000",
      amountQuote: "600",
      // Catalog key fields pass through so editors can map lines back to days.
      serviceProductId: "sp-1",
      date: "2026-10-01",
      vehicleTypeId: "veh-1",
    });
  });

  it("CAPACITY_BLOCK: ceil(pax/capacity) units × rate × quantity", () => {
    const res = calculate(
      makeInput(
        [
          makeScenario({
            travelers: T({ paying: 5 }),
            services: [
              makeService({
                ref: "L-BLOCK",
                basis: "CAPACITY_BLOCK",
                capacity: 2,
                unitRate: "50",
                quantity: "2",
              }),
            ],
          }),
        ],
        usdQuote,
      ),
    ).scenarios[0];
    // ceil(5/2) = 3 units × 50 AMD × 2 qty = 300 AMD.
    const line = res.lines.find((l) => l.ref === "L-BLOCK")!;
    expect(line.amountAmd).toBe("300");
    expect(Number(line.amountQuote)).toBeCloseTo(300 / 365, 10);
  });

  it("amountSource: catalog / override / included / missing", () => {
    const res = calculate(
      makeInput(
        [
          makeScenario({
            services: [
              makeService({ ref: "L-CAT", sourceRef: "RateVersion abc (Test!A1)" }),
              makeService({
                ref: "L-OVR",
                unitRate: "1200",
                override: { originalRate: "1000", reason: "negotiated", actorId: "u1" },
              }),
              makeService({ ref: "L-INC", includedElsewhere: true }),
              makeService({ ref: "L-MISS", unitRate: null }),
            ],
          }),
        ],
        usdQuote,
      ),
    ).scenarios[0];
    const byRef = (ref: string) => res.lines.find((l) => l.ref === ref)!;
    expect(byRef("L-CAT").amountSource).toBe("CATALOG");
    expect(byRef("L-OVR").amountSource).toBe("OVERRIDE");
    expect(byRef("L-OVR").unitRate).toBe("1200");
    expect(byRef("L-INC").amountSource).toBe("INCLUDED");
    expect(byRef("L-MISS").amountSource).toBe("MISSING");
    expect(byRef("L-MISS").amountAmd).toBeNull();
    expect(byRef("L-MISS").amountQuote).toBeNull();
    expect(blockerCodes(res)).toContain("MISSING_RATE");
  });

  it("nightly rows carry AMD/quote conversions; FX failure leaves nulls", () => {
    const stay = makeStay({
      checkIn: "2026-10-01",
      checkOut: "2026-10-03",
      roomAllocations: [alloc({ rooms: 2 })],
      rates: {
        STANDARD: [{ from: "2026-10-01", to: "2026-10-03", rate: "100", currency: "USD", priority: 0 }],
      },
    });
    const sc = makeScenario({ tourStart: "2026-10-01", tourEnd: "2026-10-03", stays: [stay] });

    const ok = calculate(makeInput([sc], usdQuote)).scenarios[0];
    expect(ok.nightly).toHaveLength(2);
    // 100 USD × 2 rooms = 200 USD/night = 73000 AMD.
    expect(ok.nightly[0].amountAmd).toBe("73000");
    expect(ok.nightly[0].amountQuote).toBe("200");

    const noFx = calculate(makeInput([sc], { fx: FX({ rates: {}, quoteCurrency: "USD" }) })).scenarios[0];
    expect(noFx.nightly[0].amountAmd).toBeNull();
    expect(noFx.lines).toEqual([]);
  });
});
