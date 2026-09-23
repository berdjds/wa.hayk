/**
 * buildTraceRows (v0.15.0): the shared calculation-breakdown row builder used
 * by the internal costing PDF and the web Review tab. Runs against REAL
 * calculate() output so the rows always mirror engine behavior.
 */

import { describe, expect, it } from "vitest";
import { calculate } from "@/lib/travel/engine";
import { buildTraceRows } from "@/lib/travel/trace-table";
import type { EngineInput, ScenarioResult } from "@/lib/travel/contracts";
import { alloc, makeInput, makeScenario, makeService, makeStay } from "./helpers";

function fixtureInput(): EngineInput {
  return makeInput(
    [
      makeScenario({
        tourStart: "2026-10-01",
        tourEnd: "2026-10-03",
        stays: [
          makeStay({
            ref: "S1",
            hotelName: "Grand Hotel",
            checkIn: "2026-10-01",
            checkOut: "2026-10-03",
            roomAllocations: [alloc({ roomType: "DBL", rooms: 1, adults: 2 })],
            rates: {
              DBL: [{ from: "2026-10-01", to: "2026-10-03", rate: "100", currency: "USD", priority: 0 }],
            },
            supplements: [{ label: "Gala dinner", amount: "25", currency: "USD" }],
          }),
        ],
        services: [
          makeService({ ref: "L1", label: "City tour", basis: "PER_PERSON", currency: "AMD", unitRate: "5000" }),
          makeService({ ref: "L2", label: "Welcome dinner", basis: "GROUP", currency: "AMD", unitRate: "8000", includedElsewhere: true }),
        ],
      }),
    ],
    {
      // Quote currency AMD (helper default); USD costs exercise the FX rows.
      policy: {
        type: "MARKUP_ON_COST",
        rate: "0.14",
        minProfit: "20",
        minProfitCurrency: "USD",
        roundingIncrement: "1",
      },
    },
  );
}

function build(res: ScenarioResult, input: EngineInput) {
  return buildTraceRows({
    quoteCurrency: input.fx.quoteCurrency,
    fxRates: input.fx.rates,
    policy: input.policy,
    result: res,
    scenario: input.scenarios.find((s) => s.ref === res.ref),
    fallbackPayingPax: 2,
  });
}

function calculated() {
  const input = fixtureInput();
  const out = calculate(input);
  return { input, res: out.scenarios[0] };
}

describe("buildTraceRows", () => {
  it("groups consecutive same-rate nights into one accommodation row", () => {
    const { input, res } = calculated();
    const rows = build(res, input);
    const stayRow = rows.find((r) => r.description.startsWith("Grand Hotel —"));
    expect(stayRow).toBeDefined();
    expect(stayRow!.description).toBe("Grand Hotel — DBL, 2026-10-01 → 2026-10-02 (2 nights)");
    expect(stayRow!.basis).toBe("1 room × 100 USD/night");
    expect(stayRow!.calculation).toBe("2 nights × 100");
    expect(stayRow!.amount).toBe("200 USD");

    // A rate change mid-stay splits the group into one row per rate.
    const splitInput = fixtureInput();
    splitInput.scenarios[0].stays[0].rates = {
      DBL: [
        { from: "2026-10-01", to: "2026-10-02", rate: "100", currency: "USD", priority: 0 },
        { from: "2026-10-02", to: "2026-10-03", rate: "120", currency: "USD", priority: 0 },
      ],
    };
    const splitRes = calculate(splitInput).scenarios[0];
    const splitRows = build(splitRes, splitInput).filter((r) => r.description.startsWith("Grand Hotel —"));
    expect(splitRows).toHaveLength(2);
    expect(splitRows[0].amount).toBe("100 USD");
    expect(splitRows[1].amount).toBe("120 USD");
  });

  it("renders supplements and service rows (per-person calc, included elsewhere)", () => {
    const { input, res } = calculated();
    const rows = build(res, input);

    const supp = rows.find((r) => r.description.includes("supplement"));
    expect(supp).toMatchObject({
      description: 'Grand Hotel supplement "Gala dinner"',
      basis: "25 USD per night (mandatory)",
      calculation: "2 nights × 25",
      amount: "50 USD",
    });

    const tour = rows.find((r) => r.description === "City tour");
    expect(tour).toMatchObject({
      basis: "5,000 per person",
      calculation: "2 Pax × 5,000",
      amount: "10,000 AMD",
    });

    const included = rows.find((r) => r.description === "Welcome dinner");
    expect(included).toMatchObject({ basis: "included elsewhere", amount: "0 AMD" });
  });

  it("emits a per-person policy floor row between markup and sell", () => {
    const { input, res } = calculated();
    const rows = build(res, input);
    const floor = rows.find((r) => r.description === "Policy floor");
    expect(floor).toBeDefined();
    expect(floor!.basis).toBe("20 USD per person");
    // 20 USD → 7,300 AMD per person; floor = 2 × 7,300 + 101,250 net cost.
    expect(floor!.calculation).toBe("(2 × 7,300) + 101,250");
    expect(floor!.amount).toBe(`${res.policyFloor} AMD`.replace(/\B(?=(\d{3})+(?!\d))/g, ","));
    expect(floor!.amount).toBe("115,850 AMD");

    const order = rows.map((r) => r.description);
    expect(order.indexOf("Markup")).toBeLessThan(order.indexOf("Policy floor"));
    expect(order.indexOf("Policy floor")).toBeLessThan(order.indexOf("Sell"));
  });

  it("closes with bold Sell/Profit rows and mutes only total/FX rows", () => {
    const { input, res } = calculated();
    const rows = build(res, input);

    const sell = rows[rows.length - 2];
    const profit = rows[rows.length - 1];
    expect(sell.description).toBe("Sell");
    expect(sell.bold).toBe(true);
    expect(sell.amount).toBe("115,850 AMD");
    // Floor (115,850) beats the markup target (115,425).
    expect(sell.calculation).toBe("115,425 < 115,850");
    expect(profit.description).toBe("Profit");
    expect(profit.bold).toBe(true);
    expect(profit.amount).toBe("14,600 AMD");

    for (const r of rows) {
      const isTotalRow = r.description.startsWith("Total Net") || r.description.startsWith("FX ");
      expect(Boolean(r.muted)).toBe(isTotalRow);
    }
    expect(rows.some((r) => r.description === "Total Net USD")).toBe(true);
    expect(rows.some((r) => r.description === "FX USD → AMD")).toBe(true);
    expect(rows.some((r) => r.description === "Total Net AMD (quote)")).toBe(true);
  });

  it("falls back to byCategory totals and converted amounts on pre-v0.14.0 snapshots", () => {
    const { input, res } = calculated();
    // Simulate a pre-v0.14.0 frozen result: no bySourceCurrency, no per-line
    // source-currency amount.
    const legacy: ScenarioResult = JSON.parse(JSON.stringify(res));
    delete legacy.totals.bySourceCurrency;
    for (const line of legacy.lines) delete line.amount;

    const rows = build(legacy, input);
    const totalUsd = rows.find((r) => r.description === "Total Net USD");
    expect(totalUsd?.amount).toBe("250 USD");
    const totalAmd = rows.find((r) => r.description === "Total Net AMD");
    expect(totalAmd?.amount).toBe("10,000 AMD");

    // AMD lines fall back to amountAmd (same currency); the USD stay row is
    // unaffected (it builds from nightly, not lines).
    const tour = rows.find((r) => r.description === "City tour");
    expect(tour?.amount).toBe("10,000 AMD");
  });
});
