import { describe, expect, it } from "vitest";
import { computePolicyStage, roundUpToIncrement } from "@/lib/travel/engine";
import Decimal from "decimal.js";
import type { PolicyInput } from "@/lib/travel/contracts";
import { FX } from "./helpers";

const usdFx = FX({ quoteCurrency: "USD" });

/**
 * The frozen EngineInput contract carries no selling-override field, so the
 * engine's round-up rounding makes sell ≥ floor unreachable-from-input. The
 * BELOW_FLOOR guard is therefore exercised through the exported policy-stage
 * helper's `sellOverride` — the same check a validator UI performs when a
 * manager types a manual selling price.
 *
 * Since v0.15.1 the min-profit floor is PER TRAVELER EXCLUDING INFANTS — the
 * caller passes the derived count (`max(0, adults + children − infants)`);
 * floorTravelers = 1 reproduces the legacy flat-floor numbers exactly.
 */
describe("computePolicyStage floor guard", () => {
  const floorPolicy: PolicyInput = {
    type: "MARKUP_ON_COST",
    minProfit: "200",
    minProfitCurrency: "USD",
    roundingIncrement: "1",
  };

  it("a manual sell below the floor → BELOW_FLOOR blocker", () => {
    const res = computePolicyStage("1000", floorPolicy, usdFx, 1, "SC1", "1100");
    expect(res.policyFloor).toBe("1200");
    expect(res.issues.some((i) => i.code === "BELOW_FLOOR" && i.severity === "BLOCKER")).toBe(true);
  });

  it("with belowFloorExceptionGranted the scenario may proceed (warning only)", () => {
    const res = computePolicyStage(
      "1000",
      { ...floorPolicy, belowFloorExceptionGranted: true },
      usdFx,
      1,
      "SC1",
      "1100",
    );
    expect(res.issues.every((i) => i.severity !== "BLOCKER")).toBe(true);
    expect(res.issues.some((i) => i.code === "BELOW_FLOOR" && i.severity === "WARNING")).toBe(true);
  });

  it("normally rounded sell is never below the floor", () => {
    const res = computePolicyStage("1000", floorPolicy, usdFx, 1, "SC1");
    expect(res.sell).toBe("1200");
    expect(res.issues).toEqual([]);
  });
});

describe("per-traveler floor (v0.15.1)", () => {
  it("floor = cost + minProfit × floorTravelers (count = 1 keeps the legacy flat floor)", () => {
    const res = computePolicyStage(
      "651",
      { type: "MARKUP_ON_COST", minProfit: "50", minProfitCurrency: "USD", roundingIncrement: "1" },
      usdFx,
      2,
      "SC1",
    );
    expect(res.policyFloor).toBe("751"); // 651 + 2 × 50
    expect(res.sell).toBe("751");
    expect(res.profit).toBe("100");
    expect(res.trace.some((t) => t.includes("policy floor: (2 travelers × 50 USD) + 651 = 751"))).toBe(true);
  });

  it("multiplier 3 (e.g. 2 adults + 2 children − 1 infant): (3 travelers × 50 USD) + 651 = 801", () => {
    const res = computePolicyStage(
      "651",
      { type: "MARKUP_ON_COST", minProfit: "50", minProfitCurrency: "USD", roundingIncrement: "1" },
      usdFx,
      3,
      "SC1",
    );
    expect(res.policyFloor).toBe("801");
    expect(res.sell).toBe("801");
    expect(res.trace.some((t) => t.includes("policy floor: (3 travelers × 50 USD) + 651 = 801"))).toBe(true);
  });

  it("multiplier 0 (clamped infants > children) → floor = bare cost", () => {
    const res = computePolicyStage(
      "651",
      { type: "MARKUP_ON_COST", minProfit: "50", minProfitCurrency: "USD", roundingIncrement: "1" },
      usdFx,
      0,
      "SC1",
    );
    expect(res.policyFloor).toBe("651");
  });

  it("singular trace wording for one traveler", () => {
    const res = computePolicyStage(
      "1000",
      { type: "MARKUP_ON_COST", minProfit: "200", minProfitCurrency: "USD", roundingIncrement: "1" },
      usdFx,
      1,
      "SC1",
    );
    expect(res.trace.some((t) => t.includes("(1 traveler × 200 USD)"))).toBe(true);
  });

  it("sell = max(markup target, per-traveler floor) — the floor wins when higher", () => {
    const res = computePolicyStage(
      "651",
      { type: "MARKUP_ON_COST", rate: "0.14", minProfit: "50", minProfitCurrency: "USD", roundingIncrement: "1" },
      usdFx,
      2,
      "SC1",
    );
    expect(Number(res.policyTarget)).toBeCloseTo(742.14, 2); // 651 × 1.14
    expect(res.policyFloor).toBe("751");
    expect(res.sell).toBe("751");
    expect(res.profit).toBe("100");
  });

  it("the markup target wins when it exceeds the per-traveler floor", () => {
    const res = computePolicyStage(
      "1000",
      { type: "MARKUP_ON_COST", rate: "0.14", minProfit: "50", minProfitCurrency: "USD", roundingIncrement: "1" },
      usdFx,
      2,
      "SC1",
    );
    expect(res.policyFloor).toBe("1100"); // 1000 + 2 × 50
    expect(res.policyTarget).toBe("1140");
    expect(res.sell).toBe("1140");
  });

  it("minProfit in a foreign currency converts per traveler before multiplying", () => {
    const res = computePolicyStage(
      "1425500", // AMD cost, quote AMD
      { type: "MARKUP_ON_COST", minProfit: "50", minProfitCurrency: "USD", roundingIncrement: "1" },
      FX({ rates: { USD: "365" }, quoteCurrency: "AMD" }),
      22,
      "SC1",
    );
    // 50 USD × 365 = 18,250 AMD per person × 22 = 401,500 + 1,425,500 = 1,827,000
    expect(res.policyFloor).toBe("1827000");
  });
});

describe("roundUpToIncrement", () => {
  it("rounds up to whole units, halves and tens", () => {
    expect(roundUpToIncrement(new Decimal("968.219"), new Decimal("1")).toString()).toBe("969");
    expect(roundUpToIncrement(new Decimal("1263.1578947368421053"), new Decimal("0.5")).toString()).toBe("1263.5");
    expect(roundUpToIncrement(new Decimal("1001"), new Decimal("10")).toString()).toBe("1010");
    expect(roundUpToIncrement(new Decimal("1200"), new Decimal("1")).toString()).toBe("1200");
    expect(roundUpToIncrement(new Decimal("0"), new Decimal("1")).toString()).toBe("0");
  });
});
