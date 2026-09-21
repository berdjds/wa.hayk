/**
 * Advisor-facing redaction of engine results.
 *
 * Internal costing (costQuote, profit, margin, category totals, nightly rates,
 * per-line net costs, trace, policy targets) is restricted to ADMIN/VALIDATOR
 * and — since v0.11.0 — the request OWNER (the initiator prices the request).
 * Non-owner advisors are 404'd by the routes before redaction is even
 * reachable, so these helpers remain as defense in depth.
 */

import type { ScenarioResult } from "@/lib/travel/contracts";

/** The exact sell-side fields a non-owner advisor may see per scenario. */
export interface AdvisorScenarioView {
  ref: string;
  label: string;
  valid: boolean;
  issues: unknown[];
  nights: number;
  days: number;
  sell: unknown;
  perPayingPerson: unknown;
}

export function redactScenarioResult(sc: Partial<ScenarioResult>): AdvisorScenarioView {
  return {
    ref: sc.ref ?? "",
    label: sc.label ?? "",
    valid: sc.valid ?? false,
    issues: sc.issues ?? [],
    nights: sc.nights ?? 0,
    days: sc.days ?? 0,
    sell: sc.sell ?? null,
    perPayingPerson: sc.perPayingPerson ?? null,
  };
}

/**
 * Redacts a stored ScenarioResult JSON string (Scenario.resultJson). A blob
 * that cannot be parsed redacts to the empty-but-safe shape rather than
 * leaking anything.
 */
export function redactScenarioResultJson(resultJson: string | null): string | null {
  if (resultJson == null) return null;
  try {
    return JSON.stringify(redactScenarioResult(JSON.parse(resultJson)));
  } catch {
    return JSON.stringify(redactScenarioResult({}));
  }
}

// ---------------------------------------------------------------------------
// QuoteDocument client view — the filesystem path and internal render errors
// are never exposed; a FAILED render surfaces as a state + generic message.
// ---------------------------------------------------------------------------

export const DOCUMENT_RENDER_FAILED_MESSAGE = "Document rendering failed — retry the document";

export interface DocumentView {
  id: string;
  kind: string;
  issuedAt: Date | null;
  createdAt: Date;
  renderState: "PENDING" | "FAILED" | "READY";
  renderMessage: string | null;
}

export function publicDocumentView(d: {
  id: string;
  kind: string;
  filePath: string;
  issuedAt: Date | null;
  createdAt: Date;
}): DocumentView {
  const renderState =
    d.filePath === "PENDING" ? "PENDING" : d.filePath.startsWith("FAILED:") ? "FAILED" : "READY";
  return {
    id: d.id,
    kind: d.kind,
    issuedAt: d.issuedAt,
    createdAt: d.createdAt,
    renderState,
    renderMessage: renderState === "FAILED" ? DOCUMENT_RENDER_FAILED_MESSAGE : null,
  };
}
