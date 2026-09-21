import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTravelActor, travelError, unauthorized } from "../../guard";

// Supplier picker options for the catalog CRUD dialogs.
export async function GET() {
  const actor = await getTravelActor();
  if (!actor) return unauthorized();

  try {
    const suppliers = await prisma.supplier.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    return NextResponse.json(suppliers);
  } catch (err) {
    return travelError(err, "[API /travel/catalog/suppliers]");
  }
}
