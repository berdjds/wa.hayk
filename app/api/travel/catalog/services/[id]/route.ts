import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { getTravelActor, travelError, unauthorized } from "../../../guard";
import {
  durationVariantField,
  pricingBasisField,
  serviceCategoryField,
  serviceDetailsField,
  toWeekdaysJson,
  weekdaysField,
} from "../../schemas";

const patchServiceSchema = z
  .object({
    name: z.string().trim().min(1),
    details: serviceDetailsField,
    category: serviceCategoryField,
    basis: pricingBasisField,
    capacity: z.number().int().positive().nullish(),
    language: z.string().trim().min(1).nullish(),
    durationVariant: durationVariantField.nullish(),
    weekdays: weekdaysField,
    supplierId: z.string().nullish(),
    active: z.boolean(),
  })
  .partial();

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await getTravelActor();
  if (!actor) return unauthorized();
  if (actor.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = patchServiceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
  }
  const { weekdays, supplierId, ...rest } = parsed.data;

  try {
    const existing = await prisma.serviceProduct.findUnique({ where: { id: params.id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (supplierId) {
      const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
      if (!supplier) return NextResponse.json({ error: "Unknown supplierId" }, { status: 400 });
    }

    const service = await prisma.serviceProduct.update({
      where: { id: params.id },
      data: {
        ...rest,
        // undefined = unchanged; ""/whitespace clears the description.
        ...(rest.details !== undefined ? { details: rest.details?.trim() ? rest.details.trim() : null } : {}),
        ...(supplierId !== undefined ? { supplierId } : {}),
        ...(weekdays !== undefined ? { weekdays: toWeekdaysJson(weekdays) ?? null } : {}),
      },
    });
    await writeAuditLog("SERVICE_UPDATED", actor.id, `Updated service ${service.name} (${service.id})`);
    return NextResponse.json(service);
  } catch (err) {
    return travelError(err, "[API /travel/catalog/services/[id]]");
  }
}
