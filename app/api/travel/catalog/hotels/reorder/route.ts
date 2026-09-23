import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { applyCatalogReorder } from "@/lib/travel/reorder";
import { getTravelActor, travelError, unauthorized } from "../../../guard";

const reorderSchema = z
  .object({
    ids: z.array(z.string().min(1)).min(1),
  })
  .refine((b) => new Set(b.ids).size === b.ids.length, { message: "ids must be unique" });

// Admin drag-and-drop ordering (v0.13.1). Unknown ids are ignored. Partial
// submissions are spliced into their existing positions by
// applyCatalogReorder, so unsubmitted rows never move — the old slot-reuse
// scheme destroyed their order on legacy all-zero sortOrders.
export async function POST(req: NextRequest) {
  const actor = await getTravelActor();
  if (!actor) return unauthorized();
  if (actor.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = reorderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
  }
  const { ids } = parsed.data;

  try {
    const updated = await prisma.$transaction((tx) => applyCatalogReorder(tx.hotelProduct, ids));

    await writeAuditLog(
      "TRAVEL_CATALOG_REORDERED",
      actor.id,
      `Reordered ${updated} hotel products`
    );
    return NextResponse.json({ updated });
  } catch (err) {
    return travelError(err, "[API /travel/catalog/hotels/reorder]");
  }
}
