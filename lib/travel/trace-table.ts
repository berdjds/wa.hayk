/**
 * Calculation trace table rows (v0.14.0 PDF, v0.15.0 web Review tab).
 *
 * Built purely from the structured result (res.nightly / res.lines /
 * res.totals / policy fields) joined with the frozen scenario input — never
 * by parsing the free-text res.trace strings, which stay in the snapshot for
 * API/debug consumers. The PDF renderer (pdf/templates.ts) and the web
 * TraceTable component render the SAME row list, so the on-screen breakdown
 * always matches the issued internal costing document.
 */
import Decimal from "decimal.js";
import type {
  Money,
  PolicyInput,
  ScenarioEngineInput,
  ScenarioResult,
  ScenarioResultLine,
  ServiceLineInput,
} from "@/lib/travel/contracts";
import { nightsBetween } from "./engine/dates";
import { displayMoneyCeil, parseMoney } from "./engine/money";

export interface TraceRow {
  description: string;
  basis: string;
  calculation: string;
  amount: string;
  /** Bold the amount cell (final Sell / Profit rows, per the mockup). */
  bold?: boolean;
  /** De-emphasized subtotal rows (Total Net / FX) — web rendering only; the
   *  PDF renderer ignores the flag so its output stays content-identical. */
  muted?: boolean;
}

/** Sum of a decimal-string column; invalid entries abort to null (never thrown into a renderer). */
function sumMoney(values: (string | null | undefined)[]): Decimal | null {
  let sum = new Decimal(0);
  for (const v of values) {
    const d = v != null ? parseMoney(v) : null;
    if (d === null) return null;
    sum = sum.plus(d);
  }
  return sum;
}

/** Basis text for a service row, e.g. "1,500 per person" / "35,000 per Sedan". */
function serviceBasisText(line: ScenarioResultLine, svc: ServiceLineInput | undefined, rate: string): string {
  switch (line.basis) {
    case "PER_PERSON":
      return `${rate} per person`;
    case "PERSON_MEAL":
      return `${rate} per person meal`;
    case "VEHICLE_TRIP":
      return svc?.vehicleTypeName ? `${rate} per ${svc.vehicleTypeName}` : `${rate} per vehicle trip`;
    case "VEHICLE_DAY":
      return svc?.vehicleTypeName ? `${rate} per ${svc.vehicleTypeName} per day` : `${rate} per vehicle day`;
    case "GUIDE_DAY":
      return `${rate} per guide day`;
    case "GUIDE_HALF_DAY":
      return `${rate} per guide half-day`;
    case "PER_KM":
      return `${rate} per km`;
    case "ROOM_NIGHT":
      return `${rate} per room night`;
    case "CAPACITY_BLOCK":
      return `${rate} per group of ${svc?.capacity ?? "—"}`;
    case "FIXED_PACKAGE":
      return `${rate} per package`;
    default:
      return `${rate} per group`;
  }
}

/** Calculation text mirroring the engine formulas, e.g. "2 Pax × 1,500". */
function serviceCalcText(
  line: ScenarioResultLine,
  svc: ServiceLineInput | undefined,
  rate: string,
  defaultPax: number,
): string {
  const qty = parseMoney(line.quantity);
  const qtySuffix = qty !== null && !qty.eq(1) ? ` × ${line.quantity}` : "";
  if (line.basis === "PER_PERSON" || line.basis === "PERSON_MEAL") {
    const pax = line.participants ?? (svc?.isStaffCost ? 1 : defaultPax);
    return `${pax} Pax × ${rate}${qtySuffix}`;
  }
  if (line.basis === "CAPACITY_BLOCK") {
    const pax = line.participants ?? (svc?.isStaffCost ? 1 : defaultPax);
    const cap = svc?.capacity && svc.capacity >= 1 ? svc.capacity : 1;
    const units = Math.ceil(pax / cap);
    return `${units} unit(s) × ${rate}${qtySuffix}`;
  }
  // GROUP, FIXED_PACKAGE, GUIDE_*, VEHICLE_*, PER_KM, ROOM_NIGHT: rate × qty.
  return `${rate} × ${line.quantity}`;
}

/**
 * Builds the ordered trace rows for one scenario. `scenario` is the frozen
 * scenario input matched by ref (undefined only for malformed snapshots);
 * `fallbackPayingPax` stands in for per-scenario travelers when it is absent
 * (request-level paying count).
 */
export function buildTraceRows(args: {
  quoteCurrency: string;
  fxRates: Record<string, Money>;
  policy: PolicyInput;
  result: ScenarioResult;
  scenario: ScenarioEngineInput | undefined;
  fallbackPayingPax: number;
}): TraceRow[] {
  const { quoteCurrency: q, fxRates, policy, result: res, scenario: sc, fallbackPayingPax } = args;
  const rows: TraceRow[] = [];
  const stayName = (ref: string) => sc?.stays.find((s) => s.ref === ref)?.hotelName ?? ref;

  // Accommodation: one row per (stay, roomType, rooms, rate, currency,
  // extra-bed setup) group — per-night detail lives in the nightly table.
  interface StayGroup {
    nights: number;
    firstNight: string;
    lastNight: string;
    rooms: number;
    extraBeds: number;
    rate: string;
    extraBedCharge: string;
    currency: string;
    total: Decimal;
  }
  const groups = new Map<string, StayGroup>();
  for (const n of res.nightly) {
    const rowTotal = sumMoney([n.rate])?.times(n.rooms).plus(parseMoney(n.extraBedCharge) ?? 0);
    if (!rowTotal) continue;
    const key = [n.stayRef, n.roomType, n.rooms, n.rate, n.currency, n.extraBeds, n.extraBedCharge].join("|");
    const g = groups.get(key);
    if (g) {
      g.nights += 1;
      g.lastNight = n.date;
      g.total = g.total.plus(rowTotal);
    } else {
      groups.set(key, {
        nights: 1,
        firstNight: n.date,
        lastNight: n.date,
        rooms: n.rooms,
        extraBeds: n.extraBeds,
        rate: n.rate,
        extraBedCharge: n.extraBedCharge,
        currency: n.currency,
        total: rowTotal,
      });
    }
  }
  for (const [key, g] of Array.from(groups.entries())) {
    const stayRef = key.split("|")[0];
    const roomFactor = g.rooms > 1 ? ` × ${g.rooms} rooms` : "";
    const extraSuffix =
      g.extraBeds > 0 ? ` + ${g.extraBeds} extra bed${g.extraBeds === 1 ? "" : "s"}` : "";
    rows.push({
      description:
        `${stayName(stayRef)} — ${key.split("|")[1]}, ${g.firstNight} → ${g.lastNight} ` +
        `(${g.nights} night${g.nights === 1 ? "" : "s"})`,
      basis:
        `${g.rooms} ${g.rooms === 1 ? "room" : "rooms"} × ${displayMoneyCeil(g.rate)} ${g.currency}/night` +
        extraSuffix,
      calculation: `${g.nights} night${g.nights === 1 ? "" : "s"}${roomFactor} × ${displayMoneyCeil(g.rate)}`,
      amount: `${displayMoneyCeil(g.total)} ${g.currency}`,
    });
  }

  // Mandatory per-night stay supplements are separate engine cost items.
  for (const stay of sc?.stays ?? []) {
    const nights = nightsBetween(stay.checkIn, stay.checkOut);
    for (const supp of stay.supplements ?? []) {
      const amount = parseMoney(supp.amount);
      if (!amount || nights <= 0) continue;
      rows.push({
        description: `${stay.hotelName} supplement "${supp.label}"`,
        basis: `${displayMoneyCeil(amount)} ${supp.currency} per night (mandatory)`,
        calculation: `${nights} night${nights === 1 ? "" : "s"} × ${displayMoneyCeil(amount)}`,
        amount: `${displayMoneyCeil(amount.times(nights))} ${supp.currency}`,
      });
    }
  }

  // Service rows: amounts from res.lines, vehicle/capacity context from the input.
  const svcByRef = new Map((sc?.services ?? []).map((s) => [s.ref, s]));
  const defaultPax = sc?.travelers.paying ?? fallbackPayingPax;
  for (const line of res.lines) {
    const svc = svcByRef.get(line.ref);
    if (line.amountSource === "INCLUDED") {
      rows.push({ description: line.label, basis: "included elsewhere", calculation: "", amount: `0 ${line.currency}` });
      continue;
    }
    const rate = line.unitRate !== null ? displayMoneyCeil(line.unitRate) : null;
    // amount (source currency) exists on v0.14.0+ snapshots; older snapshots
    // fall back to the converted figure when it coincides with the line's own
    // currency, else the row shows no amount rather than a wrong currency.
    const amount =
      line.amount != null
        ? `${displayMoneyCeil(line.amount)} ${line.currency}`
        : line.currency === "AMD" && line.amountAmd !== null
          ? `${displayMoneyCeil(line.amountAmd)} ${line.currency}`
          : line.currency === q && line.amountQuote !== null
            ? `${displayMoneyCeil(line.amountQuote)} ${line.currency}`
            : "—";
    if (rate === null) {
      rows.push({ description: line.label, basis: "rate missing/TBC", calculation: "", amount });
      continue;
    }
    rows.push({
      description: line.label,
      basis: serviceBasisText(line, svc, rate),
      calculation: serviceCalcText(line, svc, rate, defaultPax),
      amount,
    });
  }

  // Source-currency totals ("Total Net AMD" per currency the costs came in).
  const sourceTotals = new Map<string, Decimal>();
  if (res.totals.bySourceCurrency) {
    for (const [cur, total] of Object.entries(res.totals.bySourceCurrency)) {
      const d = parseMoney(total);
      if (d) sourceTotals.set(cur, d);
    }
  } else {
    // Pre-v0.14.0 snapshots: aggregate the per-category totals instead.
    for (const perCurrency of Object.values(res.totals.byCategory)) {
      for (const [cur, amount] of Object.entries(perCurrency)) {
        const d = parseMoney(amount);
        if (d) sourceTotals.set(cur, (sourceTotals.get(cur) ?? new Decimal(0)).plus(d));
      }
    }
  }
  for (const [cur, total] of Array.from(sourceTotals.entries())) {
    rows.push({
      description: `Total Net ${cur}`,
      basis: "",
      calculation: "",
      amount: `${displayMoneyCeil(total)} ${cur}`,
      muted: true,
    });
  }

  // FX conversion rows per non-quote currency, then the quote-currency net.
  const fxRateOf = (cur: string) => (cur === "AMD" ? "1" : fxRates[cur] ?? null);
  for (const cur of Array.from(sourceTotals.keys())) {
    if (cur === q) continue;
    const rCur = fxRateOf(cur);
    const rQuote = fxRateOf(q);
    const converted = res.totals.costByCurrency[cur];
    rows.push({
      description: `FX ${cur} → ${q}`,
      basis: rCur !== null && rQuote !== null ? `rate ${rCur} AMD/${cur} · quote rate ${rQuote}` : "FX rate missing",
      calculation: "",
      amount: converted !== undefined ? `${displayMoneyCeil(converted)} ${q}` : "—",
      muted: true,
    });
  }
  rows.push({
    // "(quote)" disambiguates from a source-currency "Total Net <cur>" row
    // when the quote currency is also a cost currency (e.g. AMD costs, AMD quote).
    description: `Total Net ${q} (quote)`,
    basis: "",
    calculation: "",
    amount: `${displayMoneyCeil(res.totals.costQuote)} ${q}`,
    muted: true,
  });

  // Policy stage: markup target, per-person floor, then Sell / Profit (bold).
  const fee = policy.feeFraction ? parseMoney(policy.feeFraction) : null;
  const feeSuffix = fee !== null && fee.gt(0) ? ` / (1 − fee ${policy.feeFraction})` : "";
  if (policy.rate && res.policyTarget !== null) {
    const rate = parseMoney(policy.rate);
    if (rate) {
      const pct = `${rate.times(100).toString()}%`;
      const calc =
        policy.type === "GROSS_MARGIN_ON_SALES"
          ? `${displayMoneyCeil(res.totals.costQuote)} / ${new Decimal(1).minus(rate).toString()}`
          : `${displayMoneyCeil(res.totals.costQuote)} × ${rate.plus(1).toString()}`;
      rows.push({
        description: "Markup",
        basis: `${policy.type} ${pct}`,
        calculation: `${calc}${feeSuffix}`,
        amount: `${displayMoneyCeil(res.policyTarget)} ${q}`,
      });
    }
  }
  if (policy.minProfit && res.policyFloor !== null) {
    const minProfit = parseMoney(policy.minProfit);
    if (minProfit) {
      const minCur = policy.minProfitCurrency ?? q;
      // Per-person amount in quote currency (display derivation only — the
      // authoritative floor is the stored policyFloor value).
      let perPersonQuote = minProfit;
      if (minCur !== q) {
        const rCur = parseMoney(fxRateOf(minCur) ?? "");
        const rQuote = parseMoney(fxRateOf(q) ?? "");
        if (rCur && rQuote && rQuote.gt(0)) perPersonQuote = minProfit.times(rCur).div(rQuote);
      }
      rows.push({
        description: "Policy floor",
        basis: `${displayMoneyCeil(minProfit)} ${minCur} per person`,
        calculation: `(${defaultPax} × ${displayMoneyCeil(perPersonQuote)}) + ${displayMoneyCeil(res.totals.costQuote)}${feeSuffix}`,
        amount: `${displayMoneyCeil(res.policyFloor)} ${q}`,
      });
    }
  }
  {
    const target = res.policyTarget !== null ? parseMoney(res.policyTarget) : null;
    const floor = res.policyFloor !== null ? parseMoney(res.policyFloor) : null;
    let calc: string;
    if (target && floor) {
      calc = `${displayMoneyCeil(target)} ${target.lt(floor) ? "<" : target.gt(floor) ? ">" : "="} ${displayMoneyCeil(floor)}`;
    } else {
      calc = displayMoneyCeil(res.unroundedSell);
    }
    const adjustment = parseMoney(res.roundingAdjustment);
    if (adjustment && !adjustment.isZero()) calc += ` + ${displayMoneyCeil(adjustment)} rounding`;
    rows.push({
      description: "Sell",
      basis: "",
      calculation: calc,
      amount: `${displayMoneyCeil(res.sell)} ${q}`,
      bold: true,
    });
    rows.push({
      description: "Profit",
      basis: "",
      calculation: `${displayMoneyCeil(res.sell)} - ${displayMoneyCeil(res.totals.costQuote)}`,
      amount: `${displayMoneyCeil(res.profit)} ${q}`,
      bold: true,
    });
  }

  return rows;
}
