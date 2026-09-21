import Decimal from "decimal.js";

// Plain-decimal syntax only: without this gate Decimal accepts "0x10", "1e3"
// or "Infinity" and garbage would flow into money fields silently.
const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

/**
 * Money is a decimal string end-to-end; binary floats are never authoritative.
 * Returns null instead of throwing so callers can raise the proper blocker.
 * Leading/trailing whitespace is tolerated (trimmed), nothing else.
 */
export function parseMoney(value: string): Decimal | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!DECIMAL_RE.test(trimmed)) return null;
  try {
    const d = new Decimal(trimmed);
    return d.isFinite() ? d : null;
  } catch {
    return null;
  }
}

/** Canonical decimal-string rendering for money fields. */
export function money(d: Decimal): string {
  return d.toString();
}
