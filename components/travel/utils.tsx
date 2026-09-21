"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Status → badge styling; light-theme palette consistent with the toast colors. */
const STATUS_STYLES: Record<string, string> = {
  DRAFT: "border-slate-300 bg-slate-50 text-slate-700",
  PENDING_VALIDATION: "border-blue-300 bg-blue-50 text-blue-800",
  CHANGES_REQUESTED: "border-amber-300 bg-amber-50 text-amber-800",
  APPROVED: "border-green-300 bg-green-50 text-green-800",
  ISSUED: "border-indigo-300 bg-indigo-50 text-indigo-800",
  ACCEPTED: "border-green-300 bg-green-50 text-green-800",
  DECLINED: "border-red-300 bg-red-50 text-red-800",
  EXPIRED: "border-slate-300 bg-slate-100 text-slate-500",
  REJECTED: "border-red-300 bg-red-50 text-red-800",
  CANCELLED: "border-slate-300 bg-slate-100 text-slate-500",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge variant="outline" className={cn(STATUS_STYLES[status] ?? "border-slate-300", className)}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

const GENERIC_STYLES: Record<string, string> = {
  QUEUED: "border-blue-300 bg-blue-50 text-blue-800",
  SENT: "border-green-300 bg-green-50 text-green-800",
  FAILED: "border-red-300 bg-red-50 text-red-800",
  SKIPPED_NO_DESTINATION: "border-slate-300 bg-slate-100 text-slate-500",
  NEEDS_REVIEW: "border-amber-300 bg-amber-50 text-amber-800",
  VERIFIED: "border-green-300 bg-green-50 text-green-800",
  ARCHIVED: "border-slate-300 bg-slate-100 text-slate-500",
  STAGED: "border-blue-300 bg-blue-50 text-blue-800",
  ACTIVATED: "border-green-300 bg-green-50 text-green-800",
  ERROR: "border-red-300 bg-red-50 text-red-800",
  PARTIALLY_ACTIVATED: "border-amber-300 bg-amber-50 text-amber-800",
  PENDING: "border-blue-300 bg-blue-50 text-blue-800",
  READY: "border-green-300 bg-green-50 text-green-800",
  BLOCKER: "border-red-300 bg-red-50 text-red-800",
  WARNING: "border-amber-300 bg-amber-50 text-amber-800",
};

/** Small colored badge for non-quote statuses (deliveries, rates, imports, issues). */
export function StateBadge({ value, className }: { value: string; className?: string }) {
  return (
    <Badge variant="outline" className={cn(GENERIC_STYLES[value] ?? "border-slate-300", className)}>
      {value.replace(/_/g, " ")}
    </Badge>
  );
}

/**
 * Money is a decimal string + currency rendered verbatim — never reformatted
 * or recomputed client-side.
 */
export function money(amount: string | null | undefined, currency?: string | null): string {
  if (amount == null || amount === "") return "—";
  return currency ? `${amount} ${currency}` : amount;
}

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (raw == null || raw === "") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Humanized pricing-basis label for catalog/service pickers: operator-facing
 * wording ("per group of up to 5") instead of the raw enum, with the generic
 * enum fallback for the bases with no agreed phrasing.
 */
export function basisLabel(basis: string, capacity?: number | null): string {
  switch (basis) {
    case "CAPACITY_BLOCK":
      return capacity != null ? `per group of up to ${capacity}` : "per group of up to N";
    case "PER_PERSON":
    case "PERSON_MEAL":
      return "per person";
    case "GROUP":
      return "per group";
    default:
      return basis.replace(/_/g, " ").toLowerCase();
  }
}

export function shortHash(hash: string | null | undefined): string {
  if (!hash) return "—";
  return `${hash.slice(0, 12)}…`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

export function apiError(err: any, fallback: string): string {
  const data = err?.response?.data;
  if (typeof data?.error === "string") return data.error;
  if (Array.isArray(data?.error)) {
    const first = data.error[0];
    if (first?.message) return first.message;
  }
  return fallback;
}
