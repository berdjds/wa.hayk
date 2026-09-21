/**
 * Travel module runtime settings: singleton TravelSettings row, active pricing
 * policy, and effective-dated FX lookup.
 *
 * FX is stored as FXRateVersion rows (amdPerUnit decimal strings, effectiveFrom
 * "YYYY-MM-DD"); the engine consumes them as the FxInput map from contracts.ts.
 */

import { prisma } from "@/lib/prisma";
import { BASE_CURRENCY, type ISODate, type Money } from "@/lib/travel/contracts";
import type { QuotationPdfBranding } from "@/lib/travel/pdf/types";
import type { PricingPolicyVersion, TravelSettings } from "@prisma/client";

const SETTINGS_ID = "default";

/** Reads the singleton settings row, creating it with schema defaults on first use. */
export async function getTravelSettings(): Promise<TravelSettings> {
  // Read fast path: an unconditional upsert takes a WRITE lock on every call —
  // under concurrent request creation (companyToday → generatePackageCode)
  // those writes serialize and time out on SQLite. The row exists after first
  // use, so only the cold path writes.
  const existing = await prisma.travelSettings.findUnique({ where: { id: SETTINGS_ID } });
  if (existing) return existing;
  return prisma.travelSettings.upsert({
    where: { id: SETTINGS_ID },
    update: {},
    create: { id: SETTINGS_ID },
  });
}

/** The currently active pricing policy, or null when none has been activated. */
export async function getActivePolicy(): Promise<PricingPolicyVersion | null> {
  return prisma.pricingPolicyVersion.findFirst({
    where: { active: true },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Company branding for the client quotation PDF, shaped as the renderer's
 * QuotationPdfBranding. Frozen into the snapshot displayJson at submit time so
 * issued documents never change when these settings are edited later.
 */
export async function getCompanyBranding(): Promise<QuotationPdfBranding> {
  const s = await getTravelSettings();
  return {
    companyName: s.companyName,
    companyPhone: s.companyPhone,
    companyEmail: s.companyEmail,
    companyAddress: s.companyAddress,
    companyWebsite: s.companyWebsite,
    brandColor: s.brandColor,
  };
}

/**
 * Latest FXRateVersion per currency with effectiveFrom <= asOfDate, as
 * Record<currency, amdPerUnit>. AMD is always present as "1" (base currency,
 * see contracts.ts). asOfDate defaults to today in the company timezone.
 */
export async function getFxMap(asOfDate?: ISODate): Promise<Record<string, Money>> {
  const date = asOfDate ?? (await companyToday());
  const versions = await prisma.fXRateVersion.findMany({
    where: { effectiveFrom: { lte: date } },
    orderBy: { effectiveFrom: "asc" },
  });
  const map: Record<string, Money> = { [BASE_CURRENCY]: "1" };
  // Ascending order: later effectiveFrom rows overwrite earlier ones per currency.
  for (const v of versions) {
    map[v.currency] = v.amdPerUnit;
  }
  return map;
}

/**
 * Current calendar date "YYYY-MM-DD" in the given timezone, or in the
 * configured company timezone when omitted. Uses Intl so no tz database
 * dependency is needed.
 */
export async function companyToday(tz?: string): Promise<ISODate> {
  const zone = tz ?? (await getTravelSettings()).companyTz;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
