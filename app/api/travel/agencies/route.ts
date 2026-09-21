import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { getTravelActor, travelError, unauthorized } from "../guard";

const createAgencySchema = z.object({
  shortCode: z.string().regex(/^[A-Z0-9]{2,12}$/, "shortCode must be 2-12 uppercase letters/digits"),
  name: z.string().min(1),
  contactName: z.string().nullish(),
  contactEmail: z.string().email().nullish(),
  contactPhone: z.string().nullish(),
});

export async function GET() {
  const actor = await getTravelActor();
  if (!actor) return unauthorized();

  try {
    const agencies = await prisma.agency.findMany({
      where: { active: true },
      orderBy: { shortCode: "asc" },
    });
    return NextResponse.json(agencies);
  } catch (err) {
    return travelError(err, "[API /travel/agencies]");
  }
}

export async function POST(req: NextRequest) {
  const actor = await getTravelActor();
  if (!actor) return unauthorized();
  if (actor.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createAgencySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
  }

  try {
    const agency = await prisma.agency.create({ data: parsed.data });
    await writeAuditLog("AGENCY_CREATED", actor.id, `Created agency ${agency.shortCode} (${agency.name})`);
    return NextResponse.json(agency, { status: 201 });
  } catch (err) {
    return travelError(err, "[API /travel/agencies]");
  }
}
