import Decimal from "decimal.js";
import type {
  EngineIssue,
  FxInput,
  IssueCode,
  Money,
  PolicyInput,
} from "@/lib/travel/contracts";
import { money, parseMoney, displayMoneyCeil } from "./money";
import { resolveFxRate } from "./fx";

export interface PolicyStageResult {
  policyTarget: Money | null;
  policyFloor: Money | null;
  unroundedSell: Money;
  roundingAdjustment: Money;
  sell: Money;
  profit: Money;
  margin: Money | null;
  issues: EngineIssue[];
  trace: string[];
}

/** Round UP to the nearest multiple of the increment ("1", "0.5", "10", …). */
export function roundUpToIncrement(value: Decimal, increment: Decimal): Decimal {
  if (value.lte(0)) return new Decimal(0);
  return value.div(increment).ceil().times(increment);
}

/**
 * Pricing policy on the quote-currency cost (before taxes).
 *
 * The fee is a fraction of the SELLING price, so it is solved by division —
 * never by inflating the markup, which would compound the rounding error.
 *
 * The min-profit floor is PER TRAVELER EXCLUDING INFANTS (v0.15.1; the
 * v0.14.0 per-paying-person multiplier is superseded):
 * floor = cost + minProfit × floorTravelers, where the caller derives
 * floorTravelers = max(0, adults + children − infants). Snapshots frozen
 * before v0.15.1 keep their numbers (per-paying; pre-v0.14.0 flat).
 *
 * `sellOverride` exists so validators can manually check a hypothetical
 * selling price against the floor; the frozen EngineInput contract carries no
 * selling-override field, so calculate() never passes one. With round-up
 * rounding sell ≥ floor holds mathematically — the BELOW_FLOOR guard is
 * reachable only through such overrides (or future contract extensions).
 */
export function computePolicyStage(
  costQuote: Money,
  policy: PolicyInput,
  fx: FxInput,
  /** Travelers excluding infants — the min-profit floor multiplies by this count. */
  floorTravelers: number,
  scenarioRef?: string,
  sellOverride?: Money,
): PolicyStageResult {
  const issues: EngineIssue[] = [];
  const trace: string[] = [];
  const push = (
    code: IssueCode,
    severity: "BLOCKER" | "WARNING",
    message: string,
    field?: string,
  ) => {
    issues.push({ code, severity, scenarioRef, message, ...(field ? { field } : {}) });
  };

  const cost = parseMoney(costQuote) ?? new Decimal(0);

  let fee = new Decimal(0);
  if (policy.feeFraction != null) {
    const parsed = parseMoney(policy.feeFraction);
    if (parsed === null || parsed.lt(0)) {
      push("INVALID_POLICY", "BLOCKER", `feeFraction "${policy.feeFraction}" is not a valid non-negative decimal`, "feeFraction");
    } else {
      fee = parsed;
    }
  }
  const oneMinusFee = new Decimal(1).minus(fee);

  let target: Decimal | null = null;
  if (policy.rate != null) {
    const rate = parseMoney(policy.rate);
    if (rate === null) {
      push("INVALID_POLICY", "BLOCKER", `policy rate "${policy.rate}" is not a valid decimal`, "rate");
    } else if (
      policy.type === "GROSS_MARGIN_ON_SALES" &&
      (rate.lt(0) || rate.gte(1))
    ) {
      push("INVALID_POLICY", "BLOCKER", `GROSS_MARGIN_ON_SALES rate must be in [0,1), got "${policy.rate}"`, "rate");
    } else if (policy.type === "MARKUP_ON_COST") {
      if (rate.lt(0)) {
        // A negative markup would price BELOW cost — never a valid policy.
        push("INVALID_POLICY", "BLOCKER", `MARKUP_ON_COST rate must be non-negative, got "${policy.rate}"`, "rate");
      } else if (oneMinusFee.lte(0)) {
        push("INVALID_DENOMINATOR", "BLOCKER", `1 − feeFraction = ${money(oneMinusFee)} is not positive`, "feeFraction");
      } else {
        target = cost.times(rate.plus(1)).div(oneMinusFee);
        trace.push(
          `policy MARKUP_ON_COST ${policy.rate}: target = ${displayMoneyCeil(cost)} × ${money(rate.plus(1))}` +
            `${fee.gt(0) ? ` / (1 − fee ${money(fee)})` : ""} = ${displayMoneyCeil(target)}`,
        );
      }
    } else {
      const denom = oneMinusFee.minus(rate);
      if (denom.lte(0)) {
        push("INVALID_DENOMINATOR", "BLOCKER", `1 − feeFraction − rate = ${money(denom)} is not positive`, "rate");
      } else {
        target = cost.div(denom);
        trace.push(`policy GROSS_MARGIN_ON_SALES ${policy.rate}: target = ${displayMoneyCeil(cost)} / ${money(denom)} = ${displayMoneyCeil(target)}`);
      }
    }
  }

  let floor: Decimal | null = null;
  if (policy.minProfit != null) {
    const minProfit = parseMoney(policy.minProfit);
    if (minProfit === null) {
      push("INVALID_POLICY", "BLOCKER", `minProfit "${policy.minProfit}" is not a valid decimal`, "minProfit");
    } else {
      const cur = policy.minProfitCurrency ?? fx.quoteCurrency;
      const rCur = resolveFxRate(fx, cur);
      const rQuote = resolveFxRate(fx, fx.quoteCurrency);
      if (rCur.code) {
        push(rCur.code, "BLOCKER", `minProfit currency ${cur}: ${rCur.code === "MISSING_FX" ? "no FX rate configured" : `invalid FX rate "${fx.rates[cur] ?? ""}"`}`, "minProfitCurrency");
      } else if (rQuote.code) {
        push(rQuote.code, "BLOCKER", `quote currency ${fx.quoteCurrency}: missing or invalid FX rate`, "fx");
      } else if (oneMinusFee.lte(0)) {
        push("INVALID_DENOMINATOR", "BLOCKER", `1 − feeFraction = ${money(oneMinusFee)} is not positive`, "feeFraction");
      } else {
        const minProfitQuote = minProfit.times(rCur.rate!).div(rQuote.rate!);
        const pax = Number.isFinite(floorTravelers) && floorTravelers > 0 ? Math.floor(floorTravelers) : 0;
        const floorProfit = minProfitQuote.times(pax);
        floor = cost.plus(floorProfit).div(oneMinusFee);
        trace.push(
          `policy floor: (${pax} traveler${pax === 1 ? "" : "s"} × ${displayMoneyCeil(minProfitQuote)} ${fx.quoteCurrency}) + ${displayMoneyCeil(cost)}` +
            `${fee.gt(0) ? ` / (1 − fee ${money(fee)})` : ""} = ${displayMoneyCeil(floor)}`,
        );
      }
    }
  }

  let unrounded: Decimal;
  let sell: Decimal;
  if (target === null && floor === null) {
    push("MISSING_POLICY", "BLOCKER", "policy configures neither a rate target nor a minProfit floor", "policy");
    // Money fields fall back to bare cost — the scenario is blocked anyway and
    // must never surface a fabricated selling price.
    unrounded = cost;
    sell = cost;
  } else {
    unrounded =
      target !== null && floor !== null
        ? Decimal.max(target, floor)
        : ((target ?? floor) as Decimal);
    const increment = parseMoney(policy.roundingIncrement);
    if (increment === null || increment.lte(0)) {
      push("INVALID_POLICY", "BLOCKER", `roundingIncrement "${policy.roundingIncrement}" must be a positive decimal`, "roundingIncrement");
      sell = unrounded;
    } else {
      sell = roundUpToIncrement(unrounded, increment);
    }
    if (sellOverride != null) {
      const override = parseMoney(sellOverride);
      if (override !== null) sell = override;
    }
  }

  const roundingAdjustment = sell.minus(unrounded);
  if (floor !== null && sell.lt(floor)) {
    if (policy.belowFloorExceptionGranted) {
      push("BELOW_FLOOR", "WARNING", `sell ${money(sell)} is below floor ${money(floor)}; manager exception granted for this snapshot`);
    } else {
      push("BELOW_FLOOR", "BLOCKER", `sell ${money(sell)} is below floor ${money(floor)} (cost + minimum profit); a manager may grant belowFloorExceptionGranted`);
    }
  }

  const feeAmount = fee.gt(0) ? sell.times(fee) : new Decimal(0);
  const profit = sell.minus(cost).minus(feeAmount);
  const margin = sell.isZero() ? null : money(profit.div(sell));
  trace.push(
    `sell: unrounded ${displayMoneyCeil(unrounded)} → sell ${displayMoneyCeil(sell)} (rounding adjustment ${displayMoneyCeil(roundingAdjustment)}); ` +
      `profit ${displayMoneyCeil(profit)}${fee.gt(0) ? ` after fee ${displayMoneyCeil(feeAmount)}` : ""}`,
  );

  return {
    policyTarget: target === null ? null : money(target),
    policyFloor: floor === null ? null : money(floor),
    unroundedSell: money(unrounded),
    roundingAdjustment: money(roundingAdjustment),
    sell: money(sell),
    profit: money(profit),
    margin,
    issues,
    trace,
  };
}
