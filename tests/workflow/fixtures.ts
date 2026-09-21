/**
 * Seeded fixtures for workflow tests: agency ACME, admin/advisor/validator
 * users, one hotel with a VERIFIED DBL rate, an active pricing policy and a
 * USD FX rate. The documents dir is redirected to a throwaway tmp path so
 * (mocked) PDF writes never touch real data.
 */

import type { PrismaClient } from "@prisma/client";

export const TEST_DOCS_DIR = `/tmp/wacontrol-test-docs-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

export const START_DATE = "2026-10-01";
export const END_DATE = "2026-10-04"; // 3 nights

export async function seedFixtures(prisma: PrismaClient) {
  const agency = await prisma.agency.create({
    data: { shortCode: "ACME", name: "Acme Travel", contactEmail: "ops@acme.test" },
  });
  const admin = await prisma.user.create({
    data: { email: "admin@test.io", name: "Admin", password: "x", role: "ADMIN", phone: "37400000001" },
  });
  const advisor = await prisma.user.create({
    data: { email: "advisor@test.io", name: "Advisor", password: "x", role: "ADVISOR", phone: "37400000002" },
  });
  const validator = await prisma.user.create({
    data: { email: "validator@test.io", name: "Validator", password: "x", role: "VALIDATOR", phone: "37400000003" },
  });
  // Second validator deliberately has NO phone: WHATSAPP deliveries for them
  // must land in SKIPPED_NO_DESTINATION.
  const validator2 = await prisma.user.create({
    data: { email: "validator2@test.io", name: "Validator Two", password: "x", role: "VALIDATOR" },
  });
  const plainUser = await prisma.user.create({
    data: { email: "user@test.io", name: "Plain", password: "x", role: "USER" },
  });

  const hotel = await prisma.hotelProduct.create({
    data: {
      name: "Test Hotel",
      city: "Yerevan",
      capacityAdults: 2,
      capacityChildren: 1,
      capacityTotal: 3,
      extraBedAllowed: true,
    },
  });
  await prisma.rateVersion.create({
    data: {
      productType: "HOTEL",
      hotelProductId: hotel.id,
      amount: "100",
      currency: "USD",
      occupancy: "DBL",
      status: "VERIFIED",
      evidenceRef: "Test!A1",
    },
  });

  const policy = await prisma.pricingPolicyVersion.create({
    data: {
      name: "Standard",
      type: "MARKUP_ON_COST",
      rate: "0.14",
      roundingIncrement: "1",
      quoteCurrency: "USD",
      active: true,
    },
  });
  await prisma.fXRateVersion.create({
    data: { currency: "USD", amdPerUnit: "365", effectiveFrom: "2026-01-01" },
  });

  await prisma.travelSettings.upsert({
    where: { id: "default" },
    update: { documentsDir: TEST_DOCS_DIR },
    create: { id: "default", documentsDir: TEST_DOCS_DIR },
  });

  return { agency, admin, advisor, validator, validator2, plainUser, hotel, policy };
}

export type Fixtures = Awaited<ReturnType<typeof seedFixtures>>;

export function actorOf(user: { id: string; role: string; name: string | null; email: string }) {
  return { id: user.id, role: user.role, name: user.name, email: user.email };
}

/**
 * Saves version content with the optimistic-lock revision read fresh from the
 * DB: saveVersionContent requires expectedRevision and bumps the revision on
 * every save, so hard-coding it in fixtures would go stale.
 */
export async function saveContent(
  prisma: PrismaClient,
  actor: { id: string; role: string; name?: string | null; email?: string | null },
  requestId: string,
  versionId: string,
  content: Omit<import("@/lib/travel/workflow").SaveVersionContentInput, "expectedRevision">,
) {
  const { saveVersionContent } = await import("@/lib/travel/workflow");
  const r = await prisma.travelRequest.findUnique({
    where: { id: requestId },
    select: { revision: true },
  });
  return saveVersionContent(actor, versionId, { expectedRevision: r?.revision ?? 0, ...content });
}

export const TRAVELERS = {
  adults: 2,
  children: 0,
  infants: 0,
  paying: 2,
  complimentary: 0,
  leaders: 0,
  staff: 0,
};

export function createRequestInput(agencyId: string) {
  return {
    agencyId,
    title: "Test package",
    startDate: START_DATE,
    endDate: END_DATE,
    travelers: TRAVELERS,
  };
}

/** One DBL room for two adults on the fixture hotel. */
export function dblAllocation() {
  return {
    roomType: "DBL",
    rooms: 1,
    adults: 2,
    children: 0,
    infants: 0,
    extraBeds: 0,
    capacityAdults: 2,
    capacityChildren: 1,
    capacityTotal: 3,
    extraBedAllowed: true,
    extraBedIncludedInRate: false,
    wholeUnit: false,
  };
}

export function scenarioContent(hotelProductId: string, hotelName: string) {
  return {
    scenarios: [
      {
        key: "A",
        label: "Option A",
        stays: [
          {
            hotelProductId,
            hotelName,
            city: "Yerevan",
            checkIn: START_DATE,
            checkOut: END_DATE,
            board: "BB",
            allocations: [dblAllocation()],
          },
        ],
      },
    ],
  };
}
