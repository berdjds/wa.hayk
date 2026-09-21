/**
 * Route-level RBAC: a session with the plain USER role and no validation
 * assignment must get 401 from /api/travel routes. getServerSession is
 * mocked; the guard runs one (empty) assignment lookup against the throwaway
 * DB before rejecting.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ensureSchema } from "../travel-db/helpers";

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(async () => ({
    user: { id: "u-plain", role: "USER", email: "user@test.io", name: "Plain" },
    expires: "2099-01-01",
  })),
}));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/whatsapp", () => ({ sendWhatsAppMessage: vi.fn() }));

let requestsGET: typeof import("@/app/api/travel/requests/route").GET;

beforeAll(async () => {
  // The route module graph pulls in prisma; give it a valid (throwaway) URL.
  ensureSchema();
  requestsGET = (await import("@/app/api/travel/requests/route")).GET;
});

describe("travel API RBAC", () => {
  it("rejects USER role with 401", async () => {
    const res = await requestsGET(new NextRequest("http://localhost:3000/api/travel/requests"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });
});
