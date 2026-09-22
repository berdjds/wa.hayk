/**
 * QA: catalog drag-and-drop ordering endpoints (v0.13.1).
 *
 * - POST /travel/catalog/hotels/reorder + /travel/catalog/services/reorder:
 *   ADMIN-only, zod `{ ids: string[] }` (400 on empty/duplicates), unknown ids
 *   ignored, full-list reorder rewrites sortOrder 0..n-1, subset reorder keeps
 *   the existing sortOrder slots of just those rows.
 * - GET hotels/services reflects the persisted order (sortOrder asc, name asc).
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { PrismaClient } from "@prisma/client";
import { ensureSchema, getPrisma } from "../travel-db/helpers";
import { seedFixtures, type Fixtures } from "../workflow/fixtures";

const { sessionRef } = vi.hoisted(() => ({ sessionRef: { current: null as any } }));
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(async () => sessionRef.current),
}));

let prisma: PrismaClient;
let fx: Fixtures;

let hotelsRoute: typeof import("@/app/api/travel/catalog/hotels/route");
let hotelsReorder: typeof import("@/app/api/travel/catalog/hotels/reorder/route");
let servicesRoute: typeof import("@/app/api/travel/catalog/services/route");
let servicesReorder: typeof import("@/app/api/travel/catalog/services/reorder/route");

function session(user: { id: string; role: string; email: string; name: string | null } | null) {
  sessionRef.current = user
    ? { user: { id: user.id, role: user.role, email: user.email, name: user.name }, expires: "2099-01-01" }
    : null;
}

function req(url: string, init?: { method?: string; body?: unknown }) {
  return new NextRequest(url, {
    method: init?.method ?? "GET",
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

beforeAll(async () => {
  ensureSchema();
  prisma = await getPrisma();
  fx = await seedFixtures(prisma);
  hotelsRoute = await import("@/app/api/travel/catalog/hotels/route");
  hotelsReorder = await import("@/app/api/travel/catalog/hotels/reorder/route");
  servicesRoute = await import("@/app/api/travel/catalog/services/route");
  servicesReorder = await import("@/app/api/travel/catalog/services/reorder/route");
});

beforeEach(() => session(null));

describe("POST /travel/catalog/hotels/reorder", () => {
  it("persists a full-list reorder and GET reflects it", async () => {
    const a = await prisma.hotelProduct.create({ data: { name: "Alpha Hotel" } });
    const b = await prisma.hotelProduct.create({ data: { name: "Bravo Hotel" } });
    const c = await prisma.hotelProduct.create({ data: { name: "Charlie Hotel" } });

    session(fx.admin);
    // Full-table reorder (the seeded fixture hotel participates too): my three
    // hotels go first, everything else keeps its relative order after.
    const rest = (await prisma.hotelProduct.findMany({ select: { id: true } }))
      .map((h) => h.id)
      .filter((id) => ![a.id, b.id, c.id].includes(id));
    const res = await hotelsReorder.POST(req("http://t/api/travel/catalog/hotels/reorder", {
      method: "POST",
      body: { ids: [c.id, a.id, b.id, ...rest] },
    }));
    expect(res.status).toBe(200);
    expect((await res.json()).updated).toBe(3 + rest.length);

    expect((await prisma.hotelProduct.findUnique({ where: { id: c.id } }))!.sortOrder).toBe(0);
    expect((await prisma.hotelProduct.findUnique({ where: { id: a.id } }))!.sortOrder).toBe(1);
    expect((await prisma.hotelProduct.findUnique({ where: { id: b.id } }))!.sortOrder).toBe(2);

    const list = await hotelsRoute.GET(req("http://t/api/travel/catalog/hotels"));
    expect(list.status).toBe(200);
    const names = (await list.json()).map((h: { name: string }) => h.name);
    expect(names.slice(0, 3)).toEqual(["Charlie Hotel", "Alpha Hotel", "Bravo Hotel"]);
  });

  it("rejects non-ADMIN with 403 and invalid bodies with 400", async () => {
    session(fx.advisor);
    const forbidden = await hotelsReorder.POST(req("http://t/api/travel/catalog/hotels/reorder", {
      method: "POST",
      body: { ids: ["x"] },
    }));
    expect(forbidden.status).toBe(403);

    session(fx.admin);
    const empty = await hotelsReorder.POST(req("http://t/api/travel/catalog/hotels/reorder", {
      method: "POST",
      body: { ids: [] },
    }));
    expect(empty.status).toBe(400);

    const dupes = await hotelsReorder.POST(req("http://t/api/travel/catalog/hotels/reorder", {
      method: "POST",
      body: { ids: ["a", "a"] },
    }));
    expect(dupes.status).toBe(400);

    const notArray = await hotelsReorder.POST(req("http://t/api/travel/catalog/hotels/reorder", {
      method: "POST",
      body: { ids: "nope" },
    }));
    expect(notArray.status).toBe(400);
  });

  it("ignores unknown ids and only counts updated rows", async () => {
    const d = await prisma.hotelProduct.create({ data: { name: "Delta Hotel" } });
    session(fx.admin);
    const res = await hotelsReorder.POST(req("http://t/api/travel/catalog/hotels/reorder", {
      method: "POST",
      body: { ids: ["missing-id", d.id] },
    }));
    expect(res.status).toBe(200);
    expect((await res.json()).updated).toBe(1);
  });
});

describe("POST /travel/catalog/services/reorder", () => {
  it("reorders a category subset within its existing slots, leaving others in place", async () => {
    const before = await prisma.serviceProduct.create({ data: { name: "Before", category: "TICKETS", basis: "PER_PERSON" } });
    const g1 = await prisma.serviceProduct.create({ data: { name: "Guide One", category: "GUIDES", basis: "GROUP" } });
    const g2 = await prisma.serviceProduct.create({ data: { name: "Guide Two", category: "GUIDES", basis: "GROUP" } });
    const after = await prisma.serviceProduct.create({ data: { name: "After", category: "TICKETS", basis: "PER_PERSON" } });

    // Establish distinct slots for the whole table first.
    session(fx.admin);
    const all = await prisma.serviceProduct.findMany({ select: { id: true } });
    await servicesReorder.POST(req("http://t/api/travel/catalog/services/reorder", {
      method: "POST",
      body: { ids: [before.id, g1.id, g2.id, after.id, ...all.filter((s) => ![before, g1, g2, after].some((x) => x.id === s.id)).map((s) => s.id)] },
    }));
    const slotOf = async (id: string) =>
      (await prisma.serviceProduct.findUnique({ where: { id } }))!.sortOrder;
    const [sBefore, sG1, sG2, sAfter] = [await slotOf(before.id), await slotOf(g1.id), await slotOf(g2.id), await slotOf(after.id)];
    expect(sBefore).toBeLessThan(sG1);
    expect(sG1).toBeLessThan(sG2);
    expect(sG2).toBeLessThan(sAfter);

    // Reorder just the two guides — they must swap slots, nothing else moves.
    const res = await servicesReorder.POST(req("http://t/api/travel/catalog/services/reorder", {
      method: "POST",
      body: { ids: [g2.id, g1.id] },
    }));
    expect(res.status).toBe(200);
    expect((await res.json()).updated).toBe(2);
    expect(await slotOf(g2.id)).toBe(sG1);
    expect(await slotOf(g1.id)).toBe(sG2);
    expect(await slotOf(before.id)).toBe(sBefore);
    expect(await slotOf(after.id)).toBe(sAfter);

    const list = await servicesRoute.GET(req("http://t/api/travel/catalog/services?category=GUIDES"));
    const names = (await list.json()).map((s: { name: string }) => s.name);
    expect(names).toContain("Guide Two");
    expect(names.indexOf("Guide Two")).toBeLessThan(names.indexOf("Guide One"));
  });
});
