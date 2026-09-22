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

// ---------------------------------------------------------------------------
// Display-only formatting (internal costing PDF trace + PDF tables).
// Engine math keeps full Decimal precision; these helpers only render strings.
// ---------------------------------------------------------------------------

/** Insert thousands separators into a plain integer string: "298600" → "298,600". */
export function groupThousands(intStr: string): string {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Money amounts in trace lines: rounded UP to a whole unit, comma-grouped.
 * `824.8618…` → "825", `298600` → "298,600". Negative values ceil toward zero
 * (Decimal semantics) and keep their sign: "-12.3" → "-12".
 */
export function displayMoneyCeil(value: string | Decimal): string {
  const d = (typeof value === "string" ? new Decimal(value) : value).ceil();
  const s = d.toString();
  if (s.startsWith("-")) return "-" + groupThousands(s.slice(1));
  return groupThousands(s);
}

/**
 * Comma-group the integer part of a decimal string, preserving any decimals
 * as-is (PDF table cells, where unit rates may legitimately carry decimals).
 */
export function groupMoney(value: string): string {
  const negative = value.startsWith("-");
  const body = negative ? value.slice(1) : value;
  const dot = body.indexOf(".");
  const intPart = dot === -1 ? body : body.slice(0, dot);
  const decimals = dot === -1 ? "" : body.slice(dot);
  return (negative ? "-" : "") + groupThousands(intPart) + decimals;
}
