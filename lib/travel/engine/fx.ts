import type Decimal from "decimal.js";
import { BASE_CURRENCY, type FxInput } from "@/lib/travel/contracts";
import { parseMoney } from "./money";

export interface FxResolution {
  rate: Decimal | null;
  code: "MISSING_FX" | "INVALID_FX" | null;
}

/**
 * fx[currency] = AMD per 1 unit; AMD itself is 1 when absent.
 * Conversion source→quote is amount × fx[source] / fx[quote], so a quote
 * currency equal to the source is the identity — USD legs are never
 * double-converted when quoting in USD.
 */
export function resolveFxRate(fx: FxInput, currency: string): FxResolution {
  const raw = fx.rates[currency] ?? (currency === BASE_CURRENCY ? "1" : undefined);
  if (raw === undefined) return { rate: null, code: "MISSING_FX" };
  const rate = parseMoney(raw);
  if (rate === null || rate.lte(0)) return { rate: null, code: "INVALID_FX" };
  return { rate, code: null };
}
