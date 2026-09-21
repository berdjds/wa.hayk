/**
 * QA: below-floor issuance rules (item 11, workflow side).
 *
 * The engine's round-up stage rarely emits BELOW_FLOOR (policy.ts), so these
 * tests inject the issue into a real snapshot's resultJson to exercise the
 * issue() guards:
 * - a BELOW_FLOOR blocker blocks APPROVE (ENGINE_INVALID);
 * - with only the warning form, issuing requires a manager (ADMIN) and a
 *   recorded reason;
 * - the exception binds to the exact snapshot: a new version needs its own
 *   approval and cannot be issued under the old one.
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
let fx: Fixtures;

beforeAll(async () => {
  ensureSchema();
  prisma = await getPrisma();
  workflow = await import("@/lib/travel/workflow");
  fx = await seedFixtures(prisma);
});

async function pendingVersion() {
  const { request, version } = await workflow.createRequest(actorOf(fx.advisor), createRequestInput(fx.agency.id));
  await saveContent(prisma, actorOf(fx.advisor), request.id, version.id, scenarioContent(fx.hotel.id, fx.hotel.name));
  await workflow.assignValidator(actorOf(fx.advisor), request.id, { validatorId: fx.validator.id });
  const { hash } = await workflow.submit(actorOf(fx.advisor), request.id);
  return { request, version, hash };
}

/** Adds a BELOW_FLOOR issue to the stored snapshot result (severity as given). */
async function injectBelowFloor(versionId: string, severity: "BLOCKER" | "WARNING") {
  const snap = await prisma.calculationSnapshot.findUnique({ where: { versionId } });
  const result = JSON.parse(snap!.resultJson);
  result.issues.push({
    code: "BELOW_FLOOR",
    severity,
    scenarioRef: result.scenarios[0].ref,
    message: "sell below floor (injected QA fixture)",
  });
  result.scenarios[0].issues.push(result.issues[result.issues.length - 1]);
  await prisma.calculationSnapshot.update({
    where: { versionId },
    data: { resultJson: JSON.stringify(result) },
  });
}

describe("below-floor issuance", () => {
  it("a BELOW_FLOOR blocker prevents approval", async () => {
    const { version, hash } = await pendingVersion();
    await injectBelowFloor(version.id, "BLOCKER");
    await expect(
      workflow.review(actorOf(fx.validator), version.id, { action: "APPROVE", snapshotHash: hash }),
    ).rejects.toMatchObject({ code: "ENGINE_INVALID", httpStatus: 400 });
  });

  it("warning-form BELOW_FLOOR requires a manager and a reason at issue time", async () => {
    const { request, version, hash } = await pendingVersion();
    await injectBelowFloor(version.id, "WARNING");
    await workflow.review(actorOf(fx.validator), version.id, { action: "APPROVE", snapshotHash: hash });

    // The owning advisor (not a manager) cannot issue below floor.
    await expect(workflow.issue(actorOf(fx.advisor), version.id, {})).rejects.toMatchObject({
      code: "FLOOR_EXCEPTION_FORBIDDEN",
      httpStatus: 403,
    });
    // The validator cannot either (not owner, not manager).
    await expect(workflow.issue(actorOf(fx.validator), version.id, {})).rejects.toMatchObject({
      code: "FORBIDDEN",
      httpStatus: 403,
    });
    // A manager without a reason is refused.
    await expect(workflow.issue(actorOf(fx.admin), version.id, {})).rejects.toMatchObject({
      code: "FLOOR_EXCEPTION_REASON_REQUIRED",
      httpStatus: 400,
    });
    // A manager with a recorded reason issues; the exception is audited.
    const issued = await workflow.issue(actorOf(fx.admin), version.id, {
      belowFloorExceptionReason: "strategic client, approved by director",
    });
    expect(issued.idempotent).toBe(false);
    const audit = await prisma.log.findFirst({
      where: { action: "QUOTE_ISSUED", details: { contains: "BELOW_FLOOR exception" } },
    });
    expect(audit?.details).toContain(request.packageCode);

    // The exception bound to THIS snapshot does not leak into a revision:
    // v02 starts unapproved and cannot be issued.
    const v2 = await workflow.createRevision(actorOf(fx.advisor), request.id);
    await expect(workflow.issue(actorOf(fx.admin), v2.id, { belowFloorExceptionReason: "same" })).rejects.toMatchObject({
      code: "INVALID_STATE",
      httpStatus: 409,
    });
  });
});
