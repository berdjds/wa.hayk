import { describe, expect, it } from "vitest";
import {
  addDays,
  daysBetween,
  enumerateNights,
  isoWeekday,
  isValidISODate,
  nightsBetween,
  splitStayIntervals,
} from "@/lib/travel/engine";

describe("isValidISODate", () => {
  it("accepts real calendar dates", () => {
    expect(isValidISODate("2026-10-01")).toBe(true);
    expect(isValidISODate("2024-02-29")).toBe(true); // leap year
  });
  it("rejects impossible or malformed dates", () => {
    expect(isValidISODate("2026-02-30")).toBe(false);
    expect(isValidISODate("2025-02-29")).toBe(false); // not a leap year
    expect(isValidISODate("2026-13-01")).toBe(false);
    expect(isValidISODate("2026-00-10")).toBe(false);
    expect(isValidISODate("2026-1-1")).toBe(false);
    expect(isValidISODate("2026/10/01")).toBe(false);
    expect(isValidISODate("")).toBe(false);
  });
});

describe("nightsBetween / daysBetween", () => {
  it("2026-10-01 → 2026-10-06 is 5 nights / 6 days", () => {
    expect(nightsBetween("2026-10-01", "2026-10-06")).toBe(5);
    expect(daysBetween("2026-10-01", "2026-10-06")).toBe(6);
  });
  it("same-day is 0 nights / 1 day", () => {
    expect(nightsBetween("2026-10-01", "2026-10-01")).toBe(0);
    expect(daysBetween("2026-10-01", "2026-10-01")).toBe(1);
  });
  it("a 12-night trip", () => {
    expect(nightsBetween("2026-03-01", "2026-03-13")).toBe(12);
    expect(daysBetween("2026-03-01", "2026-03-13")).toBe(13);
  });
  it("crosses the Dec→Jan year boundary", () => {
    expect(nightsBetween("2026-12-30", "2027-01-02")).toBe(3);
    expect(enumerateNights("2026-12-30", "2027-01-02")).toEqual([
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
    ]);
  });
  it("is negative when end < start (the engine blocks this separately)", () => {
    expect(nightsBetween("2026-10-06", "2026-10-01")).toBe(-5);
  });
});

describe("addDays / enumerateNights", () => {
  it("crosses month and year boundaries", () => {
    expect(addDays("2026-10-01", 5)).toBe("2026-10-06");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
  });
  it("enumerates the nights of [checkIn, checkOut)", () => {
    expect(enumerateNights("2026-10-01", "2026-10-04")).toEqual([
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
    ]);
    expect(enumerateNights("2026-10-01", "2026-10-01")).toEqual([]);
  });
});

describe("isoWeekday", () => {
  it("is 1=Monday … 7=Sunday", () => {
    expect(isoWeekday("2026-09-21")).toBe(1); // Monday
    expect(isoWeekday("2026-09-27")).toBe(7); // Sunday
    expect(isoWeekday("2026-10-01")).toBe(4); // Thursday
  });
});

describe("splitStayIntervals", () => {
  it("insert [10-03,10-05) into [10-01,10-06) yields 2+2+1 nights", () => {
    const out = splitStayIntervals(
      [{ checkIn: "2026-10-01", checkOut: "2026-10-06" }],
      { checkIn: "2026-10-03", checkOut: "2026-10-05" },
    );
    expect(out).toEqual([
      { checkIn: "2026-10-01", checkOut: "2026-10-03" },
      { checkIn: "2026-10-03", checkOut: "2026-10-05" },
      { checkIn: "2026-10-05", checkOut: "2026-10-06" },
    ]);
    expect(out.map((s) => nightsBetween(s.checkIn, s.checkOut))).toEqual([2, 2, 1]);
  });

  it("a boundary-aligned insert belongs to the segment starting there", () => {
    const out = splitStayIntervals(
      [
        { checkIn: "2026-10-01", checkOut: "2026-10-03" },
        { checkIn: "2026-10-03", checkOut: "2026-10-06" },
      ],
      { checkIn: "2026-10-03", checkOut: "2026-10-05" },
    );
    expect(out).toEqual([
      { checkIn: "2026-10-01", checkOut: "2026-10-03" },
      { checkIn: "2026-10-03", checkOut: "2026-10-05" },
      { checkIn: "2026-10-05", checkOut: "2026-10-06" },
    ]);
  });

  it("an insert covering the whole segment replaces it", () => {
    const out = splitStayIntervals(
      [{ checkIn: "2026-10-01", checkOut: "2026-10-06" }],
      { checkIn: "2026-10-01", checkOut: "2026-10-06" },
    );
    expect(out).toEqual([{ checkIn: "2026-10-01", checkOut: "2026-10-06" }]);
  });

  it("rejects insertions outside the parent interval", () => {
    expect(() =>
      splitStayIntervals(
        [{ checkIn: "2026-10-01", checkOut: "2026-10-06" }],
        { checkIn: "2026-10-05", checkOut: "2026-10-07" },
      ),
    ).toThrow(/outside the parent stay/);
  });

  it("rejects insertions spanning multiple segments ambiguously", () => {
    expect(() =>
      splitStayIntervals(
        [
          { checkIn: "2026-10-01", checkOut: "2026-10-03" },
          { checkIn: "2026-10-03", checkOut: "2026-10-06" },
        ],
        { checkIn: "2026-10-02", checkOut: "2026-10-04" },
      ),
    ).toThrow(/spans 2 existing segments/);
  });

  it("rejects empty or invalid intervals", () => {
    expect(() =>
      splitStayIntervals(
        [{ checkIn: "2026-10-01", checkOut: "2026-10-06" }],
        { checkIn: "2026-10-03", checkOut: "2026-10-03" },
      ),
    ).toThrow(/empty or reversed/);
    expect(() =>
      splitStayIntervals(
        [{ checkIn: "2026-10-01", checkOut: "2026-10-06" }],
        { checkIn: "2026-02-30", checkOut: "2026-10-03" },
      ),
    ).toThrow(/invalid date/);
  });
});
