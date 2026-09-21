import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { getTravelActor, travelError, unauthorized } from "../../../guard";
import { hotelKindField } from "../../schemas";

const patchHotelSchema = z
  .object({
    name: z.string().trim().min(1),
    city: z.string().trim().min(1).nullish(),
    country: z.string().trim().min(2).max(3),
    stars: z.number().int().min(1).max(5).nullish(),
    kind: hotelKindField,
    roomType: z.string().trim().min(1).nullish(),
    capacityAdults: z.number().int().min(0),
    capacityChildren: z.number().int().min(0),
    capacityTotal: z.number().int().min(1),
    beds: z.string().trim().min(1).nullish(),
    extraBedAllowed: z.boolean(),
    cotAllowed: z.boolean(),
    boardOptions: z.array(z.string().trim().min(1)).nullish(),
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
  const parsed = patchHotelSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
  }
  const { boardOptions, supplierId, ...rest } = parsed.data;

  try {
    const existing = await prisma.hotelProduct.findUnique({ where: { id: params.id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (supplierId) {
      const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
      if (!supplier) return NextResponse.json({ error: "Unknown supplierId" }, { status: 400 });
    }

    const hotel = await prisma.hotelProduct.update({
      where: { id: params.id },
      data: {
        ...rest,
        ...(supplierId !== undefined ? { supplierId } : {}),
        ...(boardOptions !== undefined
          ? { boardOptions: boardOptions?.length ? JSON.stringify(boardOptions) : null }
          : {}),
      },
    });
    await writeAuditLog("HOTEL_UPDATED", actor.id, `Updated hotel ${hotel.name} (${hotel.id})`);
    return NextResponse.json(hotel);
  } catch (err) {
    return travelError(err, "[API /travel/catalog/hotels/[id]]");
  }
}
