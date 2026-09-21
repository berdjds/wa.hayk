import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getTravelActor, travelError, unauthorized } from "../guard";

// Package templates with their versions (newest first per template).
export async function GET() {
  const actor = await getTravelActor();
  if (!actor) return unauthorized();

  try {
    const templates = await prisma.packageTemplate.findMany({
      orderBy: { code: "asc" },
      include: { versions: { orderBy: { versionNo: "desc" } } },
    });
    return NextResponse.json(templates);
  } catch (err) {
    return travelError(err, "[API /travel/templates]");
  }
}
