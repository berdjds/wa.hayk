/**
 * Input contract for the travel quotation PDF renderer.
 *
 * The renderer consumes ONLY immutable snapshot data (parsed resultJson /
 * inputsJson) plus document metadata. It never recomputes prices and never
 * formats money: decimal strings are rendered exactly as stored, with the
 * currency code appended.
 */
import type {
  DayServiceItem,
  EngineInput,
  EngineOutput,
  TravelerSetup,
} from "@/lib/travel/contracts";

export type QuotationPdfKind = "CLIENT" | "INTERNAL";

export interface QuotationPdfAgency {
  name: string;
  shortCode: string;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
}

export interface QuotationPdfRequest {
  title: string;
  /** Local calendar dates "YYYY-MM-DD". */
  startDate: string;
  endDate: string;
  agencyRef?: string | null;
  flightDetails?: string | null;
  travelers: TravelerSetup;
  destinations?: string[];
}

export interface QuotationPdfItineraryDay {
  /** 0-based offset from the request start date. */
  dayOffset: number;
  /** Local calendar date "YYYY-MM-DD". */
  date: string;
  narrative: string | null;
  overnightCity: string | null;
  /** Normalized day services (legacy plain-string items are pre-normalized). */
  services: DayServiceItem[];
}

/** Company branding frozen into the snapshot at submit time (from TravelSettings). */
export interface QuotationPdfBranding {
  companyName?: string | null;
  companyPhone?: string | null;
  companyEmail?: string | null;
  companyAddress?: string | null;
  companyWebsite?: string | null;
  /** "#rrggbb"; invalid/unset values fall back to the default navy. */
  brandColor?: string | null;
}

export interface QuotationPdfInput {
  /** SHA-256 hex of the immutable snapshot; the footer shows the first 12 chars. */
  snapshotHash: string;
  /** e.g. "v02". */
  versionLabel: string;
  /** e.g. "ACME-2026-09-21-0001". */
  packageCode: string;
  kind: QuotationPdfKind;
  /** true → visible "DRAFT — NOT APPROVED" watermark on every page. */
  draft: boolean;
  agency: QuotationPdfAgency;
  request: QuotationPdfRequest;
  /** ISO timestamp the document is issued; defaults to render time. */
  issuedAt?: string;
  validUntil?: string | null;
  terms?: string | null;
  /** Parsed resultJson: scenarios with nightly, totals, sell, profit, margin, trace, issues. */
  snapshot: EngineOutput;
  /** Parsed inputsJson: scenario labels, stays, services (labels/basis), travelers. */
  inputs: EngineInput;
  /**
   * Frozen day-by-day itinerary (from displayJson). Absent/empty → the client
   * document renders exactly as before (stay-segment tables only).
   */
  itineraryDays?: QuotationPdfItineraryDay[];
  /**
   * Frozen company branding (from displayJson). Absent → the cover falls back
   * to the agency name/contacts and the default brand color.
   */
  branding?: QuotationPdfBranding | null;
}
