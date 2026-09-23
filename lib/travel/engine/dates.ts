/**
 * Pure calendar-date helpers for the travel engine.
 *
 * All arithmetic is done in UTC milliseconds on purpose: the engine works with
 * destination-local calendar dates ("YYYY-MM-DD") and must never observe the
 * host timezone or DST shifts.
 */

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export interface StayInterval {
  checkIn: string;
  checkOut: string;
}

/** Strict validation — rejects real-world impossibilities like 2026-02-30. */
export function isValidISODate(value: string): boolean {
  const m = ISO_DATE_RE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

function toUtcMs(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtcMs(ms: number): string {
  const dt = new Date(ms);
  const y = String(dt.getUTCFullYear()).padStart(4, "0");
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(date: string, days: number): string {
  return fromUtcMs(toUtcMs(date) + days * MS_PER_DAY);
}

/** Calendar days between start and end (end − start); negative when reversed. */
export function nightsBetween(start: string, end: string): number {
  return Math.round((toUtcMs(end) - toUtcMs(start)) / MS_PER_DAY);
}

/** Workbook convention: a same-day tour is 1 day / 0 nights. */
export function daysBetween(start: string, end: string): number {
  return nightsBetween(start, end) + 1;
}

/** The night dates of [checkIn, checkOut) — one entry per overnight. */
export function enumerateNights(checkIn: string, checkOut: string): string[] {
  const out: string[] = [];
  const endMs = toUtcMs(checkOut);
  for (let t = toUtcMs(checkIn); t < endMs; t += MS_PER_DAY) {
    out.push(fromUtcMs(t));
  }
  return out;
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  const day = new Date(toUtcMs(date)).getUTCDay(); // 0 = Sunday
  return day === 0 ? 7 : day;
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "2026-09-04" → "04-Sep-2026" (dd-mmm-yyyy, English abbreviations). Display
 * helper for UI dates; never throws — nullish input returns "", anything that
 * is not a valid ISO date passes through unchanged.
 */
export function formatDisplayDate(iso: string | null | undefined): string {
  if (iso == null || iso === "") return "";
  if (!isValidISODate(iso)) return iso;
  const [y, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")}-${MONTH_ABBR[m - 1]}-${y}`;
}

/** "04-Sep-2026 → 07-Sep-2026" — both sides follow formatDisplayDate passthrough. */
export function formatDisplayDateRange(from: string | null | undefined, to: string | null | undefined): string {
  return `${formatDisplayDate(from)} → ${formatDisplayDate(to)}`;
}

/**
 * Splits the parent stay's segment partition by inserting a sub-interval.
 *
 * The insert must lie fully inside exactly one existing segment (a start
 * aligned to a segment boundary belongs to the segment starting there).
 * Inserting [10-03,10-05) into [10-01,10-06) yields
 * [10-01,10-03), [10-03,10-05), [10-05,10-06) (2+2+1 nights).
 *
 * Throws when the insert escapes the parent interval, lands in a gap between
 * segments, or spans multiple segments — spanning is ambiguous because the
 * caller must decide per-segment rates for the inserted piece.
 */
export function splitStayIntervals(
  existing: StayInterval[],
  insert: StayInterval,
): StayInterval[] {
  if (existing.length === 0) {
    throw new Error("splitStayIntervals: existing stay has no segments");
  }
  for (const s of [...existing, insert]) {
    if (!isValidISODate(s.checkIn) || !isValidISODate(s.checkOut)) {
      throw new Error(
        `splitStayIntervals: invalid date in interval ${s.checkIn}→${s.checkOut}`,
      );
    }
    if (s.checkIn >= s.checkOut) {
      throw new Error(
        `splitStayIntervals: empty or reversed interval ${s.checkIn}→${s.checkOut}`,
      );
    }
  }
  const sorted = [...existing].sort((a, b) => (a.checkIn < b.checkIn ? -1 : 1));
  const parentStart = sorted[0].checkIn;
  const parentEnd = sorted[sorted.length - 1].checkOut;
  if (insert.checkIn < parentStart || insert.checkOut > parentEnd) {
    throw new Error(
      `splitStayIntervals: insert ${insert.checkIn}→${insert.checkOut} is outside the parent stay ${parentStart}→${parentEnd}`,
    );
  }
  const hit = sorted.filter(
    (s) => s.checkIn < insert.checkOut && insert.checkIn < s.checkOut,
  );
  if (hit.length !== 1) {
    throw new Error(
      hit.length === 0
        ? `splitStayIntervals: insert ${insert.checkIn}→${insert.checkOut} lands in a gap between existing segments`
        : `splitStayIntervals: insert ${insert.checkIn}→${insert.checkOut} spans ${hit.length} existing segments; split it per segment instead`,
    );
  }
  const seg = hit[0];
  const pieces: StayInterval[] = [];
  if (seg.checkIn < insert.checkIn) {
    pieces.push({ checkIn: seg.checkIn, checkOut: insert.checkIn });
  }
  pieces.push({ checkIn: insert.checkIn, checkOut: insert.checkOut });
  if (insert.checkOut < seg.checkOut) {
    pieces.push({ checkIn: insert.checkOut, checkOut: seg.checkOut });
  }
  return sorted.flatMap((s) => (s === seg ? pieces : [s]));
}
