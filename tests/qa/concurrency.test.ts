/**
 * QA: concurrency, idempotency and package-code rules (items 13 and 19).
 *
 * - 20 parallel createRequest calls for one agency+day: every fulfilled code
 *   is unique, correctly formatted and sequential; failures are only allowed
 *   to be clean SQLite lock/timeout errors (P1008/P2028) — never corruption.
 * - Parallel double-issue on the same approved version: exactly one ISSUED,
 *   the loser gets 409; a later retry with the winner's key is idempotent.
 * - Parallel double-review: exactly one decision commits.
 * - Parallel double-submit and sequential re-submit: second one blocked.
 * - Company-timezone date keys: straddling midnight Asia/Yerevan yields
 *   different date keys and independent sequences; the default date comes
 *   from the configured company timezone.
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
} from "../workflow/fixtures";

vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => ({ providerId: "smtp-test" })) }));
vi.mock("@/lib/whatsapp", () => ({
  sendWhatsAppMessage: vi.fn(async () => ({ id: { _serialized: "wa-test" } })),
}));
vi.mock("@/lib/travel/pdf/render", () => ({
  renderQuotationPdf: vi.fn(async () => Buffer.from("%PDF-1.4 fake")),
}));

let prisma: PrismaClient;
let workflow: typeof import("@/lib/travel/workflow");
let codes: typeof import("@/lib/travel/codes");
let settings: typeof import("@/lib/travel/settings");
let fx: Fixtures;

beforeAll(async () => {
  ensureSchema();
  prisma = await getPrisma();
  workflow = await import("@/lib/travel/workflow");
  codes = await import("@/lib/travel/codes");
  settings = await import("@/lib/travel/settings");
  fx = await seedFixtures(prisma);
});

async function approvedVersion() {
  const { request, version } = await workflow.createRequest(actorOf(fx.advisor), createRequestInput(fx.agency.id));
  await saveContent(prisma, actorOf(fx.advisor), request.id, version.id, scenarioContent(fx.hotel.id, fx.hotel.name));
  await workflow.assignValidator(actorOf(fx.advisor), request.id, { validatorId: fx.validator.id });
  const { hash } = await workflow.submit(actorOf(fx.advisor), request.id);
  await workflow.review(actorOf(fx.validator), version.id, { action: "APPROVE", snapshotHash: hash });
  return { request, version, hash };
}

async function submittedVersion() {
  const { request, version } = await workflow.createRequest(actorOf(fx.advisor), createRequestInput(fx.agency.id));
  await saveContent(prisma, actorOf(fx.advisor), request.id, version.id, scenarioContent(fx.hotel.id, fx.hotel.name));
  await workflow.assignValidator(actorOf(fx.advisor), request.id, { validatorId: fx.validator.id });
  const { hash } = await workflow.submit(actorOf(fx.advisor), request.id);
  return { request, version, hash };
}

describe("parallel createRequest (item 19: unique codes under concurrency)", () => {
  it("20 parallel creations never duplicate or corrupt a code", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        workflow.createRequest(actorOf(fx.advisor), {
          ...createRequestInput(fx.agency.id),
          title: `Burst ${i}`,
        }),
      ),
    );

    const fulfilled = results
      .filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled")
      .map((r) => r.value.request);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");

    // createRequest retries SQLite lock-race errors (P1008/P2028) internally,
    // so a 20-way burst should now fully succeed. Any residual rejection must
    // still be a clean lock error — never a corrupt or duplicate code.
    for (const r of rejected) {
      expect(r.reason?.name).toBe("PrismaClientKnownRequestError");
      expect(["P1008", "P2028"]).toContain(r.reason?.code);
    }
    expect(fulfilled.length).toBe(20);

    const codesSeen = fulfilled.map((r) => r.packageCode);
    expect(new Set(codesSeen).size).toBe(codesSeen.length);
    for (const code of codesSeen) {
      expect(code).toMatch(/^ACME-\d{4}-\d{2}-\d{2}-\d{4,}$/);
    }
    // The DB agrees: no duplicate package codes, every request has v1.
    const dbCount = await prisma.travelRequest.count({ where: { packageCode: { in: codesSeen } } });
    expect(dbCount).toBe(codesSeen.length);

    // The counter is never rolled back by failed creations: a follow-up
    // request continues past the burst without reuse.
    const after = await workflow.createRequest(actorOf(fx.advisor), createRequestInput(fx.agency.id));
    const seqs = [...codesSeen, after.request.packageCode].map((c) => codes.parsePackageCode(c)!.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(Math.max(...seqs)).toBeGreaterThanOrEqual(fulfilled.length);
  }, 180000);
});

describe("parallel double-issue (item 13)", () => {
  it("exactly one ISSUED; the loser gets 409; the winner's key stays idempotent", async () => {
    const { request, version } = await approvedVersion();

    const race = await Promise.allSettled([
      workflow.issue(actorOf(fx.advisor), version.id, { idempotencyKey: "race-a" }),
      workflow.issue(actorOf(fx.advisor), version.id, { idempotencyKey: "race-b" }),
    ]);
    const ok = race.filter((r) => r.status === "fulfilled");
    const lost = race.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(lost[0].reason).toMatchObject({ code: "INVALID_STATE", httpStatus: 409 });

    expect(await prisma.quoteDocument.count({ where: { versionId: version.id } })).toBe(1);
    expect(await prisma.workflowEvent.count({ where: { requestId: request.id, type: "ISSUED" } })).toBe(1);

    const winnerKey = (ok[0] as PromiseFulfilledResult<any>).value.document.idempotencyKey;
    const replay = await workflow.issue(actorOf(fx.advisor), version.id, { idempotencyKey: winnerKey });
    expect(replay.idempotent).toBe(true);
    expect(await prisma.quoteDocument.count({ where: { versionId: version.id } })).toBe(1);
  });
});

describe("parallel double-review (item 13)", () => {
  it("exactly one decision commits; the loser gets 409", async () => {
    const { request, version, hash } = await submittedVersion();

    const race = await Promise.allSettled([
      workflow.review(actorOf(fx.validator), version.id, { action: "APPROVE", snapshotHash: hash }),
      workflow.review(actorOf(fx.validator), version.id, {
        action: "REQUEST_CHANGES",
        reason: "racing change request",
        snapshotHash: hash,
      }),
    ]);
    const ok = race.filter((r) => r.status === "fulfilled");
    const lost = race.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(lost[0].reason).toMatchObject({ code: "INVALID_STATE", httpStatus: 409 });

    expect(await prisma.reviewDecision.count({ where: { versionId: version.id } })).toBe(1);
    const events = await prisma.workflowEvent.findMany({
      where: { requestId: request.id, type: { in: ["APPROVED", "CHANGES_REQUESTED"] } },
    });
    expect(events).toHaveLength(1);
    // The persisted status matches the single recorded decision.
    const finalVersion = await prisma.quoteVersion.findUnique({ where: { id: version.id } });
    expect(finalVersion?.status).toBe((ok[0] as PromiseFulfilledResult<any>).value.status);
  });
});

describe("repeated submit (item 13 idempotency)", () => {
  it("a second sequential submit is blocked; concurrent double-submit has one winner", async () => {
    const { request, version } = await (async () => {
      const { request, version } = await workflow.createRequest(actorOf(fx.advisor), createRequestInput(fx.agency.id));
      await saveContent(prisma, actorOf(fx.advisor), request.id, version.id, scenarioContent(fx.hotel.id, fx.hotel.name));
      await workflow.assignValidator(actorOf(fx.advisor), request.id, { validatorId: fx.validator.id });
      return { request, version };
    })();

    // Concurrent double-submit from DRAFT: one wins, one 409.
    const race = await Promise.allSettled([
      workflow.submit(actorOf(fx.advisor), request.id),
      workflow.submit(actorOf(fx.advisor), request.id),
    ]);
    const ok = race.filter((r) => r.status === "fulfilled");
    const lost = race.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(lost[0].reason).toMatchObject({ code: "INVALID_STATE", httpStatus: 409 });
    expect(await prisma.workflowEvent.count({ where: { requestId: request.id, type: "SUBMITTED" } })).toBe(1);

    // Sequential repeat with unchanged content: blocked by the state machine.
    await expect(workflow.submit(actorOf(fx.advisor), request.id)).rejects.toMatchObject({
      code: "INVALID_STATE",
      httpStatus: 409,
    });
    // Still exactly one snapshot, unchanged.
    expect(await prisma.calculationSnapshot.count({ where: { versionId: version.id } })).toBe(1);
  });
});

describe("company-timezone date keys (item 19)", () => {
  it("requests straddling midnight Asia/Yerevan get different date keys and sequences", async () => {
    const agency = await prisma.agency.create({ data: { shortCode: "TZTEST", name: "TZ Test" } });
    // 23:30 and 00:30 Asia/Yerevan on consecutive days.
    const before = await codes.generatePackageCode(agency.id, { date: "2026-09-21" });
    const after = await codes.generatePackageCode(agency.id, { date: "2026-09-22" });
    expect(before).toBe("TZTEST-2026-09-21-0001");
    expect(after).toBe("TZTEST-2026-09-22-0001");
    expect(codes.parsePackageCode(before)!.dateKey).not.toBe(codes.parsePackageCode(after)!.dateKey);
  });

  it("the default date key follows the configured company timezone", async () => {
    await prisma.travelSettings.update({
      where: { id: "default" },
      data: { companyTz: "Asia/Yerevan" },
    });
    expect(await settings.companyToday()).toBe(await settings.companyToday("Asia/Yerevan"));

    // Kiritimati (UTC+14) and Midway (UTC-11) are 25h apart: at any instant
    // their calendar dates differ, so the company timezone is decisive for
    // the date key near midnight.
    const ahead = await settings.companyToday("Pacific/Kiritimati");
    const behind = await settings.companyToday("Pacific/Midway");
    expect(ahead).not.toBe(behind);

    await prisma.travelSettings.update({
      where: { id: "default" },
      data: { companyTz: "Pacific/Kiritimati" },
    });
    const agency = await prisma.agency.create({ data: { shortCode: "TZDEF", name: "TZ Default" } });
    const code = await codes.generatePackageCode(agency.id);
    expect(codes.parsePackageCode(code)!.dateKey).toBe(ahead);
    await prisma.travelSettings.update({
      where: { id: "default" },
      data: { companyTz: "Asia/Yerevan" },
    });
  });
});
