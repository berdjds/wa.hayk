/**
 * QA: snapshot immutability (item 12).
 *
 * After a version is approved and issued, mutating master data (hotel rate,
 * FX, agency name) must change a FRESH resolution/calculation but must leave
 * the stored snapshot (inputsJson/resultJson/hash) and the issued document's
 * hash byte-identical. Re-issuing stays idempotent.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { ensureSchema, getPrisma } from "../travel-db/helpers";
import { actorOf, createRequestInput, saveContent, scenarioContent, seedFixtures, type Fixtures } from "../workflow/fixtures";

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => ({ providerId: "smtp-test" })) }));
vi.mock("@/lib/whatsapp", () => ({
  sendWhatsAppMessage: vi.fn(async () => ({ id: { _serialized: "wa-test" } })),
}));
vi.mock("@/lib/travel/pdf/render", () => ({
  renderQuotationPdf: vi.fn(async () => Buffer.from("%PDF-1.4 fake")),
}));

let prisma: PrismaClient;
let workflow: typeof import("@/lib/travel/workflow");
let resolve: typeof import("@/lib/travel/resolve");
let engine: typeof import("@/lib/travel/engine");
let fx: Fixtures;

beforeAll(async () => {
  ensureSchema();
  prisma = await getPrisma();
  workflow = await import("@/lib/travel/workflow");
  resolve = await import("@/lib/travel/resolve");
  engine = await import("@/lib/travel/engine");
  fx = await seedFixtures(prisma);
});

describe("issued snapshots are immutable against master-data drift", () => {
  it("rate/FX/agency changes alter recalculation but never the stored snapshot or document", async () => {
    const { request, version } = await workflow.createRequest(actorOf(fx.advisor), createRequestInput(fx.agency.id));
    await saveContent(prisma, actorOf(fx.advisor), request.id, version.id, scenarioContent(fx.hotel.id, fx.hotel.name));
    await workflow.assignValidator(actorOf(fx.advisor), request.id, { validatorId: fx.validator.id });
    const { hash } = await workflow.submit(actorOf(fx.advisor), request.id);
    await workflow.review(actorOf(fx.validator), version.id, { action: "APPROVE", snapshotHash: hash });
    const issued = await workflow.issue(actorOf(fx.advisor), version.id, {});

    const snapshotBefore = await prisma.calculationSnapshot.findUnique({ where: { versionId: version.id } });
    const docBefore = await prisma.quoteDocument.findUnique({ where: { id: issued.document.id } });
    const resultBefore = JSON.parse(snapshotBefore!.resultJson);
    const sellBefore = resultBefore.scenarios[0].sell;
    // Fixture: 3 nights × 100 USD, FX 365, markup 14% → sell 342.
    expect(sellBefore).toBe("342");

    // --- Mutate master data --------------------------------------------------
    await prisma.rateVersion.updateMany({
      where: { hotelProductId: fx.hotel.id },
      data: { amount: "999" },
    });
    await prisma.fXRateVersion.create({
      data: { currency: "USD", amdPerUnit: "500", effectiveFrom: "2026-06-01" },
    });
    await prisma.agency.update({
      where: { id: fx.agency.id },
      data: { name: "Acme Travel (renamed)" },
    });

    // --- A fresh resolution + calculation sees the new masters ----------------
    const fresh = engine.calculate(await resolve.buildEngineInputForVersion(version.id));
    const sellAfter = fresh.scenarios[0].sell;
    // 3 × 999 USD = 2997 cost; markup 14% → 3416.58 → roundUp 3417.
    expect(sellAfter).toBe("3417");
    expect(sellAfter).not.toBe(sellBefore);

    // --- The stored snapshot is byte-identical ---------------------------------
    const snapshotAfter = await prisma.calculationSnapshot.findUnique({ where: { versionId: version.id } });
    expect(snapshotAfter!.resultJson).toBe(snapshotBefore!.resultJson);
    expect(snapshotAfter!.inputsJson).toBe(snapshotBefore!.inputsJson);
    expect(snapshotAfter!.hash).toBe(hash);

    // --- The issued document row and hash are untouched; re-issue idempotent ---
    const docAfter = await prisma.quoteDocument.findUnique({ where: { id: issued.document.id } });
    expect(docAfter!.sha256).toBe(docBefore!.sha256);
    expect(docAfter!.snapshotHash).toBe(hash);
    const replay = await workflow.issue(actorOf(fx.advisor), version.id, {});
    expect(replay.idempotent).toBe(true);
    expect(replay.document.sha256).toBe(docBefore!.sha256);
  });
});
