import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { getTravelActor, travelError, unauthorized } from "../../../guard";

// Rates are archived, never deleted: they are the evidence trail for
// historical snapshots. Allowed transitions: NEEDS_REVIEW → VERIFIED →
// ARCHIVED (and VERIFIED → ARCHIVED).
const patchRateSchema = z.object({
  status: z.enum(["NEEDS_REVIEW", "VERIFIED", "ARCHIVED"]).optional(),
  notes: z.string().nullish(),
});

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  NEEDS_REVIEW: ["VERIFIED", "ARCHIVED"],
  VERIFIED: ["ARCHIVED"],
  ARCHIVED: [],
};

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await getTravelActor();
  if (!actor) return unauthorized();
  if (actor.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = patchRateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
  }

  try {
    const rate = await prisma.rateVersion.findUnique({ where: { id: params.id } });
    if (!rate) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (parsed.data.status && parsed.data.status !== rate.status) {
      if (!ALLOWED_TRANSITIONS[rate.status]?.includes(parsed.data.status)) {
        return NextResponse.json(
          { error: `rate status cannot move ${rate.status} → ${parsed.data.status}` },
          { status: 400 },
        );
      }
    }

    const updated = await prisma.rateVersion.update({
      where: { id: params.id },
      data: {
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
        ...(parsed.data.notes !== undefined ? { notes: parsed.data.notes } : {}),
      },
    });
    await writeAuditLog("RATE_UPDATED", actor.id, `Rate ${params.id}: ${rate.status} → ${updated.status}`);
    return NextResponse.json(updated);
  } catch (err) {
    return travelError(err, "[API /travel/catalog/rates/[id]]");
  }
}
