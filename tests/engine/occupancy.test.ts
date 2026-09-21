import { describe, expect, it } from "vitest";
import { validateOccupancy } from "@/lib/travel/engine";
import { T, alloc } from "./helpers";

describe("validateOccupancy", () => {
  it("5 adults in 2 DBL rooms (capacity 2 each) → OCCUPANCY_SHORTFALL blocker", () => {
    const issues = validateOccupancy(
      [alloc({ roomType: "DBL", rooms: 2, adults: 5, capacityAdults: 2, capacityTotal: 2 })],
      T({ adults: 5, paying: 5 }),
      "SC1",
      "S1",
    );
    expect(issues.some((i) => i.code === "OCCUPANCY_SHORTFALL" && i.severity === "BLOCKER")).toBe(true);
  });

  it("an eligible extra bed (capacityTotal 3) resolves the shortfall", () => {
    const issues = validateOccupancy(
      [
        alloc({
          roomType: "DBL",
          rooms: 2,
          adults: 5,
          capacityAdults: 2,
          capacityTotal: 3,
          extraBeds: 1,
          extraBedAllowed: true,
        }),
      ],
      T({ adults: 5, paying: 5 }),
    );
    expect(issues.every((i) => i.severity !== "BLOCKER")).toBe(true);
  });

  it("extra beds on an ineligible category → EXTRA_BED_NOT_ALLOWED blocker", () => {
    const issues = validateOccupancy(
      [alloc({ extraBeds: 1, extraBedAllowed: false })],
      T(),
    );
    expect(issues.some((i) => i.code === "EXTRA_BED_NOT_ALLOWED" && i.severity === "BLOCKER")).toBe(true);
  });

  it("single-use of a DBL is allowed but flagged as UNUSED_BEDS warning", () => {
    const issues = validateOccupancy(
      [alloc({ roomType: "DBL", rooms: 1, adults: 1, capacityAdults: 2, capacityTotal: 2 })],
      T({ adults: 1, paying: 1 }),
    );
    expect(issues.every((i) => i.severity !== "BLOCKER")).toBe(true);
    expect(issues.some((i) => i.code === "UNUSED_BEDS" && i.severity === "WARNING")).toBe(true);
  });

  it("per-room child capacity is enforced", () => {
    const issues = validateOccupancy(
      [alloc({ children: 3, capacityChildren: 1, capacityTotal: 5 })],
      T({ adults: 2, children: 3, paying: 5 }),
    );
    expect(issues.some((i) => i.code === "OCCUPANCY_SHORTFALL")).toBe(true);
  });

  it("a stay allocating no beds for travelers needing lodging is a shortfall", () => {
    const issues = validateOccupancy([], T({ adults: 2 }));
    expect(issues.some((i) => i.code === "OCCUPANCY_SHORTFALL" && i.severity === "BLOCKER")).toBe(true);
  });

  it("room types with rooms = 0 are ignored entirely", () => {
    const issues = validateOccupancy(
      [alloc({ rooms: 0, adults: 0 }), alloc({ rooms: 1, adults: 2 })],
      T(),
    );
    expect(issues).toEqual([]);
  });

  it("over-assignment: more occupants assigned than travelers needing lodging → blocker", () => {
    const issues = validateOccupancy(
      [
        alloc({ roomType: "DBL", rooms: 1, adults: 2 }),
        alloc({ roomType: "SGL", rooms: 1, adults: 1, capacityAdults: 1, capacityTotal: 1 }),
      ],
      T({ adults: 2, paying: 2 }),
    );
    const over = issues.find((i) => i.code === "CAPACITY_EXCEEDED");
    expect(over?.severity).toBe("BLOCKER");
    expect(over?.message).toContain("3 occupants");
    expect(over?.message).toContain("2 travelers");
  });

  it("exact assignment (Σ occupants == travelers) does not trigger over-assignment", () => {
    const issues = validateOccupancy([alloc({ rooms: 1, adults: 2 })], T());
    expect(issues.some((i) => i.code === "CAPACITY_EXCEEDED")).toBe(false);
  });

  it("zero-occupant allocations are UNSPECIFIED, not UNUSED_BEDS", () => {
    // Rooms booked but no travelers assigned yet (advisor mid-editing): no
    // unused-beds nag.
    const issues = validateOccupancy(
      [alloc({ rooms: 2, adults: 0, children: 0, infants: 0 })],
      T({ adults: 0, paying: 0 }),
    );
    expect(issues.some((i) => i.code === "UNUSED_BEDS")).toBe(false);
  });

  it("mixed: one allocation assigned, another fully empty still flags unused beds", () => {
    const issues = validateOccupancy(
      [alloc({ rooms: 1, adults: 2 }), alloc({ roomType: "SGL", rooms: 1, adults: 0, capacityAdults: 1, capacityTotal: 1 })],
      T(),
    );
    expect(issues.some((i) => i.code === "UNUSED_BEDS" && i.severity === "WARNING")).toBe(true);
  });
});
