import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTravelActor, travelError, unauthorized } from "../guard";

// Own deliveries; ADMIN sees all. ?status=FAILED etc. to filter.
export async function GET(req: NextRequest) {
  const actor = await getTravelActor();
  if (!actor) return unauthorized();

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status")?.trim();

  try {
    const deliveries = await prisma.notificationDelivery.findMany({
      where: {
        ...(actor.role === "ADMIN" ? {} : { recipientId: actor.id }),
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        event: { select: { id: true, type: true, requestId: true, versionId: true, createdAt: true } },
      },
    });
    return NextResponse.json(deliveries);
  } catch (err) {
    return travelError(err, "[API /travel/notifications]");
  }
}
