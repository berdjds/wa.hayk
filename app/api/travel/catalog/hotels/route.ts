import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTravelActor, travelError, unauthorized } from "../../guard";

// Hotel products with their non-archived rates (catalog browsing).
export async function GET(req: NextRequest) {
  const actor = await getTravelActor();
  if (!actor) return unauthorized();

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  const includeInactive = searchParams.get("includeInactive") === "true";

  try {
    const hotels = await prisma.hotelProduct.findMany({
      where: {
        ...(includeInactive ? {} : { active: true }),
        ...(q ? { name: { contains: q } } : {}),
      },
      orderBy: { name: "asc" },
      include: {
        supplier: { select: { id: true, name: true } },
        rates: {
          where: { status: { not: "ARCHIVED" } },
          orderBy: [{ occupancy: "asc" }, { validFrom: "asc" }],
        },
      },
    });
    return NextResponse.json(hotels);
  } catch (err) {
    return travelError(err, "[API /travel/catalog/hotels]");
  }
}
