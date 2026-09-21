/**
 * Fleet vocabulary + per-vehicle transportation rates: the seed converges
 * legacy vehicle names (Van / Minibus / Large bus) to the operator's fleet
 * vocabulary (Sedan / Minivan / Sprinter / Big bus) by RENAMING in place, and
 * creates one priority-1 SERVICE RateVersion per vehicle for every
 * TRANSPORTATION product that has a base rate. Both are idempotent.
 */

import { beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { ensureSchema, getPrisma } from "./helpers";

let prisma: PrismaClient;
let seed: typeof import("@/scripts/seed-travel-catalog");

beforeAll(async () => {
  ensureSchema();
  prisma = await getPrisma();
  // Pre-seed the legacy fleet names to prove the rename path (a fresh seed
  // would create the new names directly).
  for (const v of [
    { name: "Sedan", seats: 3 },
    { name: "Van", seats: 5 },
    { name: "Minibus", seats: 12 },
    { name: "Large bus", seats: 48 },
  ]) {
    await prisma.vehicleType.create({ data: v });
  }
  seed = await import("@/scripts/seed-travel-catalog");
});

const FLEET: [string, number][] = [
  ["Sedan", 3],
  ["Minivan", 5],
  ["Sprinter", 12],
  ["Big bus", 48],
];

describe("fleet vocabulary convergence", () => {
  it("renames legacy vehicle types to the fleet vocabulary, keeping seats", async () => {
    const summary = await seed.seedTravelCatalog();
    expect(summary.vehicles).toBe(4);

    for (const [name, seats] of FLEET) {
      const v = await prisma.vehicleType.findFirst({ where: { name } });
      expect(v?.seats).toBe(seats);
      expect(v?.active).toBe(true);
    }
    for (const legacy of ["Van", "Minibus", "Large bus"]) {
      expect(await prisma.vehicleType.findFirst({ where: { name: legacy } })).toBeNull();
    }
  });
});

describe("per-vehicle transportation rates", () => {
  it("creates one VERIFIED priority-1 rate per vehicle for each priced TRANSPORTATION product", async () => {
    const products = await prisma.serviceProduct.findMany({
      where: { category: "TRANSPORTATION" },
      include: { rates: { where: { productType: "SERVICE" } } },
    });
    expect(products.length).toBeGreaterThan(0);

    const vehicles = await prisma.vehicleType.findMany({ where: { active: true } });
    expect(vehicles).toHaveLength(4);

    for (const product of products) {
      const baseRows = product.rates.filter((r) => r.vehicleTypeId === null);
      expect(baseRows.length).toBeGreaterThan(0);
      // The vehicle-agnostic base stays the priority-0 fallback.
      expect(baseRows.every((r) => r.priority === 0)).toBe(true);
      for (const base of baseRows) {
        for (const vehicle of vehicles) {
          const vr = product.rates.find(
            (r) =>
              r.vehicleTypeId === vehicle.id &&
              r.currency === base.currency &&
              r.validFrom === base.validFrom &&
              r.validTo === base.validTo,
          );
          expect(vr, `${product.name} × ${vehicle.name}`).toBeDefined();
          expect(vr).toMatchObject({
            amount: base.amount,
            priority: 1,
            status: "VERIFIED",
            notes: "Same as base rate pending fleet-specific pricing",
          });
        }
      }
    }
  });

  it("is idempotent: a second run creates no duplicates", async () => {
    const count = await prisma.rateVersion.count();
    const summary = await seed.seedTravelCatalog();
    expect(summary.vehicles).toBe(4);
    expect(await prisma.rateVersion.count()).toBe(count);
  });
});
