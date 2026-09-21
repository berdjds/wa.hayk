import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { getFxMap } from "@/lib/travel/settings";
import { getTravelActor, travelError, unauthorized } from "../guard";

const createFxSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/, "currency must be a 3-letter code"),
  amdPerUnit: z.string().regex(/^\d+(\.\d+)?$/, "amdPerUnit must be a positive decimal string"),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"),
});

// ?asOf=YYYY-MM-DD returns the effective map; otherwise full version history.
export async function GET(req: NextRequest) {
  const actor = await getTravelActor();
  if (!actor) return unauthorized();

  try {
    const asOf = new URL(req.url).searchParams.get("asOf")?.trim();
    if (asOf) {
      return NextResponse.json({ asOf, rates: await getFxMap(asOf) });
    }
    const versions = await prisma.fXRateVersion.findMany({
      orderBy: [{ currency: "asc" }, { effectiveFrom: "desc" }],
    });
    return NextResponse.json(versions);
  } catch (err) {
    return travelError(err, "[API /travel/fx]");
  }
}

export async function POST(req: NextRequest) {
  const actor = await getTravelActor();
  if (!actor) return unauthorized();
  if (actor.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createFxSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
  }

  try {
    const fx = await prisma.fXRateVersion.create({
      data: { ...parsed.data, createdById: actor.id },
    });
    await writeAuditLog(
      "TRAVEL_FX_ADDED",
      actor.id,
      `FX ${fx.currency} = ${fx.amdPerUnit} AMD effective ${fx.effectiveFrom}`,
    );
    return NextResponse.json(fx, { status: 201 });
  } catch (err) {
    return travelError(err, "[API /travel/fx]");
  }
}
