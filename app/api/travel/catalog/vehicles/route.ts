import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTravelActor, travelError, unauthorized } from "../../guard";

// Fleet vehicle types for the itinerary/service-line vehicle pickers and the
// per-vehicle SERVICE rate editor. Active rows only.
export async function GET() {
  const actor = await getTravelActor();
  if (!actor) return unauthorized();

  try {
    const vehicles = await prisma.vehicleType.findMany({
      where: { active: true },
      select: { id: true, name: true, seats: true },
      orderBy: { seats: "asc" },
    });
    return NextResponse.json(vehicles);
  } catch (err) {
    return travelError(err, "[API /travel/catalog/vehicles]");
  }
}
