import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { addDays } from "@/lib/travel/engine";
import { createRequest, createRequestSchema, saveVersionContent } from "@/lib/travel/workflow";
import { getTravelActor, travelError, unauthorized } from "../../../guard";

const instantiateSchema = createRequestSchema.extend({
  templateVersionId: z.string().optional(),
});

interface TemplateDay {
  dayOffset: number;
  narrative?: string;
  overnightCity?: string;
  services?: string[];
}

// Creates a NEW request whose v1 itinerary is copied from a template version.
// Default services from the template days are copied as narrative references
// only — pricing lines are built by the advisor from the catalog, because
// template service refs are workbook-era provenance, not catalog ids.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await getTravelActor();
  if (!actor) return unauthorized();
  if (actor.role !== "ADMIN" && actor.role !== "ADVISOR") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = instantiateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
  }

  try {
    const template = await prisma.packageTemplate.findUnique({
      where: { id: params.id },
      include: { versions: { orderBy: { versionNo: "desc" } } },
    });
    if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });

    const templateVersion = parsed.data.templateVersionId
      ? template.versions.find((v) => v.id === parsed.data.templateVersionId)
      : template.versions.find((v) => v.status === "ACTIVE") ?? template.versions[0];
    if (!templateVersion) {
      return NextResponse.json({ error: "Template has no versions" }, { status: 400 });
    }

    const { templateVersionId: _ignored, ...requestData } = parsed.data;
    const { request, version } = await createRequest(actor, requestData);

    const days = JSON.parse(templateVersion.daysJson) as TemplateDay[];
    const itineraryDays = days.map((d, i) => ({
      dayOffset: d.dayOffset ?? i,
      date: addDays(request.startDate, d.dayOffset ?? i),
      narrative: d.narrative ?? null,
      overnightCity: d.overnightCity ?? null,
      // Template refs are plain labels — never catalog ids (see header note).
      services: d.services?.map((label) => ({ label })) ?? null,
    }));
    // Freshly created request: revision is 0 (createRequest never bumps it).
    await saveVersionContent(actor, version.id, { expectedRevision: 0, itineraryDays });

    await prisma.quoteVersion.update({
      where: { id: version.id },
      data: { templateVersionId: templateVersion.id },
    });

    return NextResponse.json(
      { request, versionId: version.id, templateVersionId: templateVersion.id },
      { status: 201 },
    );
  } catch (err) {
    return travelError(err, "[API /travel/templates/[id]/instantiate]");
  }
}
