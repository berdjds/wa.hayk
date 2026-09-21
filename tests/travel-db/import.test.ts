import path from "path";
import { beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { ensureSchema, getPrisma } from "./helpers";

const EVIDENCE_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "doc",
  "travel",
  "Workbook-Evidence.json",
);
const IDEMPOTENCY_KEY = "test-workbook-evidence";

let prisma: PrismaClient;
let importer: typeof import("@/lib/travel/import");

beforeAll(async () => {
  ensureSchema();
  prisma = await getPrisma();
  importer = await import("@/lib/travel/import");
});

describe("stageWorkbookEvidence", () => {
  it("stages all workbook sections on first run", async () => {
    const result = await importer.stageWorkbookEvidence(EVIDENCE_PATH, {
      idempotencyKey: IDEMPOTENCY_KEY,
    });
    expect(result.skipped).toBe(false);
    expect(result.rows).toBeGreaterThan(0);

    const counts = await prisma.importRow.groupBy({
      by: ["entityType"],
      where: { batchId: result.batchId },
      _count: { _all: true },
    });
    const byType = Object.fromEntries(counts.map((c) => [c.entityType, c._count._all]));
    // 34 hotel rows (plan §3.1), 4 occupancy columns each minus cottages
    // still staged per column, 89 service rows, 18 Georgia bands, 13 templates.
    expect(byType.HOTEL).toBe(34);
    expect(byType.RATE).toBe(136);
    expect(byType.SERVICE).toBe(89);
    expect(byType.GEORGIA_BAND).toBe(18);
    expect(byType.TEMPLATE).toBe(13);
  });

  it("is idempotent: same key returns the same batch with skipped=true and no duplicates", async () => {
    const first = await importer.stageWorkbookEvidence(EVIDENCE_PATH, {
      idempotencyKey: IDEMPOTENCY_KEY,
    });
    const rowsAfterFirst = await prisma.importRow.count({ where: { batchId: first.batchId } });

    const second = await importer.stageWorkbookEvidence(EVIDENCE_PATH, {
      idempotencyKey: IDEMPOTENCY_KEY,
    });
    expect(second.batchId).toBe(first.batchId);
    expect(second.skipped).toBe(true);
    expect(second.rows).toBe(rowsAfterFirst);

    const batches = await prisma.importBatch.count({
      where: { idempotencyKey: IDEMPOTENCY_KEY },
    });
    expect(batches).toBe(1);
  });

  it("stages the misclassified staff meal under STAFF_MEALS with a note", async () => {
    const row = await prisma.importRow.findFirst({
      where: { entityType: "SERVICE", sourceRef: "Tour Calculator!C149" },
    });
    expect(row).not.toBeNull();
    const normalized = JSON.parse(row!.normalizedJson!);
    expect(normalized.category).toBe("STAFF_MEALS");
    expect(row!.issueText).toMatch(/misclassified/i);
  });

  it("marks TBC hotel rates with an issue and null amount", async () => {
    // Tour Calculator!E7 (Holiday Inn Express TPL) is "TBC".
    const row = await prisma.importRow.findFirst({
      where: { entityType: "RATE", sourceRef: "Tour Calculator!E7" },
    });
    expect(row).not.toBeNull();
    const normalized = JSON.parse(row!.normalizedJson!);
    expect(normalized.amount).toBeNull();
    expect(row!.issueText).toBe("TBC rate — needs supplier verification");
  });

  it("stages templates verbatim, including the ARMGG typo and legacy markup", async () => {
    const row = await prisma.importRow.findFirst({
      where: { entityType: "TEMPLATE", sourceRef: "Mass Calculation!A109" },
    });
    expect(row).not.toBeNull();
    const normalized = JSON.parse(row!.normalizedJson!);
    expect(normalized.code).toBe("ARMGG-S26-0506A");
    expect(normalized.legacyMarkup).toBe("0.16");
    expect(normalized.provenance).toBe("Mass Calculation row 109");
    expect(normalized.dayNarratives.length).toBe(6);
  });

  it("never evaluates formulas but keeps them as evidence", async () => {
    // Tour Calculator!F8 is =5000+10000 with cached value 15000 (plan §3.1).
    const row = await prisma.importRow.findFirst({
      where: { entityType: "RATE", sourceRef: "Tour Calculator!F8" },
    });
    const raw = JSON.parse(row!.rawJson);
    expect(raw["F8"].formula).toBe("=5000+10000");
    const normalized = JSON.parse(row!.normalizedJson!);
    expect(normalized.amount).toBe("15000");
    expect(normalized.formulaDerived).toBe("=5000+10000");
  });
});

describe("isNumeric (shared non-negative-decimal predicate)", () => {
  it("accepts integers and decimals, trims whitespace, rejects the rest", () => {
    expect(importer.isNumeric("24000")).toBe(true);
    expect(importer.isNumeric("24000.50")).toBe(true); // decimals — the seed used to drop these
    expect(importer.isNumeric(" 100 ")).toBe(true);
    expect(importer.isNumeric(null)).toBe(false);
    expect(importer.isNumeric("TBC")).toBe(false);
    expect(importer.isNumeric("-5")).toBe(false);
    expect(importer.isNumeric("1e3")).toBe(false);
  });
});
