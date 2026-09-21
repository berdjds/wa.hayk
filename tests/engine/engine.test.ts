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
    expect(res.trace.some((t) => t.includes("2026-10-01 STANDARD: 2 room(s) × 28000 AMD (RateVersion autumn)"))).toBe(true);
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
  const usdInput = (policy: PolicyInput, services = [makeService({ currency: "USD", basis: "GROUP", unitRate: "1000" })]) =>
    makeInput([makeScenario({ travelers: T({ paying: 4 }), services })], {
      fx: FX({ quoteCurrency: "USD" }),
      policy,
    });

  it("cost 1000 USD, MARKUP 0.14, minProfit 200, rounding 1 → sell 1200, profit 200", () => {
    const res = calculate(
      usdInput(POLICY({ minProfit: "200", minProfitCurrency: "USD" })),
    ).scenarios[0];
    expect(res.valid).toBe(true);
    expect(res.policyTarget).toBe("1140");
    expect(res.policyFloor).toBe("1200");
    expect(res.unroundedSell).toBe("1200");
    expect(res.sell).toBe("1200");
    expect(res.roundingAdjustment).toBe("0");
    expect(res.profit).toBe("200");
    expect(Number(res.margin)).toBeCloseTo(0.16667, 4);
    expect(res.perPayingPerson).toBe("300");
  });

  it("cost 1000 USD, GROSS_MARGIN_ON_SALES 0.14, no floor → sell 1163, profit 163", () => {
    const res = calculate(usdInput(POLICY({ type: "GROSS_MARGIN_ON_SALES" }))).scenarios[0];
    expect(res.valid).toBe(true);
    expect(Number(res.unroundedSell)).toBeCloseTo(1162.7906976744, 6);
    expect(res.sell).toBe("1163");
    expect(res.profit).toBe("163");
  });

  it("feeFraction 0.05 with floor 200 → unrounded 1263.157…, sell 1264 still ≥ floor, profit nets the fee", () => {
    const res = calculate(
      usdInput({ type: "MARKUP_ON_COST", minProfit: "200", minProfitCurrency: "USD", feeFraction: "0.05", roundingIncrement: "1" }),
    ).scenarios[0];
    expect(res.valid).toBe(true);
    expect(Number(res.policyFloor)).toBeCloseTo(1263.1578947368, 8);
    expect(res.unroundedSell).toBe(res.policyFloor);
    expect(res.sell).toBe("1264");
    expect(Number(res.sell)).toBeGreaterThanOrEqual(Number(res.policyFloor));
    expect(res.profit).toBe("200.8"); // 1264 − 1000 − 1264×0.05
  });

  it("rounding increment \"0.5\" rounds up to the nearest half unit", () => {
    const res = calculate(
      usdInput({ type: "MARKUP_ON_COST", minProfit: "200", minProfitCurrency: "USD", feeFraction: "0.05", roundingIncrement: "0.5" }),
    ).scenarios[0];
    expect(res.sell).toBe("1263.5");
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
