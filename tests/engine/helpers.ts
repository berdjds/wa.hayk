import type {
  EngineInput,
  FxInput,
  PolicyInput,
  RoomAllocationInput,
  ScenarioEngineInput,
  ServiceLineInput,
  StaySegmentInput,
  TravelerSetup,
} from "@/lib/travel/contracts";

export function T(overrides: Partial<TravelerSetup> = {}): TravelerSetup {
  return {
    adults: 2,
    children: 0,
    infants: 0,
    paying: 2,
    complimentary: 0,
    leaders: 0,
    staff: 0,
    ...overrides,
  };
}

export function POLICY(overrides: Partial<PolicyInput> = {}): PolicyInput {
  return { type: "MARKUP_ON_COST", rate: "0.14", roundingIncrement: "1", ...overrides };
}

export function FX(overrides: Partial<FxInput> = {}): FxInput {
  return { rates: { USD: "365" }, quoteCurrency: "AMD", ...overrides };
}

export function alloc(overrides: Partial<RoomAllocationInput> = {}): RoomAllocationInput {
  return {
    roomType: "STANDARD",
    rooms: 1,
    adults: 2,
    children: 0,
    infants: 0,
    extraBeds: 0,
    capacityAdults: 2,
    capacityChildren: 0,
    capacityTotal: 2,
    extraBedAllowed: false,
    extraBedIncludedInRate: false,
    wholeUnit: false,
    ...overrides,
  };
}

export function makeStay(overrides: Partial<StaySegmentInput> = {}): StaySegmentInput {
  return {
    ref: "S1",
    hotelName: "Test Hotel",
    checkIn: "2026-10-01",
    checkOut: "2026-10-02",
    roomAllocations: [],
    rates: {},
    ...overrides,
  };
}

export function makeService(overrides: Partial<ServiceLineInput> = {}): ServiceLineInput {
  return {
    ref: "L1",
    label: "Service",
    category: "OTHER",
    basis: "GROUP",
    currency: "AMD",
    unitRate: "1000",
    quantity: "1",
    ...overrides,
  };
}

export function makeScenario(overrides: Partial<ScenarioEngineInput> = {}): ScenarioEngineInput {
  return {
    ref: "SC1",
    label: "Scenario 1",
    // Same-day default: 0 nights, so service-only scenarios carry no
    // night-coverage obligations.
    tourStart: "2026-10-01",
    tourEnd: "2026-10-01",
    travelers: T(),
    stays: [],
    services: [],
    ...overrides,
  };
}

export function makeInput(
  scenarios: ScenarioEngineInput[],
  overrides: Partial<EngineInput> = {},
): EngineInput {
  return { fx: FX(), policy: POLICY(), scenarios, engineVersion: "1.0.0", ...overrides };
}
