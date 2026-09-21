/**
 * QA: route-level authorization (item 14). Sessions are mocked per test via a
 * hoisted mutable; routes run against the seeded throwaway DB, so these test
 * the server — not hidden buttons.
 *
 * - USER role: 401 on requests/settings/rates (and every other travel route).
 * - ADVISOR: 403 on PUT settings and PATCH rates (ADMIN-only); may POST requests.
 * - VALIDATOR: 403 creating requests; 403 issuing (not owner/admin).
 * - Non-current validator: 403 NOT_ASSIGNED_VALIDATOR on review.
 * - INTERNAL documents: 403 for ADVISOR, 200 for VALIDATOR/ADMIN.
 * - ADVISOR list scope: sees only own requests.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { PrismaClient } from "@prisma/client";
import { ensureSchema, getPrisma } from "../travel-db/helpers";
import { actorOf, createRequestInput, saveContent, scenarioContent, seedFixtures, type Fixtures } from "../workflow/fixtures";

const { sessionRef } = vi.hoisted(() => ({ sessionRef: { current: null as any } }));
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(async () => sessionRef.current),
}));
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
let advisor2: { id: string; role: string; name: string | null; email: string };

let requestsRoute: typeof import("@/app/api/travel/requests/route");
let settingsRoute: typeof import("@/app/api/travel/settings/route");
let ratesRoute: typeof import("@/app/api/travel/catalog/rates/route");
let rateByIdRoute: typeof import("@/app/api/travel/catalog/rates/[id]/route");
let documentsRoute: typeof import("@/app/api/travel/documents/[id]/route");
let issueRoute: typeof import("@/app/api/travel/versions/[id]/issue/route");
let reviewRoute: typeof import("@/app/api/travel/versions/[id]/review/route");

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
  workflow = await import("@/lib/travel/workflow");
  fx = await seedFixtures(prisma);
  advisor2 = await prisma.user.create({
    data: { email: "advisor2@test.io", name: "Advisor Two", password: "x", role: "ADVISOR" },
  });

  requestsRoute = await import("@/app/api/travel/requests/route");
  settingsRoute = await import("@/app/api/travel/settings/route");
  ratesRoute = await import("@/app/api/travel/catalog/rates/route");
  rateByIdRoute = await import("@/app/api/travel/catalog/rates/[id]/route");
  documentsRoute = await import("@/app/api/travel/documents/[id]/route");
  issueRoute = await import("@/app/api/travel/versions/[id]/issue/route");
  reviewRoute = await import("@/app/api/travel/versions/[id]/review/route");
});

beforeEach(() => session(null));

describe("USER role is rejected everywhere (401)", () => {
  it("GET requests / settings / rates all return 401 for USER and anonymous", async () => {
    for (const who of [fx.plainUser, null]) {
      session(who);
      expect((await requestsRoute.GET(req("http://t/api/travel/requests"))).status).toBe(401);
      expect((await settingsRoute.GET()).status).toBe(401);
      expect((await ratesRoute.GET(req("http://t/api/travel/catalog/rates"))).status).toBe(401);
    }
  });
});

describe("ADMIN-only mutations", () => {
  it("ADVISOR and VALIDATOR cannot PUT settings", async () => {
    for (const who of [fx.advisor, fx.validator]) {
      session(who);
      const res = await settingsRoute.PUT(req("http://t/api/travel/settings", { method: "PUT", body: { overdueReminderHours: 2 } }));
      expect(res.status).toBe(403);
    }
    session(fx.admin);
    const ok = await settingsRoute.PUT(req("http://t/api/travel/settings", { method: "PUT", body: { overdueReminderHours: 2 } }));
    expect(ok.status).toBe(200);
  });

  it("ADVISOR and VALIDATOR cannot PATCH rates", async () => {
    const rate = await prisma.rateVersion.findFirst({ where: { status: "VERIFIED" } });
    for (const who of [fx.advisor, fx.validator]) {
      session(who);
      const res = await rateByIdRoute.PATCH(req(`http://t/api/travel/catalog/rates/${rate!.id}`, { method: "PATCH", body: { notes: "x" } }), { params: { id: rate!.id } });
      expect(res.status).toBe(403);
    }
    session(fx.admin);
    const ok = await rateByIdRoute.PATCH(req(`http://t/api/travel/catalog/rates/${rate!.id}`, { method: "PATCH", body: { notes: "reviewed" } }), { params: { id: rate!.id } });
    expect(ok.status).toBe(200);
  });
});

describe("request creation and workflow actions", () => {
  it("VALIDATOR cannot create requests; ADVISOR can", async () => {
    session(fx.validator);
    const denied = await requestsRoute.POST(req("http://t/api/travel/requests", { method: "POST", body: createRequestInput(fx.agency.id) }));
    expect(denied.status).toBe(403);

    session(fx.advisor);
    const allowed = await requestsRoute.POST(req("http://t/api/travel/requests", { method: "POST", body: createRequestInput(fx.agency.id) }));
    expect(allowed.status).toBe(201);
  });

  it("VALIDATOR cannot issue (not owner, not admin): 403 FORBIDDEN", async () => {
    const { request, version } = await workflow.createRequest(actorOf(fx.advisor), createRequestInput(fx.agency.id));
    await saveContent(prisma, actorOf(fx.advisor), request.id, version.id, scenarioContent(fx.hotel.id, fx.hotel.name));
    await workflow.assignValidator(actorOf(fx.advisor), request.id, { validatorId: fx.validator.id });
    const { hash } = await workflow.submit(actorOf(fx.advisor), request.id);
    await workflow.review(actorOf(fx.validator), version.id, { action: "APPROVE", snapshotHash: hash });

    session(fx.validator);
    const res = await issueRoute.POST(req(`http://t/api/travel/versions/${version.id}/issue`, { method: "POST", body: {} }), { params: { id: version.id } });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("FORBIDDEN");
  });

  it("a non-current validator cannot review: 403 NOT_ASSIGNED_VALIDATOR", async () => {
    const { request, version } = await workflow.createRequest(actorOf(fx.advisor), createRequestInput(fx.agency.id));
    await saveContent(prisma, actorOf(fx.advisor), request.id, version.id, scenarioContent(fx.hotel.id, fx.hotel.name));
    await workflow.assignValidator(actorOf(fx.advisor), request.id, { validatorId: fx.validator.id });
    const { hash } = await workflow.submit(actorOf(fx.advisor), request.id);

    session(fx.validator2); // a validator, but not the assigned one
    const res = await reviewRoute.POST(
      req(`http://t/api/travel/versions/${version.id}/review`, { method: "POST", body: { action: "APPROVE", snapshotHash: hash } }),
      { params: { id: version.id } },
    );
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("NOT_ASSIGNED_VALIDATOR");

    // The assigned validator succeeds through the same route.
    session(fx.validator);
    const ok = await reviewRoute.POST(
      req(`http://t/api/travel/versions/${version.id}/review`, { method: "POST", body: { action: "APPROVE", snapshotHash: hash } }),
      { params: { id: version.id } },
    );
    expect(ok.status).toBe(200);
  });
});

describe("document kind authorization", () => {
  it("INTERNAL documents reject ADVISOR (403) and allow VALIDATOR/ADMIN; CLIENT allows any travel role", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "qa-docs-"));
    const file = path.join(dir, "doc.pdf");
    writeFileSync(file, "%PDF-1.4 qa");

    const { version } = await workflow.createRequest(actorOf(fx.advisor), createRequestInput(fx.agency.id));
    const mkDoc = (kind: string, key: string) =>
      prisma.quoteDocument.create({
        data: {
          versionId: version.id,
          snapshotHash: "0".repeat(64),
          kind,
          templateVersion: "1",
          filePath: file,
          sha256: "abc",
          idempotencyKey: key,
        },
      });
    const internal = await mkDoc("INTERNAL", "qa-internal");
    const client = await mkDoc("CLIENT", "qa-client");

    session(fx.advisor);
    expect((await documentsRoute.GET(req(`http://t/api/travel/documents/${internal.id}`), { params: { id: internal.id } })).status).toBe(403);
    const clientRes = await documentsRoute.GET(req(`http://t/api/travel/documents/${client.id}`), { params: { id: client.id } });
    expect(clientRes.status).toBe(200);
    expect(clientRes.headers.get("Content-Type")).toBe("application/pdf");

    session(fx.validator);
    expect((await documentsRoute.GET(req(`http://t/api/travel/documents/${internal.id}`), { params: { id: internal.id } })).status).toBe(200);
    session(fx.admin);
    expect((await documentsRoute.GET(req(`http://t/api/travel/documents/${internal.id}`), { params: { id: internal.id } })).status).toBe(200);

    // USER role never reaches the kind check.
    session(fx.plainUser);
    expect((await documentsRoute.GET(req(`http://t/api/travel/documents/${client.id}`), { params: { id: client.id } })).status).toBe(401);
  });
});

describe("advisor list scoping", () => {
  it("an advisor sees only their own requests; validators/admins see all", async () => {
    await workflow.createRequest(actorOf(fx.advisor), createRequestInput(fx.agency.id));
    await workflow.createRequest(actorOf(advisor2 as any), createRequestInput(fx.agency.id));

    session(fx.advisor);
    const mine = await (await requestsRoute.GET(req("http://t/api/travel/requests"))).json();
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r: any) => r.owner.id === fx.advisor.id)).toBe(true);

    session(fx.validator);
    const all = await (await requestsRoute.GET(req("http://t/api/travel/requests"))).json();
    const ownerIds = new Set(all.map((r: any) => r.owner.id));
    expect(ownerIds.has(fx.advisor.id)).toBe(true);
    expect(ownerIds.has(advisor2.id)).toBe(true);
  });
});
