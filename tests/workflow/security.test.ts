/**
 * Workflow-layer security fixes:
 * - override attribution is stamped server-side (client overrideById /
 *   rateOverrides[].actorId are ignored) and an override rate requires a
 *   non-empty reason at schema level;
 * - saveVersionContent carries an optimistic lock (expectedRevision);
 * - inactive agencies cannot get new requests (AGENCY_INACTIVE);
 * - recordOutcome is race-safe (one winner, loser 409);
 * - an idempotency key reused on ANOTHER version conflicts (409);
 * - money strings are validated at the zod boundary.
 *
 * All senders/PDF are mocked — nothing leaves the process.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { ensureSchema, getPrisma } from "../travel-db/helpers";
import {
  actorOf,
  createRequestInput,
  saveContent,
  scenarioContent,
  seedFixtures,
  type Fixtures,
} from "./fixtures";

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

async function draft() {
  const { request, version } = await workflow.createRequest(actorOf(fx.advisor), createRequestInput(fx.agency.id));
  await saveContent(prisma, actorOf(fx.advisor), request.id, version.id, scenarioContent(fx.hotel.id, fx.hotel.name));
  return { request, version };
}

describe("override attribution (server-stamped)", () => {
  it("client-supplied overrideById / rateOverrides[].actorId are ignored", async () => {
    const { request, version } = await draft();
    const content = scenarioContent(fx.hotel.id, fx.hotel.name);
    // Forge attribution: the client claims someone else made the override.
    (content.scenarios[0].stays[0] as any).rateOverrides = {
      DBL: { rate: "120", reason: "negotiated", actorId: "someone-else" },
    };
    await saveContent(prisma, actorOf(fx.advisor), request.id, version.id, {
      ...content,
      serviceLines: [
        {
          scenarioKey: "A",
          category: "TICKETS",
          label: "Ticket",
          basis: "GROUP",
          currency: "AMD",
          unitRate: "1000",
          quantity: "1",
          overrideRate: "900",
          overrideReason: "vip rate",
          overrideById: "someone-else",
        } as any,
      ],
    });
    const stay = await prisma.staySegment.findFirst({ where: { scenario: { versionId: version.id } } });
    const overrides = JSON.parse(stay!.rateOverrides!);
    expect(overrides.DBL.actorId).toBe(fx.advisor.id);
    const line = await prisma.serviceLine.findFirst({ where: { versionId: version.id } });
    expect(line!.overrideById).toBe(fx.advisor.id);
  });

  it("an override rate without a reason fails schema validation", async () => {
    const { request, version } = await draft();
    await expect(
      saveContent(prisma, actorOf(fx.advisor), request.id, version.id, {
        serviceLines: [
          {
            scenarioKey: null,
            category: "TICKETS",
            label: "Ticket",
            basis: "GROUP",
            currency: "AMD",
            unitRate: "1000",
            quantity: "1",
            overrideRate: "900",
            overrideReason: "   ",
          } as any,
        ],
      }),
    ).rejects.toThrowError(/overrideReason/);

    const stayContent = scenarioContent(fx.hotel.id, fx.hotel.name);
    (stayContent.scenarios[0].stays[0] as any).rateOverrides = { DBL: { rate: "120", reason: "  " } };
    await expect(
      saveContent(prisma, actorOf(fx.advisor), request.id, version.id, stayContent),
    ).rejects.toThrow();
  });
});

describe("saveVersionContent optimistic lock", () => {
  it("a stale expectedRevision conflicts with 409; the current one succeeds", async () => {
    const { request, version } = await draft();
    const current = await prisma.travelRequest.findUnique({ where: { id: request.id } });
    // draft() saved once already — revision moved past the stale value.
    await expect(
      workflow.saveVersionContent(actorOf(fx.advisor), version.id, {
        expectedRevision: current!.revision - 1,
        ...scenarioContent(fx.hotel.id, fx.hotel.name),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", httpStatus: 409 });

    const saved = await workflow.saveVersionContent(actorOf(fx.advisor), version.id, {
      expectedRevision: current!.revision,
      ...scenarioContent(fx.hotel.id, fx.hotel.name),
    });
    expect(saved?.id).toBe(version.id);
    const after = await prisma.travelRequest.findUnique({ where: { id: request.id } });
    expect(after!.revision).toBe(current!.revision + 1);
  });

  it("missing expectedRevision is a 400-level schema error", async () => {
    const { version } = await draft();
    await expect(
      workflow.saveVersionContent(actorOf(fx.advisor), version.id, scenarioContent(fx.hotel.id, fx.hotel.name) as any),
    ).rejects.toThrow();
  });
});

describe("money strings at the zod boundary", () => {
  it("rejects hex/scientific/negative unitRate and garbage quantity", async () => {
    const { request, version } = await draft();
    const mk = (unitRate: string, quantity = "1") => ({
      serviceLines: [
        { scenarioKey: null, category: "TICKETS", label: "T", basis: "GROUP", currency: "AMD", unitRate, quantity },
      ],
    });
    for (const bad of ["-5", "1e3", "0x10", "abc"]) {
      await expect(
        saveContent(prisma, actorOf(fx.advisor), request.id, version.id, mk(bad) as any),
      ).rejects.toThrow();
    }
    await expect(
      saveContent(prisma, actorOf(fx.advisor), request.id, version.id, mk("100", "1,5") as any),
    ).rejects.toThrow();
    // " 100 " trims to a valid decimal and saves.
    await expect(
      saveContent(prisma, actorOf(fx.advisor), request.id, version.id, mk(" 100 ") as any),
    ).resolves.toBeTruthy();
  });

  it("rejects oversized payloads (caps)", async () => {
    const { request, version } = await draft();
    const many = Array.from({ length: 11 }, (_, i) => ({
      key: `S${i}`,
      label: `Scenario ${i}`,
      stays: [],
    }));
    await expect(
      saveContent(prisma, actorOf(fx.advisor), request.id, version.id, { scenarios: many } as any),
    ).rejects.toThrow();
    const huge = scenarioContent(fx.hotel.id, fx.hotel.name);
    huge.scenarios[0].label = "x".repeat(201);
    await expect(
      saveContent(prisma, actorOf(fx.advisor), request.id, version.id, huge),
    ).rejects.toThrow();
  });
});

describe("createRequest agency rules", () => {
  it("rejects an inactive agency with AGENCY_INACTIVE (400)", async () => {
    const inactive = await prisma.agency.create({
      data: { shortCode: "DEAD", name: "Defunct Travel", active: false },
    });
    await expect(
      workflow.createRequest(actorOf(fx.advisor), createRequestInput(inactive.id)),
    ).rejects.toMatchObject({ code: "AGENCY_INACTIVE", httpStatus: 400 });
  });
});

describe("recordOutcome race safety", () => {
  it("two concurrent outcomes: one wins, the loser gets 409", async () => {
    const { request, version } = await draft();
    await workflow.assignValidator(actorOf(fx.advisor), request.id, { validatorId: fx.validator.id });
    const { hash } = await workflow.submit(actorOf(fx.advisor), request.id);
    await workflow.review(actorOf(fx.validator), version.id, { action: "APPROVE", snapshotHash: hash });
    await workflow.issue(actorOf(fx.advisor), version.id, {});
    const scenario = await prisma.scenario.findFirst({ where: { versionId: version.id } });

    const race = await Promise.allSettled([
      workflow.recordOutcome(actorOf(fx.advisor), version.id, { outcome: "ACCEPTED", scenarioId: scenario!.id }),
      workflow.recordOutcome(actorOf(fx.advisor), version.id, { outcome: "DECLINED" }),
    ]);
    const ok = race.filter((r) => r.status === "fulfilled");
    const lost = race.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(lost[0].reason).toMatchObject({ code: "INVALID_STATE", httpStatus: 409 });
    const events = await prisma.workflowEvent.count({ where: { requestId: request.id, type: "OUTCOME_RECORDED" } });
    expect(events).toBe(1);
  });
});

describe("issue idempotency scoping", () => {
  it("an idempotency key used on ANOTHER version → 409 IDEMPOTENCY_CONFLICT", async () => {
    const { request, version } = await draft();
    await workflow.assignValidator(actorOf(fx.advisor), request.id, { validatorId: fx.validator.id });
    const { hash } = await workflow.submit(actorOf(fx.advisor), request.id);
    await workflow.review(actorOf(fx.validator), version.id, { action: "APPROVE", snapshotHash: hash });
    const first = await workflow.issue(actorOf(fx.advisor), version.id, { idempotencyKey: "shared-key" });
    expect(first.idempotent).toBe(false);

    // A second approved version reusing the same key must conflict, not
    // silently return the first version's document.
    const v2 = await workflow.createRevision(actorOf(fx.advisor), request.id);
    await workflow.assignValidator(actorOf(fx.advisor), request.id, { validatorId: fx.validator.id });
    const sub2 = await workflow.submit(actorOf(fx.advisor), request.id);
    await workflow.review(actorOf(fx.validator), v2.id, { action: "APPROVE", snapshotHash: sub2.hash });
    await expect(
      workflow.issue(actorOf(fx.advisor), v2.id, { idempotencyKey: "shared-key" }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", httpStatus: 409 });
  });
});

describe("snapshot quote currency", () => {
  it("submit freezes the policy quote currency into displayJson", async () => {
    const { request, version } = await draft();
    await workflow.assignValidator(actorOf(fx.advisor), request.id, { validatorId: fx.validator.id });
    const submitted = await workflow.submit(actorOf(fx.advisor), request.id);
    expect(submitted.quoteCurrency).toBe("USD");
    const snap = await prisma.calculationSnapshot.findUnique({ where: { versionId: version.id } });
    expect(JSON.parse(snap!.displayJson!).quoteCurrency).toBe("USD");
  });
});
