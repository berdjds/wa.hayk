import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { processNotificationQueue } from "@/lib/travel/notifications";
import { getTravelActor, travelError, unauthorized } from "../../guard";

const processSchema = z.object({
  limit: z.number().int().min(1).max(500).default(50),
});

// Manual sweep of the notification outbox (ADMIN); the background worker
// (startNotificationWorker) does the same on an interval once wired by the
// server lead.
export async function POST(req: NextRequest) {
  const actor = await getTravelActor();
  if (!actor) return unauthorized();
  if (actor.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = processSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
  }

  try {
    const result = await processNotificationQueue({ limit: parsed.data.limit });
    return NextResponse.json(result);
  } catch (err) {
    return travelError(err, "[API /travel/notifications/process]");
  }
}
