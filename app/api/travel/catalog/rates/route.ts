import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTravelActor, travelError, unauthorized } from "../../guard";

// Rate browsing with filters; includes NEEDS_REVIEW so validators can verify.
export async function GET(req: NextRequest) {
  const actor = await getTravelActor();
  if (!actor) return unauthorized();

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status")?.trim();
  const productType = searchParams.get("productType")?.trim();
  const hotelProductId = searchParams.get("hotelProductId")?.trim();

  try {
    const rates = await prisma.rateVersion.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(productType ? { productType } : {}),
        ...(hotelProductId ? { hotelProductId } : {}),
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: {
        hotelProduct: { select: { id: true, name: true, city: true } },
        vehicleType: { select: { id: true, name: true } },
        serviceProduct: { select: { id: true, name: true } },
      },
      take: 500,
    });
    return NextResponse.json(rates);
  } catch (err) {
    return travelError(err, "[API /travel/catalog/rates]");
  }
}
