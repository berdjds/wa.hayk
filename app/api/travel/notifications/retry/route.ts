import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { getTravelActor, travelError, unauthorized } from "../../guard";

const retrySchema = z.object({
  ids: z.array(z.string().min(1).max(200)).min(1).max(100),
});

// Requeues FAILED deliveries (ADMIN). Attempts are kept so the retry cap in
// processNotificationQueue still applies.
export async function POST(req: NextRequest) {
  const actor = await getTravelActor();
  if (!actor) return unauthorized();
  if (actor.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = retrySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
  }

  try {
    const res = await prisma.notificationDelivery.updateMany({
      where: { id: { in: parsed.data.ids }, status: "FAILED" },
      data: { status: "QUEUED", lastError: null },
    });
    await writeAuditLog("NOTIFICATION_REQUEUED", actor.id, `Requeued ${res.count} deliver(ies)`);
    return NextResponse.json({ requeued: res.count });
  } catch (err) {
    return travelError(err, "[API /travel/notifications/retry]");
  }
}
