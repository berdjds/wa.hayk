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
 */
describe("computePolicyStage floor guard", () => {
  const floorPolicy: PolicyInput = {
    type: "MARKUP_ON_COST",
    minProfit: "200",
    minProfitCurrency: "USD",
    roundingIncrement: "1",
  };

  it("a manual sell below the floor → BELOW_FLOOR blocker", () => {
    const res = computePolicyStage("1000", floorPolicy, usdFx, "SC1", "1100");
    expect(res.policyFloor).toBe("1200");
    expect(res.issues.some((i) => i.code === "BELOW_FLOOR" && i.severity === "BLOCKER")).toBe(true);
  });

  it("with belowFloorExceptionGranted the scenario may proceed (warning only)", () => {
    const res = computePolicyStage(
      "1000",
      { ...floorPolicy, belowFloorExceptionGranted: true },
      usdFx,
      "SC1",
      "1100",
    );
    expect(res.issues.every((i) => i.severity !== "BLOCKER")).toBe(true);
    expect(res.issues.some((i) => i.code === "BELOW_FLOOR" && i.severity === "WARNING")).toBe(true);
  });

  it("normally rounded sell is never below the floor", () => {
    const res = computePolicyStage("1000", floorPolicy, usdFx, "SC1");
    expect(res.sell).toBe("1200");
    expect(res.issues).toEqual([]);
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
