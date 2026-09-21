import { z } from "zod";
import { COST_CATEGORIES, PRICING_BASES } from "@/lib/travel/contracts";

/**
 * Shared zod fragments for the catalog CRUD routes. Money stays a decimal
 * STRING (SQLite has no decimal type); ""/"TBC" on input means null (unknown).
 * `undefined` means "leave unchanged" on PATCH, so amount fields are validated
 * raw and converted with toAmount() at the handler.
 */

export const MONEY_RE = /^\d+(\.\d{1,2})?$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const moneyField = z
  .string()
  .trim()
  .refine((v) => v === "" || v.toUpperCase() === "TBC" || MONEY_RE.test(v), {
    message: "amount must be a non-negative decimal (e.g. 12500 or 12500.00), empty, or TBC",
  })
  .nullish();

/** undefined = unchanged; ""/"TBC" = null (unknown); otherwise the decimal string. */
export function toAmount(v: string | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const t = v.trim();
  return t === "" || t.toUpperCase() === "TBC" ? null : t;
}

export const dateField = z.string().regex(DATE_RE, "expected YYYY-MM-DD").nullish();

/** ISO weekdays 1 (Mon) .. 7 (Sun); stored on the model as a JSON string. */
export const weekdaysField = z.array(z.number().int().min(1).max(7)).nullish();

export function toWeekdaysJson(v: number[] | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v.length === 0) return null;
  return JSON.stringify(Array.from(new Set(v)).sort((a, b) => a - b));
}

export const serviceCategoryField = z.enum(COST_CATEGORIES);
export const pricingBasisField = z.enum(PRICING_BASES);
export const durationVariantField = z.enum(["half_day", "full_day", "transfer"]);
export const hotelKindField = z.enum(["ROOM", "COTTAGE_UNIT"]);
export const occupancyField = z.enum(["SGL", "DBL", "TPL", "EXTRA_BED", "UNIT"]);
export const productTypeField = z.enum(["HOTEL", "VEHICLE", "SERVICE"]);

export const currencyField = z
  .string()
  .trim()
  .regex(/^[A-Z]{3}$/, "currency must be a 3-letter code");

/** Both boundaries optional, but an explicit pair must be ordered (to is exclusive). */
export function validityOrdered(validFrom?: string | null, validTo?: string | null): boolean {
  return !(validFrom && validTo && validFrom >= validTo);
}
