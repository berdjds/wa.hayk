/**
 * Money-parsing and negative-money guards (review fixes).
 *
 * parseMoney is STRICT: plain decimal syntax only, so Decimal's acceptance of
 * "0x10"/"1e3"/"Infinity" can never smuggle garbage into money fields. The
 * engine separately BLOCKS negative unit rates, quantities, participants and
 * supplement amounts — a negative cost would fabricate profit.
 */

import { describe, expect, it } from "vitest";
import { calculate, parseMoney } from "@/lib/travel/engine";
import { displayMoneyCeil, groupMoney } from "@/lib/travel/engine/money";
import { T, makeInput, makeScenario, makeService, makeStay, alloc } from "./helpers";

describe("displayMoneyCeil (trace display, v0.13.2)", () => {
  it("rounds up to a whole unit and comma-groups", () => {
    expect(displayMoneyCeil("824.86187845303867403")).toBe("825");
    expect(displayMoneyCeil("298600")).toBe("298,600");
    expect(displayMoneyCeil("1529300")).toBe("1,529,300");
    expect(displayMoneyCeil("55000.00")).toBe("55,000");
  });

  it("keeps exact integers unchanged apart from grouping", () => {
    expect(displayMoneyCeil("0")).toBe("0");
    expect(displayMoneyCeil("7")).toBe("7");
    expect(displayMoneyCeil("1000")).toBe("1,000");
  });

  it("ceils fractions away from zero floor even below 1, and toward zero for negatives", () => {
    expect(displayMoneyCeil("0.01")).toBe("1");
    expect(displayMoneyCeil("-12.3")).toBe("-12");
    expect(displayMoneyCeil("-12.9")).toBe("-12");
    expect(displayMoneyCeil("-1200.5")).toBe("-1,200");
  });

  it("accepts Decimal instances", () => {
    expect(displayMoneyCeil(parseMoney("999.1")!)).toBe("1,000");
  });
});

describe("groupMoney (PDF table cells, v0.13.2)", () => {
  it("comma-groups the integer part and preserves decimals as-is", () => {
    expect(groupMoney("298600")).toBe("298,600");
    expect(groupMoney("824.86187845303867403")).toBe("824.86187845303867403");
    expect(groupMoney("362.5")).toBe("362.5");
    expect(groupMoney("1234567.89")).toBe("1,234,567.89");
  });

  it("handles zero, small values and negatives", () => {
    expect(groupMoney("0")).toBe("0");
    expect(groupMoney("42")).toBe("42");
    expect(groupMoney("-5000.25")).toBe("-5,000.25");
  });
});

describe("parseMoney strictness", () => {
  it("rejects hex, scientific notation, Infinity and empty input", () => {
    for (const bad of ["0x10", "1e3", "Infinity", "-Infinity", "NaN", "", "abc", "1,000"]) {
      expect(parseMoney(bad), bad).toBe(null);
    }
  });

  it("trims surrounding whitespace and accepts plain decimals", () => {
    expect(parseMoney(" 100")?.toString()).toBe("100");
    expect(parseMoney("100 ")?.toString()).toBe("100");
    expect(parseMoney(" 100 ")?.toString()).toBe("100");
    expect(parseMoney("0.5")?.toString()).toBe("0.5");
    expect(parseMoney("0")?.toString()).toBe("0");
  });

  it("accepts a signed decimal — sign checks belong to the callers", () => {
    expect(parseMoney("-5")?.toString()).toBe("-5");
  });
});

describe("negative money is blocked, never charged", () => {
  it("negative unitRate → INVALID_POLICY blocker", () => {
    const sc = makeScenario({ services: [makeService({ unitRate: "-100" })] });
    const res = calculate(makeInput([sc])).scenarios[0];
    expect(res.valid).toBe(false);
    const issue = res.issues.find((i) => i.severity === "BLOCKER");
    expect(issue?.code).toBe("INVALID_POLICY");
    expect(issue?.message).toContain("negative");
    // The negative amount must never reach the totals.
    expect(res.totals.byCategory.OTHER).toEqual({});
  });

  it("negative quantity → INVALID_POLICY blocker", () => {
    const sc = makeScenario({ services: [makeService({ quantity: "-2" })] });
    const res = calculate(makeInput([sc])).scenarios[0];
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "INVALID_POLICY" && i.severity === "BLOCKER")).toBe(true);
    expect(res.totals.byCategory.OTHER).toEqual({});
  });

  it("negative participants → INVALID_POLICY blocker", () => {
    const sc = makeScenario({
      services: [makeService({ basis: "PER_PERSON", participants: -1 })],
    });
    const res = calculate(makeInput([sc])).scenarios[0];
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "INVALID_POLICY" && i.severity === "BLOCKER")).toBe(true);
  });

  it("negative supplement amount → INVALID_POLICY blocker", () => {
    const stay = makeStay({
      roomAllocations: [alloc()],
      rates: {
        STANDARD: [{ from: "2026-10-01", to: "2026-10-02", rate: "10000", currency: "AMD", priority: 0 }],
      },
      supplements: [{ label: "discount disguised as supplement", amount: "-5000", currency: "AMD" }],
    });
    const sc = makeScenario({ tourStart: "2026-10-01", tourEnd: "2026-10-02", stays: [stay] });
    const res = calculate(makeInput([sc])).scenarios[0];
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "INVALID_POLICY" && i.severity === "BLOCKER" && i.message.includes("supplement"))).toBe(true);
    // 1 night × 10000 only — the negative supplement added nothing.
    expect(res.totals.byCategory.ACCOMMODATION.AMD).toBe("10000");
  });

  it("garbage rates (\"1e3\", \"0x10\") are MISSING_RATE blockers, not numbers", () => {
    for (const garbage of ["1e3", "0x10"]) {
      const sc = makeScenario({ services: [makeService({ unitRate: garbage })] });
      const res = calculate(makeInput([sc])).scenarios[0];
      expect(res.valid).toBe(false);
      expect(res.issues.some((i) => i.code === "MISSING_RATE" && i.severity === "BLOCKER")).toBe(true);
    }
  });
});

describe("policy rate validation", () => {
  it("negative MARKUP_ON_COST rate → INVALID_POLICY blocker", () => {
    const sc = makeScenario({ services: [makeService({ unitRate: "1000" })] });
    const res = calculate(
      makeInput([sc], { policy: { type: "MARKUP_ON_COST", rate: "-0.5", roundingIncrement: "1" } }),
    ).scenarios[0];
    expect(res.valid).toBe(false);
    expect(res.issues.some((i) => i.code === "INVALID_POLICY" && i.severity === "BLOCKER")).toBe(true);
  });

  it("zero markup stays legal (pass-through pricing)", () => {
    const sc = makeScenario({ services: [makeService({ unitRate: "1000" })] });
    const res = calculate(
      makeInput([sc], { policy: { type: "MARKUP_ON_COST", rate: "0", roundingIncrement: "1" } }),
    ).scenarios[0];
    expect(res.valid).toBe(true);
    expect(res.sell).toBe("1000");
  });
});

describe("stay and self-arranged minor warnings", () => {
  it("a zero-night stay (checkOut == checkIn) warns but does not block", () => {
    const stay = makeStay({
      checkIn: "2026-10-02",
      checkOut: "2026-10-02",
      roomAllocations: [alloc()],
      rates: {},
    });
    const res = calculate(
      makeInput([
        makeScenario({
          tourStart: "2026-10-01",
          tourEnd: "2026-10-03",
          travelers: T(),
          stays: [stay],
          // The tour nights are covered self-arranged so only the zero-night
          // warning is under test.
          selfArrangedNights: [
            { date: "2026-10-01", reason: "own booking" },
            { date: "2026-10-02", reason: "own booking" },
          ],
        }),
      ]),
    ).scenarios[0];
    expect(res.valid).toBe(true);
    expect(
      res.issues.some(
        (i) => i.code === "DATE_ORDER" && i.severity === "WARNING" && i.lineRef === stay.ref && i.message.includes("zero nights"),
      ),
    ).toBe(true);
  });

  it("a self-arranged night outside [tourStart,tourEnd) warns and is ignored", () => {
    const res = calculate(
      makeInput([
        makeScenario({
          tourStart: "2026-10-01",
          tourEnd: "2026-10-02",
          selfArrangedNights: [
            { date: "2026-10-01", reason: "own booking" },
            { date: "2026-10-05", reason: "outside the tour" },
          ],
        }),
      ]),
    ).scenarios[0];
    expect(res.valid).toBe(true);
    expect(
      res.issues.some(
        (i) => i.code === "SELF_ARRANGED_NO_REASON" && i.severity === "WARNING" && i.message.includes("outside the tour"),
      ),
    ).toBe(true);
  });

  it("a self-arranged night that a stay also covers warns; the stay wins", () => {
    const stay = makeStay({
      checkIn: "2026-10-01",
      checkOut: "2026-10-02",
      roomAllocations: [alloc()],
      rates: {
        STANDARD: [{ from: "2026-10-01", to: "2026-10-02", rate: "10000", currency: "AMD", priority: 0 }],
      },
    });
    const res = calculate(
      makeInput([
        makeScenario({
          tourStart: "2026-10-01",
          tourEnd: "2026-10-02",
          stays: [stay],
          selfArrangedNights: [{ date: "2026-10-01", reason: "duplicate marker" }],
        }),
      ]),
    ).scenarios[0];
    expect(res.valid).toBe(true);
    expect(
      res.issues.some(
        (i) => i.code === "SELF_ARRANGED_NO_REASON" && i.severity === "WARNING" && i.message.includes("the stay wins"),
      ),
    ).toBe(true);
    // Stay wins: the night is priced, not marked self-arranged in the trace.
    expect(res.trace.some((t) => t.includes("self-arranged"))).toBe(false);
    expect(res.totals.byCategory.ACCOMMODATION.AMD).toBe("10000");
  });
});
