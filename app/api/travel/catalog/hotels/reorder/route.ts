import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { getTravelActor, travelError, unauthorized } from "../../../guard";

const reorderSchema = z
  .object({
    ids: z.array(z.string().min(1)).min(1),
  })
  .refine((b) => new Set(b.ids).size === b.ids.length, { message: "ids must be unique" });

// Admin drag-and-drop ordering (v0.13.1). Unknown ids are ignored. When the
// submitted list covers every row the sortOrder column is rewritten to a clean
// 0..n-1 sequence; a partial list (e.g. one service category) keeps the
// existing sortOrder slots of just those rows, so the rest of the catalog does
// not move.
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
    const updated = await prisma.$transaction(async (tx) => {
      const rows = await tx.hotelProduct.findMany({
        where: { id: { in: ids } },
        select: { id: true, sortOrder: true },
      });
      const known = new Map(rows.map((r) => [r.id, r.sortOrder]));
      const ordered = ids.filter((id) => known.has(id));
      if (ordered.length === 0) return 0;

      const total = await tx.hotelProduct.count();
      let values: number[];
      if (ordered.length === total) {
        values = ordered.map((_, i) => i);
      } else {
        const slots = rows.map((r) => r.sortOrder).sort((a, b) => a - b);
        // Legacy rows all share sortOrder 0; equal slots cannot express a new
        // relative order, so spread upward from the lowest slot instead.
        const distinct = new Set(slots).size === slots.length;
        values = ordered.map((_, i) => (distinct ? slots[i] : slots[0] + i));
      }

      for (let i = 0; i < ordered.length; i++) {
        await tx.hotelProduct.update({ where: { id: ordered[i] }, data: { sortOrder: values[i] } });
      }
      return ordered.length;
    });

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
