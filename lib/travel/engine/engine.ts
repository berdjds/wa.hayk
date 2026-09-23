import Decimal from "decimal.js";
import {
  COST_CATEGORIES,
  ENGINE_VERSION,
  type AmountSource,
  type CostCategory,
  type EngineInput,
  type EngineIssue,
  type EngineOutput,
  type IssueCode,
  type Money,
  type NightlyCharge,
  type RatePeriod,
  type ScenarioEngineInput,
  type ScenarioResult,
  type ScenarioResultLine,
  type ServiceLineInput,
} from "@/lib/travel/contracts";
import { enumerateNights, isValidISODate, nightsBetween } from "./dates";
import { validateOccupancy } from "./occupancy";
import { money, parseMoney, displayMoneyCeil } from "./money";
import { resolveFxRate } from "./fx";
import { computePolicyStage } from "./policy";

/**
 * The calculation engine. Fully pure: no I/O, no clock, no prisma — the same
 * input snapshot always produces the same output (see lib/travel/snapshots.ts).
 */

/**
 * Trace display (v0.13.2): drop the internal "RateVersion <id>" prefix and keep
 * only the evidence anchor; omit the parenthetical entirely when the rate has
 * no evidence. Non-catalog refs (e.g. "Tour Calculator!D9") pass through.
 */
function formatSourceRef(sourceRef: string | null | undefined): string {
  if (!sourceRef) return "";
  const m = sourceRef.match(/^RateVersion \S+ \((.*)\)$/);
  const evidence = m ? m[1] : sourceRef;
  if (!evidence || evidence === "no evidence") return "";
  return ` (${evidence})`;
}

export function calculate(input: EngineInput): EngineOutput {
  const scenarios = input.scenarios.map((sc) => calculateScenario(sc, input));
  return {
    valid: scenarios.every((s) => s.valid),
    engineVersion: input.engineVersion || ENGINE_VERSION,
    scenarios,
    issues: scenarios.flatMap((s) => s.issues),
  };
}

function calculateScenario(sc: ScenarioEngineInput, input: EngineInput): ScenarioResult {
  const issues: EngineIssue[] = [];
  const trace: string[] = [];
  const push = (
    code: IssueCode,
    severity: "BLOCKER" | "WARNING",
    message: string,
    extra?: { lineRef?: string; field?: string },
  ) => {
    issues.push({ code, severity, scenarioRef: sc.ref, message, ...extra });
  };

  // --- Tour dates -----------------------------------------------------------
  const startOk = isValidISODate(sc.tourStart);
  const endOk = isValidISODate(sc.tourEnd);
  if (!startOk) {
    push("INVALID_DATE", "BLOCKER", `tourStart "${sc.tourStart}" is not a valid calendar date`, { field: "tourStart" });
  }
  if (!endOk) {
    push("INVALID_DATE", "BLOCKER", `tourEnd "${sc.tourEnd}" is not a valid calendar date`, { field: "tourEnd" });
  }
  const orderOk = startOk && endOk && sc.tourEnd >= sc.tourStart;
  if (startOk && endOk && !orderOk) {
    push("DATE_ORDER", "BLOCKER", `tourEnd ${sc.tourEnd} is before tourStart ${sc.tourStart}`, { field: "tourEnd" });
  }
  const nights = startOk && endOk ? nightsBetween(sc.tourStart, sc.tourEnd) : 0;
  const days = startOk && endOk ? nights + 1 : 0;
  if (orderOk) trace.push(`tour ${sc.tourStart} → ${sc.tourEnd}: ${nights} night(s) / ${days} day(s)`);

  // --- Cost accumulator (Decimal all the way; stringified only at the end) --
  const byCategory: Record<string, Record<string, Money>> = {};
  for (const c of COST_CATEGORIES) byCategory[c] = {};
  const acc = new Map<string, Decimal>();
  const addCost = (category: CostCategory, currency: string, amount: Decimal) => {
    const key = `${category}|${currency}`;
    acc.set(key, (acc.get(key) ?? new Decimal(0)).plus(amount));
  };

  // --- Stays: occupancy, nightly expansion, coverage ------------------------
  const nightly: NightlyCharge[] = [];
  const coverage = new Map<string, string[]>();
  const stayNights = new Map<string, string[]>();

  for (const stay of sc.stays) {
    issues.push(...validateOccupancy(stay.roomAllocations, sc.travelers, sc.ref, stay.ref));

    const inOk = isValidISODate(stay.checkIn);
    const outOk = isValidISODate(stay.checkOut);
    if (!inOk) {
      push("INVALID_DATE", "BLOCKER", `stay ${stay.ref}: checkIn "${stay.checkIn}" is not a valid calendar date`, { lineRef: stay.ref, field: "checkIn" });
    }
    if (!outOk) {
      push("INVALID_DATE", "BLOCKER", `stay ${stay.ref}: checkOut "${stay.checkOut}" is not a valid calendar date`, { lineRef: stay.ref, field: "checkOut" });
    }
    if (!inOk || !outOk) continue;
    if (stay.checkOut < stay.checkIn) {
      push("DATE_ORDER", "BLOCKER", `stay ${stay.ref}: checkOut ${stay.checkOut} is before checkIn ${stay.checkIn}`, { lineRef: stay.ref, field: "checkOut" });
      continue;
    }
    if (stay.checkOut === stay.checkIn) {
      // A zero-night stay prices nothing and covers nothing — almost always a
      // data-entry slip, but not illegal (e.g. day-use placeholder).
      push("DATE_ORDER", "WARNING", `stay ${stay.ref}: checkOut equals checkIn — the stay spans zero nights`, { lineRef: stay.ref, field: "checkOut" });
    }

    // Rate-period envelopes are validated once; invalid ones never win a night.
    const validRates = new Map<string, RatePeriod[]>();
    for (const [roomType, periods] of Object.entries(stay.rates)) {
      for (const p of periods) {
        if (!isValidISODate(p.from) || !isValidISODate(p.to)) {
          push("INVALID_DATE", "BLOCKER", `stay ${stay.ref} ${roomType}: rate period "${p.from}"→"${p.to}" has an invalid date`, { lineRef: stay.ref, field: "rates" });
          continue;
        }
        if (p.to <= p.from) {
          push("DATE_ORDER", "BLOCKER", `stay ${stay.ref} ${roomType}: rate period "${p.from}"→"${p.to}" is empty or reversed`, { lineRef: stay.ref, field: "rates" });
          continue;
        }
        const list = validRates.get(roomType) ?? [];
        list.push(p);
        validRates.set(roomType, list);
      }
    }

    const nightsOfStay = enumerateNights(stay.checkIn, stay.checkOut);
    stayNights.set(stay.ref, nightsOfStay);
    // Trace lines consolidate identical nights into one line per group
    // (v0.13.2); per-night detail still lands in nightly[] above.
    const traceGroups = new Map<
      string,
      {
        roomType: string;
        wholeUnit: boolean;
        rooms: number;
        rate: Decimal;
        currency: string;
        sourceRef?: string;
        extraBeds: number;
        extraBedPerNight: Decimal;
        extraBedIncluded: boolean;
        firstNight: string;
        lastNight: string;
        nights: number;
      }
    >();
    for (const night of nightsOfStay) {
      const refs = coverage.get(night) ?? [];
      refs.push(stay.ref);
      coverage.set(night, refs);

      for (const alloc of stay.roomAllocations) {
        if (alloc.rooms <= 0) continue; // unused room types never require a rate
        // ISO calendar strings compare lexicographically — safe for [from, to).
        const covering = (validRates.get(alloc.roomType) ?? []).filter(
          (p) => p.from <= night && night < p.to,
        );
        if (covering.length === 0) {
          push("MISSING_RATE", "BLOCKER", `stay ${stay.ref} ${night} ${alloc.roomType}: no rate period covers this night`, { lineRef: stay.ref, field: "rates" });
          continue;
        }
        const top = Math.max(...covering.map((p) => p.priority));
        const winners = covering.filter((p) => p.priority === top);
        if (winners.length > 1) {
          push("AMBIGUOUS_RATE", "BLOCKER", `stay ${stay.ref} ${night} ${alloc.roomType}: ${winners.length} rate periods with equal priority ${top} overlap on the same night`, { lineRef: stay.ref, field: "rates" });
          continue;
        }
        const period = winners[0];
        if (period.rate === null) {
          // TBC on a SELECTED room type blocks; it must never be coerced to 0.
          push("MISSING_RATE", "BLOCKER", `stay ${stay.ref} ${night} ${alloc.roomType}: rate is TBC${period.sourceRef ? ` (${period.sourceRef})` : ""}`, { lineRef: stay.ref, field: "rate" });
          continue;
        }
        const rate = parseMoney(period.rate);
        if (rate === null) {
          push("MISSING_RATE", "BLOCKER", `stay ${stay.ref} ${night} ${alloc.roomType}: rate "${period.rate}" is not a valid decimal`, { lineRef: stay.ref, field: "rate" });
          continue;
        }
        let extraBedCharge = new Decimal(0);
        if (alloc.extraBeds > 0 && !alloc.extraBedIncludedInRate) {
          // undefined extraBedRate = the rate has no extra-bed supplement;
          // an explicit null = TBC, which blocks like any missing rate.
          if (period.extraBedRate === null) {
            push("MISSING_RATE", "BLOCKER", `stay ${stay.ref} ${night} ${alloc.roomType}: extra bed rate is TBC`, { lineRef: stay.ref, field: "extraBedRate" });
            continue;
          }
          if (period.extraBedRate !== undefined) {
            const bedRate = parseMoney(period.extraBedRate);
            if (bedRate === null) {
              push("MISSING_RATE", "BLOCKER", `stay ${stay.ref} ${night} ${alloc.roomType}: extra bed rate "${period.extraBedRate}" is not a valid decimal`, { lineRef: stay.ref, field: "extraBedRate" });
              continue;
            }
            extraBedCharge = bedRate.times(alloc.extraBeds);
          }
        }
        addCost("ACCOMMODATION", period.currency, rate.times(alloc.rooms).plus(extraBedCharge));
        nightly.push({
          date: night,
          stayRef: stay.ref,
          roomType: alloc.roomType,
          rooms: alloc.rooms,
          rate: period.rate,
          currency: period.currency,
          extraBeds: alloc.extraBeds,
          extraBedCharge: money(extraBedCharge),
          sourceRef: period.sourceRef,
        });
        // wholeUnit cottages are rented per unit-night; alloc.rooms is the unit
        // count, so bedroom counts must never enter the formula.
        const gKey = [
          alloc.roomType,
          alloc.wholeUnit ? "1" : "0",
          alloc.rooms,
          alloc.extraBeds,
          alloc.extraBedIncludedInRate ? "1" : "0",
          period.rate,
          period.currency,
          period.sourceRef ?? "",
          money(extraBedCharge),
        ].join("|");
        const group = traceGroups.get(gKey);
        if (group) {
          group.nights += 1;
          group.lastNight = night;
        } else {
          traceGroups.set(gKey, {
            roomType: alloc.roomType,
            wholeUnit: alloc.wholeUnit ?? false,
            rooms: alloc.rooms,
            rate,
            currency: period.currency,
            sourceRef: period.sourceRef,
            extraBeds: alloc.extraBeds,
            extraBedPerNight: extraBedCharge,
            extraBedIncluded: alloc.extraBedIncludedInRate ?? false,
            firstNight: night,
            lastNight: night,
            nights: 1,
          });
        }
      }

      for (const supp of stay.supplements ?? []) {
        const amount = parseMoney(supp.amount);
        if (amount === null) {
          push("MISSING_RATE", "BLOCKER", `stay ${stay.ref} ${night}: supplement "${supp.label}" amount "${supp.amount}" is not a valid decimal`, { lineRef: stay.ref, field: "supplements" });
          continue;
        }
        if (amount.lt(0)) {
          push("INVALID_POLICY", "BLOCKER", `stay ${stay.ref} ${night}: supplement "${supp.label}" amount "${supp.amount}" is negative — supplements must be non-negative`, { lineRef: stay.ref, field: "supplements" });
          continue;
        }
        addCost("ACCOMMODATION", supp.currency, amount);
        trace.push(`${stay.hotelName} ${night} supplement "${supp.label}": +${displayMoneyCeil(supp.amount)} ${supp.currency}`);
      }
    }

    // One consolidated trace line per (roomType, rate, currency, sourceRef,
    // wholeUnit) group — e.g. `Royal Plaza — DBL, 2026-09-22 → 2026-09-24
    // (3 nights): 1 room × 55,000 AMD/night = 165,000 AMD (Tour Calculator!D6)`.
    for (const g of Array.from(traceGroups.values())) {
      const total = g.rate.times(g.rooms).plus(g.extraBedPerNight).times(g.nights);
      trace.push(
        `${stay.hotelName} — ${g.roomType}${g.wholeUnit ? " (whole unit)" : ""}, ` +
          `${g.firstNight} → ${g.lastNight} (${g.nights} night${g.nights === 1 ? "" : "s"}): ` +
          `${g.rooms} ${g.rooms === 1 ? "room" : "rooms"} × ${displayMoneyCeil(g.rate)} ${g.currency}/night` +
          (g.extraBeds > 0
            ? ` + ${g.extraBeds} extra bed${g.extraBeds === 1 ? "" : "s"} = ${displayMoneyCeil(g.extraBedPerNight)} ${g.currency}/night${g.extraBedIncluded ? " (included in rate)" : ""}`
            : "") +
          ` = ${displayMoneyCeil(total)} ${g.currency}${formatSourceRef(g.sourceRef)}`,
      );
    }
  }

  // --- Night coverage against the tour interval -----------------------------
  if (orderOk) {
    const selfArranged = new Map<string, string>();
    for (const s of sc.selfArrangedNights ?? []) {
      if (!isValidISODate(s.date)) {
        push("INVALID_DATE", "BLOCKER", `self-arranged night "${s.date}" is not a valid calendar date`, { field: "selfArrangedNights" });
        continue;
      }
      // Self-arranged marks are advisory: a night outside the tour means
      // nothing, and a booked stay always wins over them.
      if (s.date < sc.tourStart || s.date >= sc.tourEnd) {
        push("SELF_ARRANGED_NO_REASON", "WARNING", `self-arranged night ${s.date} is outside the tour ${sc.tourStart}→${sc.tourEnd} — ignored`, { field: "selfArrangedNights" });
        continue;
      }
      if ((coverage.get(s.date) ?? []).length > 0) {
        push("SELF_ARRANGED_NO_REASON", "WARNING", `self-arranged night ${s.date} is also covered by a stay — the stay wins`, { field: "selfArrangedNights" });
        continue;
      }
      selfArranged.set(s.date, s.reason);
    }
    stayNights.forEach((dates, stayRef) => {
      const outside = dates.filter((d) => d < sc.tourStart || d >= sc.tourEnd);
      if (outside.length > 0) {
        push("OUT_OF_TOUR_STAY", "BLOCKER", `stay ${stayRef}: night(s) ${outside.join(", ")} fall outside the tour ${sc.tourStart}→${sc.tourEnd}`, { lineRef: stayRef });
      }
    });
    for (const night of enumerateNights(sc.tourStart, sc.tourEnd)) {
      const refs = coverage.get(night) ?? [];
      if (refs.length > 1) {
        push("NIGHT_OVERLAP", "BLOCKER", `night ${night} is covered by multiple stays: ${refs.join(", ")}`, { field: "stays" });
      } else if (refs.length === 0) {
        if (selfArranged.has(night)) {
          const reason = (selfArranged.get(night) ?? "").trim();
          if (reason.length === 0) {
            push("SELF_ARRANGED_NO_REASON", "BLOCKER", `self-arranged night ${night} has no reason`, { field: "selfArrangedNights" });
          } else {
            trace.push(`night ${night}: self-arranged (${reason})`);
          }
        } else {
          push("NIGHT_GAP", "BLOCKER", `night ${night} is not covered by any stay`, { field: "stays" });
        }
      }
    }
  }

  // --- Service lines ----------------------------------------------------------
  // Net-cost visibility (v0.11.0): every line is recorded with its computed
  // amount (source currency) and provenance, converted to AMD/quote below once
  // FX is resolved. Lines that fail validation are recorded with amount null.
  const pendingLines: { line: ServiceLineInput; amount: Decimal | null; amountSource: AmountSource }[] = [];
  for (const line of sc.services) {
    const amountSource: AmountSource = line.includedElsewhere
      ? "INCLUDED"
      : line.unitRate === null
        ? "MISSING"
        : line.override
          ? "OVERRIDE"
          : // resolve.ts stamps catalog-resolved rates with a "RateVersion <id>" sourceRef.
            line.sourceRef?.startsWith("RateVersion ")
            ? "CATALOG"
            : "MANUAL";
    if (line.includedElsewhere) {
      trace.push(`"${line.label}": included elsewhere — charged 0`);
      pendingLines.push({ line, amount: new Decimal(0), amountSource });
      continue;
    }
    if (line.unitRate === null) {
      push("MISSING_RATE", "BLOCKER", `line ${line.ref} "${line.label}": rate is missing/TBC`, { lineRef: line.ref, field: "unitRate" });
      pendingLines.push({ line, amount: null, amountSource });
      continue;
    }
    const rate = parseMoney(line.unitRate);
    if (rate === null) {
      push("MISSING_RATE", "BLOCKER", `line ${line.ref} "${line.label}": rate "${line.unitRate}" is not a valid decimal`, { lineRef: line.ref, field: "unitRate" });
      pendingLines.push({ line, amount: null, amountSource });
      continue;
    }
    if (rate.lt(0)) {
      push("INVALID_POLICY", "BLOCKER", `line ${line.ref} "${line.label}": unitRate "${line.unitRate}" is negative — money fields must be non-negative`, { lineRef: line.ref, field: "unitRate" });
      pendingLines.push({ line, amount: null, amountSource });
      continue;
    }
    const qty = parseMoney(line.quantity);
    if (qty === null) {
      push("INVALID_POLICY", "BLOCKER", `line ${line.ref} "${line.label}": quantity "${line.quantity}" is not a valid decimal`, { lineRef: line.ref, field: "quantity" });
      pendingLines.push({ line, amount: null, amountSource });
      continue;
    }
    if (qty.lt(0)) {
      push("INVALID_POLICY", "BLOCKER", `line ${line.ref} "${line.label}": quantity "${line.quantity}" is negative`, { lineRef: line.ref, field: "quantity" });
      pendingLines.push({ line, amount: null, amountSource });
      continue;
    }
    if (line.participants !== undefined && line.participants < 0) {
      push("INVALID_POLICY", "BLOCKER", `line ${line.ref} "${line.label}": participants ${line.participants} is negative`, { lineRef: line.ref, field: "participants" });
      pendingLines.push({ line, amount: null, amountSource });
      continue;
    }
    // Staff lines never multiply by guest PAX — the workbook counts staff
    // explicitly, so a staff line without participants means one staff member.
    const defaultPax = line.isStaffCost ? 1 : sc.travelers.paying;
    let amount: Decimal;
    let formula: string;
    switch (line.basis) {
      case "PER_PERSON":
      case "PERSON_MEAL": {
        const pax = line.participants ?? defaultPax;
        amount = rate.times(pax).times(qty);
        formula = `${displayMoneyCeil(line.unitRate)} × ${pax} pax × ${money(qty)}`;
        break;
      }
      case "CAPACITY_BLOCK": {
        if (line.capacity === undefined || line.capacity < 1) {
          push("INVALID_POLICY", "BLOCKER", `line ${line.ref} "${line.label}": CAPACITY_BLOCK requires capacity ≥ 1`, { lineRef: line.ref, field: "capacity" });
          pendingLines.push({ line, amount: null, amountSource });
          continue;
        }
        const pax = line.participants ?? defaultPax;
        const units = Math.ceil(pax / line.capacity);
        amount = new Decimal(units).times(rate).times(qty);
        formula = `ceil(${pax}/${line.capacity}) = ${units} unit(s) × ${displayMoneyCeil(line.unitRate)} × ${money(qty)}`;
        break;
      }
      // GROUP, FIXED_PACKAGE, GUIDE_DAY, GUIDE_HALF_DAY, VEHICLE_TRIP,
      // VEHICLE_DAY, PER_KM, ROOM_NIGHT: rate × quantity, never × guest PAX.
      default: {
        amount = rate.times(qty);
        formula = `${displayMoneyCeil(line.unitRate)} × ${money(qty)}`;
      }
    }
    addCost(line.category, line.currency, amount);
    trace.push(`"${line.label}" [${line.basis}]: ${formula} = ${displayMoneyCeil(amount)} ${line.currency}`);
    pendingLines.push({ line, amount, amountSource });
  }

  // --- Vehicle capacity -------------------------------------------------------
  for (const vc of sc.vehicleChecks ?? []) {
    const seats = vc.passengerSeats * vc.vehicles;
    if (vc.requiredSeats > seats) {
      push("CAPACITY_EXCEEDED", "BLOCKER", `${vc.label}: ${vc.requiredSeats} required seats > ${vc.passengerSeats} seats × ${vc.vehicles} vehicle(s) = ${seats}`, { lineRef: vc.ref });
    } else {
      trace.push(`vehicle ${vc.ref} "${vc.label}": ${vc.requiredSeats} required seat(s) ≤ ${seats} available`);
    }
  }

  // --- FX conversion to quote currency ----------------------------------------
  const curTotals = new Map<string, Decimal>();
  acc.forEach((amount, key) => {
    const sep = key.indexOf("|");
    const cat = key.slice(0, sep);
    const cur = key.slice(sep + 1);
    byCategory[cat][cur] = money(amount);
    curTotals.set(cur, (curTotals.get(cur) ?? new Decimal(0)).plus(amount));
  });

  let fxOk = true;
  const fxRates = new Map<string, Decimal>();
  const usedCurrencies = new Set(Array.from(curTotals.keys()).concat(input.fx.quoteCurrency));
  usedCurrencies.forEach((cur) => {
    const r = resolveFxRate(input.fx, cur);
    if (r.code === "MISSING_FX") {
      push("MISSING_FX", "BLOCKER", `no FX rate for ${cur} (AMD per 1 ${cur}); quote currency is ${input.fx.quoteCurrency}`, { field: "fx" });
      fxOk = false;
    } else if (r.code === "INVALID_FX") {
      push("INVALID_FX", "BLOCKER", `FX rate for ${cur} must be a positive decimal, got "${input.fx.rates[cur] ?? ""}"`, { field: "fx" });
      fxOk = false;
    } else if (r.rate) {
      fxRates.set(cur, r.rate);
    }
  });

  const costByCurrency: Record<string, Money> = {};
  const bySourceCurrency: Record<string, Money> = {};
  let costQuote = new Decimal(0);
  curTotals.forEach((total, cur) => {
    bySourceCurrency[cur] = money(total);
  });
  if (fxOk) {
    const rQuote = fxRates.get(input.fx.quoteCurrency)!;
    curTotals.forEach((total, cur) => {
      const converted = total.times(fxRates.get(cur)!).div(rQuote);
      costByCurrency[cur] = money(converted);
      costQuote = costQuote.plus(converted);
      trace.push(`fx: ${displayMoneyCeil(total)} ${cur} → ${displayMoneyCeil(converted)} ${input.fx.quoteCurrency} (rate ${money(fxRates.get(cur)!)} AMD/${cur}, quote rate ${money(rQuote)})`);
    });
  }

  // Line/nightly conversion happens once FX is known (v0.11.0). When FX failed
  // the amounts stay null — a partial conversion would present false precision.
  const rQuote = fxOk ? fxRates.get(input.fx.quoteCurrency)! : null;
  const convert = (amount: Decimal, currency: string): { amountAmd: Money | null; amountQuote: Money | null } => {
    const fx = rQuote ? fxRates.get(currency) : undefined;
    if (!fx || !rQuote) return { amountAmd: null, amountQuote: null };
    const amd = amount.times(fx);
    return { amountAmd: money(amd), amountQuote: money(amd.div(rQuote)) };
  };
  const lines: ScenarioResultLine[] = pendingLines.map(({ line, amount, amountSource }) => ({
    ref: line.ref,
    label: line.label,
    category: line.category,
    basis: line.basis,
    currency: line.currency,
    unitRate: line.unitRate,
    quantity: line.quantity,
    participants: line.participants ?? null,
    amountSource,
    amount: amount === null ? null : money(amount),
    ...(amount === null ? { amountAmd: null, amountQuote: null } : convert(amount, line.currency)),
    ...(line.serviceProductId ? { serviceProductId: line.serviceProductId } : {}),
    ...(line.date ? { date: line.date } : {}),
    ...(line.vehicleTypeId ? { vehicleTypeId: line.vehicleTypeId } : {}),
  }));
  // nightly rows exist only for nights that priced, so rate/extraBedCharge parse.
  const nightlyOut: NightlyCharge[] = nightly.map((n) => {
    const rowAmount = parseMoney(n.rate)!.times(n.rooms).plus(parseMoney(n.extraBedCharge)!);
    return { ...n, ...convert(rowAmount, n.currency) };
  });

  // --- Pricing policy (skipped when FX failed: costQuote would be a lie) -----
  let policyTarget: Money | null = null;
  let policyFloor: Money | null = null;
  let unroundedSell: Money = "0";
  let roundingAdjustment: Money = "0";
  let sell: Money = "0";
  let profit: Money = "0";
  let margin: Money | null = null;
  let perPayingPerson: Money | null = null;
  if (fxOk) {
    // Min-profit floor multiplier (v0.15.1): travelers excluding infants.
    // `children` is the 0–12 count and already includes infants (the subset
    // with age ≤ infantMaxAge), so subtract; clamp at 0 against manual
    // overrides that leave infants > children.
    const floorTravelers = Math.max(0, sc.travelers.adults + sc.travelers.children - sc.travelers.infants);
    const stage = computePolicyStage(money(costQuote), input.policy, input.fx, floorTravelers, sc.ref);
    issues.push(...stage.issues);
    trace.push(...stage.trace);
    policyTarget = stage.policyTarget;
    policyFloor = stage.policyFloor;
    unroundedSell = stage.unroundedSell;
    roundingAdjustment = stage.roundingAdjustment;
    sell = stage.sell;
    profit = stage.profit;
    margin = stage.margin;
    if (sc.travelers.paying > 0) {
      perPayingPerson = money(new Decimal(sell).div(sc.travelers.paying));
    }
  }

  return {
    ref: sc.ref,
    label: sc.label,
    valid: !issues.some((i) => i.severity === "BLOCKER"),
    issues,
    nights,
    days,
    totals: { byCategory, costByCurrency, bySourceCurrency, costQuote: money(costQuote) },
    nightly: nightlyOut,
    lines,
    policyTarget,
    policyFloor,
    unroundedSell,
    roundingAdjustment,
    sell,
    profit,
    margin,
    perPayingPerson,
    trace,
  };
}
