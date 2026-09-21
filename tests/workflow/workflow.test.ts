/**
 * End-to-end workflow tests against a throwaway SQLite database.
 * Email / WhatsApp / PDF senders are mocked — no real sends, no Chromium.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { ensureSchema, getPrisma } from "../travel-db/helpers";
import {
  END_DATE,
  Fixtures,
  TRAVELERS,
  actorOf,
  createRequestInput,
  saveContent,
  scenarioContent,
  seedFixtures,
} from "./fixtures";

vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn(async () => ({ providerId: "smtp-test" })),
}));
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

/** Creates a request with resolvable content and an assigned validator. */
async function draftWithContent() {
  const { request, version } = await workflow.createRequest(actorOf(fx.advisor), createRequestInput(fx.agency.id));
  await saveContent(prisma, actorOf(fx.advisor), request.id, version.id, scenarioContent(fx.hotel.id, fx.hotel.name));
  await workflow.assignValidator(actorOf(fx.advisor), request.id, { validatorId: fx.validator.id });
  return { request, version };
}

describe("createRequest", () => {
  it("creates request + v1 DRAFT with a valid package code", async () => {
    const { request, version } = await workflow.createRequest(actorOf(fx.advisor), createRequestInput(fx.agency.id));
    expect(request.packageCode).toMatch(/^ACME-\d{4}-\d{2}-\d{2}-\d{4}$/);
    expect(request.status).toBe("DRAFT");
    expect(version.versionNo).toBe(1);
    expect(version.status).toBe("DRAFT");
    const scenario = await prisma.scenario.findFirst({ where: { versionId: version.id }, include: { stays: true } });
    expect(scenario?.label).toBe("Option A");
    expect(scenario?.stays[0].checkIn).toBe(request.startDate);
    expect(scenario?.stays[0].checkOut).toBe(request.endDate);
  });

  it("rejects a missing agency and non-advisor roles", async () => {
    await expect(
      workflow.createRequest(actorOf(fx.advisor), createRequestInput("no-such-agency")),
    ).rejects.toMatchObject({ code: "AGENCY_NOT_FOUND" });
    await expect(
      workflow.createRequest(actorOf(fx.validator), createRequestInput(fx.agency.id)),
    ).rejects.toMatchObject({ code: "FORBIDDEN", httpStatus: 403 });
  });

  it("accepts childAges matching the child count and stores them", async () => {
    const { request } = await workflow.createRequest(actorOf(fx.advisor), {
      ...createRequestInput(fx.agency.id),
      travelers: { ...TRAVELERS, adults: 2, children: 2, childAges: [4, 7], paying: 4 },
    });
    const stored = JSON.parse(request.travelers);
    expect(stored.childAges).toEqual([4, 7]);
  });

  it("rejects childAges that do not list one age per child", async () => {
    // ZodError at the schema boundary (routes map it to 400); the function
    // re-parses defensively, so the rejection surfaces here too.
    await expect(
      workflow.createRequest(actorOf(fx.advisor), {
        ...createRequestInput(fx.agency.id),
        travelers: { ...TRAVELERS, children: 2, childAges: [5], paying: 3 },
      }),
    ).rejects.toThrow("childAges must list one age per child");
  });

  it("accepts a child aged 12 (inclusive upper bound)", async () => {
    const { request } = await workflow.createRequest(actorOf(fx.advisor), {
      ...createRequestInput(fx.agency.id),
      travelers: { ...TRAVELERS, children: 1, childAges: [12], paying: 3 },
    });
    expect(JSON.parse(request.travelers).childAges).toEqual([12]);
  });

  it("rejects child ages above 12", async () => {
    for (const age of [13, 18]) {
      await expect(
        workflow.createRequest(actorOf(fx.advisor), {
          ...createRequestInput(fx.agency.id),
          travelers: { ...TRAVELERS, children: 1, childAges: [age], paying: 3 },
        }),
      ).rejects.toThrow();
    }
  });
});

describe("happy path: draft → submit → approve → issue → accept", () => {
  it("runs the full cycle with snapshot, events and document", async () => {
    const { request, version } = await draftWithContent();

    // Submit: engine runs, snapshot is stored, validator + owner notified.
    const submitted = await workflow.submit(actorOf(fx.advisor), request.id);
    expect(submitted.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(submitted.result.valid).toBe(true);
    let v = await prisma.quoteVersion.findUnique({ where: { id: version.id }, include: { snapshot: true } });
    expect(v?.status).toBe("PENDING_VALIDATION");
    expect(v?.submittedById).toBe(fx.advisor.id);
    expect(v?.snapshot?.hash).toBe(submitted.hash);

    const submitEvent = await prisma.workflowEvent.findFirst({
      where: { requestId: request.id, type: "SUBMITTED" },
      include: { deliveries: true },
    });
    expect(submitEvent).toBeTruthy();
    // owner + validator, EMAIL + WHATSAPP each
    expect(submitEvent?.deliveries).toHaveLength(4);
    expect(submitEvent?.deliveries.every((d) => d.status === "QUEUED")).toBe(true);

    // Approve by the assigned validator, bound to the exact snapshot hash.
    const approved = await workflow.review(actorOf(fx.validator), version.id, {
      action: "APPROVE",
      snapshotHash: submitted.hash,
    });
    expect(approved.status).toBe("APPROVED");

    // Issue: status + document + ISSUED event in one transaction; mocked PDF.
    const issued = await workflow.issue(actorOf(fx.advisor), version.id, {});
    expect(issued.idempotent).toBe(false);
    expect(issued.document.kind).toBe("CLIENT");
    expect(issued.document.idempotencyKey).toBe(`issue-${version.id}`);
    expect(issued.document.filePath.endsWith(".pdf")).toBe(true);
    expect(issued.document.sha256).toMatch(/^[0-9a-f]{64}$/);
    const issuedV = await prisma.quoteVersion.findUnique({ where: { id: version.id } });
    expect(issuedV?.status).toBe("ISSUED");
    expect(await prisma.workflowEvent.count({ where: { requestId: request.id, type: "ISSUED" } })).toBe(1);

    // Accept with a scenario that belongs to the version.
    const scenario = await prisma.scenario.findFirst({ where: { versionId: version.id } });
    const outcome = await workflow.recordOutcome(actorOf(fx.advisor), version.id, {
      outcome: "ACCEPTED",
      scenarioId: scenario!.id,
    });
    expect(outcome.status).toBe("ACCEPTED");
    const acceptedV = await prisma.quoteVersion.findUnique({ where: { id: version.id } });
    expect(acceptedV?.outcomeScenarioId).toBe(scenario!.id);
  });
});

describe("review rules", () => {
  it("blocks self-approval", async () => {
    // Admin owns AND validates this request.
    const { request, version } = await workflow.createRequest(actorOf(fx.admin), createRequestInput(fx.agency.id));
    await saveContent(prisma, actorOf(fx.admin), request.id, version.id, scenarioContent(fx.hotel.id, fx.hotel.name));
    await workflow.assignValidator(actorOf(fx.admin), request.id, { validatorId: fx.admin.id });
    const { hash } = await workflow.submit(actorOf(fx.admin), request.id);
    await expect(
      workflow.review(actorOf(fx.admin), version.id, { action: "APPROVE", snapshotHash: hash }),
    ).rejects.toMatchObject({ code: "SELF_APPROVAL", httpStatus: 403 });
  });

  it("blocks a validator who is not the active assignee", async () => {
    const { request, version } = await draftWithContent();
    const { hash } = await workflow.submit(actorOf(fx.advisor), request.id);
    await expect(
      workflow.review(actorOf(fx.validator2), version.id, { action: "APPROVE", snapshotHash: hash }),
    ).rejects.toMatchObject({ code: "NOT_ASSIGNED_VALIDATOR", httpStatus: 403 });
  });

  it("revokes the former validator's decision rights on reassign", async () => {
    const { request, version } = await draftWithContent();
    const { hash } = await workflow.submit(actorOf(fx.advisor), request.id);
    await workflow.reassign(actorOf(fx.admin), request.id, { validatorId: fx.validator2.id });
    await expect(
      workflow.review(actorOf(fx.validator), version.id, { action: "APPROVE", snapshotHash: hash }),
    ).rejects.toMatchObject({ code: "NOT_ASSIGNED_VALIDATOR" });
    // The new validator can decide.
    const res = await workflow.review(actorOf(fx.validator2), version.id, { action: "APPROVE", snapshotHash: hash });
    expect(res.status).toBe("APPROVED");
    const event = await prisma.workflowEvent.findFirst({ where: { requestId: request.id, type: "REASSIGNED" } });
    expect(event).toBeTruthy();
  });

  it("requires a reason for REQUEST_CHANGES and emits RESUBMITTED after rework", async () => {
    const { request, version } = await draftWithContent();
    const { hash } = await workflow.submit(actorOf(fx.advisor), request.id);
    await expect(
      workflow.review(actorOf(fx.validator), version.id, { action: "REQUEST_CHANGES", snapshotHash: hash }),
    ).rejects.toMatchObject({ code: "REASON_REQUIRED", httpStatus: 400 });

    const res = await workflow.review(actorOf(fx.validator), version.id, {
      action: "REQUEST_CHANGES",
      reason: "Fix the board basis",
      snapshotHash: hash,
    });
    expect(res.status).toBe("CHANGES_REQUESTED");

    // Advisor edits content (snapshot invalidated) and resubmits.
    await saveContent(prisma, actorOf(fx.advisor), request.id, version.id, scenarioContent(fx.hotel.id, fx.hotel.name));
    expect(await prisma.calculationSnapshot.findUnique({ where: { versionId: version.id } })).toBeNull();
    await workflow.submit(actorOf(fx.advisor), request.id);
    expect(await prisma.workflowEvent.count({ where: { requestId: request.id, type: "RESUBMITTED" } })).toBe(1);
  });

  it("rejects a stale snapshot hash with 409", async () => {
    const { request, version } = await draftWithContent();
    await workflow.submit(actorOf(fx.advisor), request.id);
    await expect(
      workflow.review(actorOf(fx.validator), version.id, { action: "APPROVE", snapshotHash: "0".repeat(64) }),
    ).rejects.toMatchObject({ code: "SNAPSHOT_STALE", httpStatus: 409 });
  });
});

describe("draft editing and revisions", () => {
  it("blocks material edits once approved and revisions keep the package code", async () => {
    const { request, version } = await draftWithContent();
    const { hash } = await workflow.submit(actorOf(fx.advisor), request.id);
    await workflow.review(actorOf(fx.validator), version.id, { action: "APPROVE", snapshotHash: hash });

    await expect(
      saveContent(prisma, actorOf(fx.advisor), request.id, version.id, scenarioContent(fx.hotel.id, fx.hotel.name)),
    ).rejects.toMatchObject({ code: "INVALID_STATE", httpStatus: 409 });
    await expect(
      workflow.updateDraft(actorOf(fx.advisor), request.id, 999, { title: "nope" }),
    ).rejects.toMatchObject({ code: "INVALID_STATE" });

    // Revision clones content into v02 DRAFT; code and snapshot rules hold.
    const v2 = await workflow.createRevision(actorOf(fx.advisor), request.id);
    expect(v2.versionNo).toBe(2);
    expect(v2.status).toBe("DRAFT");
    const stays = await prisma.staySegment.count({ where: { scenario: { versionId: v2.id } } });
    expect(stays).toBe(1);
    expect(await prisma.calculationSnapshot.findUnique({ where: { versionId: v2.id } })).toBeNull();
    const r = await prisma.travelRequest.findUnique({ where: { id: request.id } });
    expect(r?.packageCode).toBe(request.packageCode);
    expect(r?.status).toBe("DRAFT");
  });

  it("enforces optimistic locking on draft updates", async () => {
    const { request } = await draftWithContent();
    const current = await prisma.travelRequest.findUnique({ where: { id: request.id } });
    const updated = await workflow.updateDraft(actorOf(fx.advisor), request.id, current!.revision, { title: "New title" });
    expect(updated?.revision).toBe(current!.revision + 1);
    await expect(
      workflow.updateDraft(actorOf(fx.advisor), request.id, current!.revision, { title: "stale" }),
    ).rejects.toMatchObject({ code: "CONFLICT", httpStatus: 409 });
  });
});

describe("issue", () => {
  it("is idempotent on the idempotency key", async () => {
    const { request, version } = await draftWithContent();
    const { hash } = await workflow.submit(actorOf(fx.advisor), request.id);
    await workflow.review(actorOf(fx.validator), version.id, { action: "APPROVE", snapshotHash: hash });

    const first = await workflow.issue(actorOf(fx.advisor), version.id, { idempotencyKey: "key-1" });
    const second = await workflow.issue(actorOf(fx.advisor), version.id, { idempotencyKey: "key-1" });
    expect(second.idempotent).toBe(true);
    expect(second.document.id).toBe(first.document.id);
    expect(await prisma.workflowEvent.count({ where: { requestId: request.id, type: "ISSUED" } })).toBe(1);
    expect(await prisma.quoteDocument.count({ where: { versionId: version.id } })).toBe(1);
  });

  it("refuses to issue without approval", async () => {
    const { request, version } = await draftWithContent();
    await workflow.submit(actorOf(fx.advisor), request.id);
    await expect(workflow.issue(actorOf(fx.advisor), version.id, {})).rejects.toMatchObject({
      code: "INVALID_STATE",
      httpStatus: 409,
    });
  });

  it("refuses to issue when settings are incomplete", async () => {
    const { request, version } = await draftWithContent();
    const { hash } = await workflow.submit(actorOf(fx.advisor), request.id);
    await workflow.review(actorOf(fx.validator), version.id, { action: "APPROVE", snapshotHash: hash });

    await prisma.pricingPolicyVersion.updateMany({ data: { active: false } });
    await expect(workflow.issue(actorOf(fx.advisor), version.id, {})).rejects.toMatchObject({
      code: "SETTINGS_INCOMPLETE",
    });
    await prisma.pricingPolicyVersion.update({ where: { id: fx.policy.id }, data: { active: true } });
  });
});
