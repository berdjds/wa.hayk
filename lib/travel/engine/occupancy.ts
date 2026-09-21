import type {
  EngineIssue,
  RoomAllocationInput,
  TravelerSetup,
} from "@/lib/travel/contracts";

/**
 * Validates room allocations against the traveler setup for one stay.
 *
 * Capacity model: capacityTotal is the physical occupancy ceiling of one room
 * WITHOUT extra beds (a DBL is capacityTotal 2 even when an extra bed is
 * allowed); each allowed extra bed then sleeps one more adult or child on top.
 * Allocations carry no per-traveler ids at engine level, so only totals are
 * checked.
 *
 * "Travelers needing lodging" = adults + children + infants (infants follow
 * capacityTotal even when free of charge). Leaders/staff lodging is costed via
 * the STAFF_ACCOMMODATION category, not these allocations.
 */
export function validateOccupancy(
  allocations: RoomAllocationInput[],
  travelers: TravelerSetup,
  scenarioRef?: string,
  lineRef?: string,
): EngineIssue[] {
  const issues: EngineIssue[] = [];
  const active = allocations.filter((a) => a.rooms > 0);
  let totalBeds = 0;
  let assigned = 0;

  for (const a of active) {
    const allowedBeds = a.extraBedAllowed ? a.extraBeds : 0;
    const beds = a.rooms * a.capacityTotal + allowedBeds;
    totalBeds += beds;
    assigned += a.adults + a.children + a.infants;

    if (a.extraBeds > 0 && !a.extraBedAllowed) {
      issues.push({
        code: "EXTRA_BED_NOT_ALLOWED",
        severity: "BLOCKER",
        scenarioRef,
        lineRef,
        message: `${a.roomType}: ${a.extraBeds} extra bed(s) requested but this room category does not allow extra beds`,
      });
    }
    if (a.adults > a.rooms * a.capacityAdults + a.extraBeds) {
      issues.push({
        code: "OCCUPANCY_SHORTFALL",
        severity: "BLOCKER",
        scenarioRef,
        lineRef,
        message: `${a.roomType}: ${a.adults} adults exceed adult capacity (${a.rooms} room(s) × ${a.capacityAdults} + ${a.extraBeds} extra bed(s))`,
      });
    }
    if (a.children > a.rooms * a.capacityChildren + a.extraBeds) {
      issues.push({
        code: "OCCUPANCY_SHORTFALL",
        severity: "BLOCKER",
        scenarioRef,
        lineRef,
        message: `${a.roomType}: ${a.children} children exceed child capacity (${a.rooms} room(s) × ${a.capacityChildren} + ${a.extraBeds} extra bed(s))`,
      });
    }
    if (a.adults + a.children + a.infants > beds) {
      issues.push({
        code: "OCCUPANCY_SHORTFALL",
        severity: "BLOCKER",
        scenarioRef,
        lineRef,
        message: `${a.roomType}: ${a.adults + a.children + a.infants} occupants exceed total capacity ${beds}`,
      });
    }
  }

  const needingLodging = travelers.adults + travelers.children + travelers.infants;
  if (needingLodging > 0 && totalBeds < needingLodging) {
    issues.push({
      code: "OCCUPANCY_SHORTFALL",
      severity: "BLOCKER",
      scenarioRef,
      lineRef,
      message: `allocated lodging capacity ${totalBeds} is below ${needingLodging} travelers needing lodging`,
    });
  }
  // Over-assignment blocks too: more occupants assigned to rooms than there
  // are travelers needing lodging means someone is double-counted (or the
  // allocation was copied from another group) — a quote priced on it is wrong.
  if (needingLodging > 0 && assigned > needingLodging) {
    issues.push({
      code: "CAPACITY_EXCEEDED",
      severity: "BLOCKER",
      scenarioRef,
      lineRef,
      message: `allocations assign ${assigned} occupants but only ${needingLodging} travelers need lodging — remove the excess assignments`,
    });
  }

  // Intentional single-use of a DBL is legitimate — flag for review only.
  // Allocations with zero occupants everywhere are treated as UNSPECIFIED
  // (advisor has not assigned travelers yet), not as wasted beds.
  const unused = totalBeds - assigned;
  if (unused > 0 && assigned > 0) {
    issues.push({
      code: "UNUSED_BEDS",
      severity: "WARNING",
      scenarioRef,
      lineRef,
      message: `${unused} unused bed(s) across allocations — confirm intentional single-use or over-allocation`,
    });
  }

  return issues;
}
