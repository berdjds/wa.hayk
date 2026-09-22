"use client";

import { Badge } from "@/components/ui/badge";

/** Status → tinted badge variant (v0.13.0): draft=neutral, pending=amber, approved=green, rejected=red, issued=blue. */
const STATUS_VARIANTS: Record<string, "neutral" | "warning" | "success" | "danger" | "info"> = {
  DRAFT: "neutral",
  PENDING_VALIDATION: "warning",
  CHANGES_REQUESTED: "warning",
  APPROVED: "success",
  ISSUED: "info",
  ACCEPTED: "success",
  DECLINED: "danger",
  EXPIRED: "neutral",
  REJECTED: "danger",
  CANCELLED: "neutral",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge variant={STATUS_VARIANTS[status] ?? "neutral"} className={className}>
      {status.replace(/_/g, " ")}
    </Badge>
  );
}

const GENERIC_VARIANTS: Record<string, "neutral" | "warning" | "success" | "danger" | "info"> = {
  QUEUED: "info",
  SENT: "success",
  FAILED: "danger",
  SKIPPED_NO_DESTINATION: "neutral",
  NEEDS_REVIEW: "warning",
  VERIFIED: "success",
  ARCHIVED: "neutral",
  STAGED: "info",
  ACTIVATED: "success",
  ERROR: "danger",
  PARTIALLY_ACTIVATED: "warning",
  PENDING: "warning",
  READY: "success",
  BLOCKER: "danger",
  WARNING: "warning",
};

/** Small tinted badge for non-quote statuses (deliveries, rates, imports, issues). */
export function StateBadge({ value, className }: { value: string; className?: string }) {
  return (
    <Badge variant={GENERIC_VARIANTS[value] ?? "neutral"} className={className}>
      {value.replace(/_/g, " ")}
    </Badge>
  );
}

/**
 * Money display: decimal string + currency. Values that are already clean
 * (≤2 decimals) render verbatim; longer engine decimals are DISPLAYED rounded
 * to 2dp. This is display formatting only — the value itself is never
 * recomputed or altered client-side.
 */
export function money(amount: string | null | undefined, currency?: string | null): string {
  if (amount == null || amount === "") return "—";
  const trimmed = amount.trim();
  const n = Number(trimmed);
  const text = Number.isFinite(n) && !/^-?\d+(\.\d{1,2})?$/.test(trimmed) ? n.toFixed(2) : amount;
  return currency ? `${text} ${currency}` : text;
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

/**
 * Catalog hotel names may already carry the "N★" prefix (workbook naming) —
 * prepend the stars field only when the name lacks it, never doubling it.
 */
export function hotelDisplayName(h: { name: string; stars: number | null }): string {
  if (/^\d★/.test(h.name)) return h.name;
  return h.stars != null ? `${h.stars}★ ${h.name}` : h.name;
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
