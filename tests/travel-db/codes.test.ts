import { beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { ensureSchema, getPrisma } from "./helpers";

let prisma: PrismaClient;
let codes: typeof import("@/lib/travel/codes");

beforeAll(async () => {
  ensureSchema();
  prisma = await getPrisma();
  codes = await import("@/lib/travel/codes");
});

async function makeAgency(shortCode: string) {
  return prisma.agency.create({
    data: { shortCode, name: `${shortCode} Test Agency` },
  });
}

describe("generatePackageCode", () => {
  it("formats CLIENTSHORT-YYYY-MM-DD-NNNN", async () => {
    const agency = await makeAgency("ACME");
    const code = await codes.generatePackageCode(agency.id, { date: "2026-09-21" });
    expect(code).toBe("ACME-2026-09-21-0001");
  });

  it("increments sequentially for the same agency and day", async () => {
    const agency = await makeAgency("SEQ");
    const first = await codes.generatePackageCode(agency.id, { date: "2026-09-21" });
    const second = await codes.generatePackageCode(agency.id, { date: "2026-09-21" });
    expect(first).toBe("SEQ-2026-09-21-0001");
    expect(second).toBe("SEQ-2026-09-21-0002");
  });

  it("keeps independent sequences per agency", async () => {
    const a = await makeAgency("AGA");
    const b = await makeAgency("AGB");
    expect(await codes.generatePackageCode(a.id, { date: "2026-09-21" })).toBe("AGA-2026-09-21-0001");
    expect(await codes.generatePackageCode(b.id, { date: "2026-09-21" })).toBe("AGB-2026-09-21-0001");
  });

  it("keeps independent sequences per day", async () => {
    const agency = await makeAgency("DAY");
    expect(await codes.generatePackageCode(agency.id, { date: "2026-09-21" })).toBe("DAY-2026-09-21-0001");
    expect(await codes.generatePackageCode(agency.id, { date: "2026-09-22" })).toBe("DAY-2026-09-22-0001");
  });

  it("does not truncate the sequence beyond 9999", async () => {
    const agency = await makeAgency("BIG");
    await prisma.packageCodeCounter.create({
      data: { agencyId: agency.id, dateKey: "2026-09-21", lastSeq: 9999 },
    });
    const code = await codes.generatePackageCode(agency.id, { date: "2026-09-21" });
    expect(code).toBe("BIG-2026-09-21-10000");
  });

  it("produces 10 unique codes for 10 concurrent requests", async () => {
    const agency = await makeAgency("RACE");
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        codes.generatePackageCode(agency.id, { date: "2026-09-21" }),
      ),
    );
    expect(new Set(results).size).toBe(10);
    const seqs = results
      .map((c) => codes.parsePackageCode(c)?.seq)
      .sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("throws a structured error for a missing agency", async () => {
    await expect(
      codes.generatePackageCode("no-such-agency", { date: "2026-09-21" }),
    ).rejects.toMatchObject({ name: "PackageCodeError", code: "AGENCY_NOT_FOUND" });
  });
});

describe("parsePackageCode", () => {
  it("round-trips a generated code", () => {
    expect(codes.parsePackageCode("ACME-2026-09-21-0001")).toEqual({
      shortCode: "ACME",
      dateKey: "2026-09-21",
      seq: 1,
    });
  });

  it("accepts sequences wider than 4 digits", () => {
    expect(codes.parsePackageCode("ACME-2026-09-21-10000")?.seq).toBe(10000);
  });

  it("returns null for malformed codes", () => {
    expect(codes.parsePackageCode("not-a-code")).toBeNull();
    expect(codes.parsePackageCode("ACME-2026-09-21-001")).toBeNull();
  });
});
