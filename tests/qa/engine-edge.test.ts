/**
 * QA: adversarial engine edge cases beyond the existing suite.
 *
 * - leap-year Feb 29 stays (valid in 2028, rejected in 2027);
 * - roundingIncrement "10" applied end-to-end;
 * - complimentary travelers generate costs but are excluded from the paying
 *   denominator;
 * - bundle components flagged includedElsewhere are never double-charged;
 * - a legitimate zero-rate service stays valid and distinct from missing;
 * - a scenario with only warnings (UNUSED_BEDS) stays valid;
 * - child capacity at the exact boundary passes, +1 fails.
 *
 * KNOWN GAP (reported, not tested): shared-tour weekday departures are stored
 * on ServiceProduct.weekdays but never enforced during resolution — see the
 * docstring in lib/travel/resolve.ts.
 */

import { describe, expect, it } from "vitest";
import { calculate } from "@/lib/travel/engine";
import { FX, POLICY, T, alloc, makeInput, makeScenario, makeService, makeStay } from "../engine/helpers";

const USD = { rates: { USD: "365" }, quoteCurrency: "USD" };

describe("leap-year stays", () => {
  it("2028-02-28 → 2028-03-01 is 2 nights including Feb 29 and prices both", () => {
    const stay = makeStay({
      checkIn: "2028-02-28",
      checkOut: "2028-03-01",
      roomAllocations: [alloc()],
      rates: {
        STANDARD: [{ from: "2028-02-28", to: "2028-03-01", rate: "10000", currency: "AMD", priority: 0 }],
      },
    });
    const out = calculate(
      makeInput([makeScenario({ tourStart: "2028-02-28", tourEnd: "2028-03-01", stays: [stay] })]),
    );
    const sc = out.scenarios[0];
    expect(sc.valid).toBe(true);
    expect(sc.nights).toBe(2);
    expect(sc.days).toBe(3);
    expect(sc.nightly.map((n) => n.date)).toEqual(["2028-02-28", "2028-02-29"]);
    expect(sc.totals.byCategory.ACCOMMODATION.AMD).toBe("20000");
  });

  it("2027-02-29 is not a real date → INVALID_DATE blocker", () => {
    const stay = makeStay({ checkIn: "2027-02-29", checkOut: "2027-03-01", roomAllocations: [alloc()] });
    const out = calculate(
      makeInput([makeScenario({ tourStart: "2027-02-28", tourEnd: "2027-03-01", stays: [stay] })]),
    );
    const sc = out.scenarios[0];
    expect(sc.valid).toBe(false);
    expect(sc.issues.some((i) => i.code === "INVALID_DATE" && i.field === "checkIn")).toBe(true);
  });
});

describe('roundingIncrement "10" end-to-end', () => {
  it("cost 1001 USD with markup 0 → sell 1010, adjustment 9, profit 9", () => {
    const out = calculate(
      makeInput(
        [
          makeScenario({
            services: [makeService({ currency: "USD", unitRate: "1001" })],
          }),
        ],
        { fx: USD, policy: POLICY({ rate: "0", roundingIncrement: "10" }) },
      ),
    );
    const sc = out.scenarios[0];
    expect(sc.valid).toBe(true);
    expect(sc.unroundedSell).toBe("1001");
    expect(sc.sell).toBe("1010");
    expect(sc.roundingAdjustment).toBe("9");
    expect(sc.profit).toBe("9");
    expect(Number(sc.margin)).toBeCloseTo(9 / 1010, 12);
  });
});

describe("complimentary travelers", () => {
  it("generate costs via participants but are excluded from the paying denominator", () => {
    // 2 paying + 1 complimentary: the ticket line covers all 3 participants.
    const out = calculate(
      makeInput(
        [
          makeScenario({
            travelers: T({ adults: 3, paying: 2, complimentary: 1 }),
            services: [
              makeService({ basis: "PER_PERSON", unitRate: "1500", quantity: "1", participants: 3 }),
            ],
          }),
        ],
        { policy: POLICY({ rate: "0" }) },
      ),
    );
    const sc = out.scenarios[0];
    expect(sc.valid).toBe(true);
    // Cost covers the complimentary traveler…
    expect(sc.totals.byCategory.OTHER.AMD).toBe("4500");
    expect(sc.sell).toBe("4500");
    // …but the informational per-person price divides by PAYING only.
    expect(sc.perPayingPerson).toBe("2250"); // 4500 / 2, not 4500 / 3
  });
});

describe("bundle double-charge prevention", () => {
  it("an includedElsewhere component contributes 0 on top of its bundle", () => {
    const out = calculate(
      makeInput(
        [
          makeScenario({
            services: [
              makeService({ ref: "BUNDLE", label: "Garni tour bundle", basis: "GROUP", unitRate: "10000" }),
              makeService({
                ref: "COMP",
                label: "Garni ticket (included in bundle)",
                basis: "PER_PERSON",
                unitRate: "1500",
                participants: 4,
                includedElsewhere: true,
              }),
            ],
          }),
        ],
        { policy: POLICY({ rate: "0" }) },
      ),
    );
    const sc = out.scenarios[0];
    expect(sc.valid).toBe(true);
    expect(sc.sell).toBe("10000"); // not 10000 + 4×1500 = 16000
    expect(sc.trace.some((t) => t.includes("included elsewhere"))).toBe(true);
  });
});

describe("legitimate zero rates", () => {
  it('a service priced "0" is valid, contributes 0, and is not MISSING_RATE', () => {
    const out = calculate(
      makeInput(
        [
          makeScenario({
            services: [
              makeService({ ref: "FREE", label: "Tour leader meals (guest-covered)", unitRate: "0" }),
              makeService({ ref: "PAID", label: "Paid line", unitRate: "5000" }),
            ],
          }),
        ],
        { policy: POLICY({ rate: "0" }) },
      ),
    );
    const sc = out.scenarios[0];
    expect(sc.valid).toBe(true);
    expect(sc.issues.filter((i) => i.lineRef === "FREE")).toHaveLength(0);
    expect(sc.sell).toBe("5000");
  });
});

describe("warnings-only scenario", () => {
  it("UNUSED_BEDS is a warning: the scenario stays valid", () => {
    // One adult alone in a DBL (capacity 2): legitimate single-use.
    const stay = makeStay({
      checkIn: "2026-10-01",
      checkOut: "2026-10-02",
      roomAllocations: [alloc({ adults: 1 })],
      rates: {
        STANDARD: [{ from: "2026-10-01", to: "2026-10-02", rate: "20000", currency: "AMD", priority: 0 }],
      },
    });
    const out = calculate(
      makeInput([
        makeScenario({
          tourStart: "2026-10-01",
          tourEnd: "2026-10-02",
          travelers: T({ adults: 1, paying: 1 }),
          stays: [stay],
        }),
      ]),
    );
    const sc = out.scenarios[0];
    expect(sc.valid).toBe(true);
    expect(sc.issues).toHaveLength(1);
    expect(sc.issues[0]).toMatchObject({ code: "UNUSED_BEDS", severity: "WARNING" });
    expect(out.valid).toBe(true);
  });
});

describe("child capacity boundary", () => {
  const childStay = (children: number) =>
    makeStay({
      checkIn: "2026-10-01",
      checkOut: "2026-10-02",
      roomAllocations: [alloc({ adults: 2, children, capacityChildren: 1, capacityTotal: 3 })],
      rates: {
        STANDARD: [{ from: "2026-10-01", to: "2026-10-02", rate: "20000", currency: "AMD", priority: 0 }],
      },
    });

  it("a child at the exact child capacity passes; one more fails", () => {
    const okOut = calculate(
      makeInput([
        makeScenario({
          tourStart: "2026-10-01",
          tourEnd: "2026-10-02",
          travelers: T({ adults: 2, children: 1, paying: 2 }),
          stays: [childStay(1)],
        }),
      ]),
    );
    expect(okOut.scenarios[0].valid).toBe(true);

    const badOut = calculate(
      makeInput([
        makeScenario({
          tourStart: "2026-10-01",
          tourEnd: "2026-10-02",
          travelers: T({ adults: 2, children: 2, paying: 2 }),
          stays: [childStay(2)],
        }),
      ]),
    );
    const sc = badOut.scenarios[0];
    expect(sc.valid).toBe(false);
    expect(sc.issues.some((i) => i.code === "OCCUPANCY_SHORTFALL")).toBe(true);
  });

  // NOTE: the engine models child COUNTS, not ages — there is no age-band
  // input in TravelerSetup (contracts.ts), so "age at service date" pricing
  // rules cannot be verified at engine level. Reported as a contract gap.
});
