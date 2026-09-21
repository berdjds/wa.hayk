import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTravelActor, travelError, unauthorized } from "../../guard";

export async function GET(req: NextRequest) {
  const actor = await getTravelActor();
  if (!actor) return unauthorized();

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim();
  const category = searchParams.get("category")?.trim();

  try {
    const services = await prisma.serviceProduct.findMany({
      where: {
        active: true,
        ...(q ? { name: { contains: q } } : {}),
        ...(category ? { category } : {}),
      },
      orderBy: { name: "asc" },
      include: {
        supplier: { select: { id: true, name: true } },
        rates: { where: { status: { not: "ARCHIVED" } } },
      },
    });
    return NextResponse.json(services);
  } catch (err) {
    return travelError(err, "[API /travel/catalog/services]");
  }
}
