import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ROLE_ADMIN, ROLE_ADVISOR, ROLE_VALIDATOR } from "@/lib/travel/contracts";
import { publicDocumentView, redactScenarioResultJson } from "@/lib/travel/redact";
import { updateDraft, updateDraftSchema } from "@/lib/travel/workflow";
import { getTravelActor, travelError, unauthorized } from "../../guard";

const patchBodySchema = z.object({
  expectedRevision: z.number().int().min(0),
  patch: updateDraftSchema,
});

// Full detail: agency, versions with scenarios/stays/lines, snapshot summary
// (hash + validity, not the full result blob), assignments, decisions, and
// document metadata without filesystem paths. Advisors get 404 for other
// advisors' requests (IDOR). The request owner sees full costing (v0.11.0) —
// redaction to sell-side fields would only apply to a non-owner advisor.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await getTravelActor();
  if (!actor) return unauthorized();

  try {
    const request = await prisma.travelRequest.findUnique({
      where: { id: params.id },
      include: {
        agency: true,
        owner: { select: { id: true, email: true, name: true, role: true } },
        validator: { select: { id: true, email: true, name: true, role: true } },
        versions: {
          orderBy: { versionNo: "asc" },
          include: {
            scenarios: { include: { stays: true } },
            itineraryDays: { orderBy: { dayOffset: "asc" } },
            serviceLines: true,
            snapshot: {
              select: { id: true, hash: true, engineVersion: true, createdAt: true, displayJson: true },
            },
            decisions: { orderBy: { createdAt: "desc" } },
            documents: {
              select: {
                id: true,
                kind: true,
                filePath: true, // consumed by publicDocumentView, never returned
                issuedAt: true,
                createdAt: true,
              },
            },
          },
        },
        assignments: {
          orderBy: { createdAt: "desc" },
          include: { validator: { select: { id: true, email: true, name: true } } },
        },
      },
    });
    if (!request) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    // Existence of other advisors' requests is not disclosed.
    if (actor.role === ROLE_ADVISOR && request.ownerId !== actor.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    // Users without a travel role (assigned validators, v0.10.0) may only
    // open requests they own or actively validate.
    if (![ROLE_ADMIN, ROLE_VALIDATOR, ROLE_ADVISOR].includes(actor.role as any)) {
      const assigned = request.assignments.some((a) => a.active && a.validatorId === actor.id);
      if (request.ownerId !== actor.id && !assigned) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
    }
    const advisorView = actor.role === ROLE_ADVISOR;
    // v0.11.0: the request owner sees full costing (per-line net costs — the
    // initiator prices the request). Redaction remains for a hypothetical
    // non-owner advisor; they are 404'd above, so this is defense in depth.
    const redactResults = advisorView && request.ownerId !== actor.id;

    const sanitized = {
      ...request,
      versions: request.versions.map((v) => {
        // The snapshot's frozen display data carries the quote currency the
        // price was computed in (absent on pre-freeze snapshots).
        let quoteCurrency: string | null = null;
        if (v.snapshot?.displayJson) {
          try {
            const parsed = JSON.parse(v.snapshot.displayJson);
            quoteCurrency = typeof parsed.quoteCurrency === "string" ? parsed.quoteCurrency : null;
          } catch {
            quoteCurrency = null;
          }
        }
        const snapshotPublic = v.snapshot
          ? {
              id: v.snapshot.id,
              hash: v.snapshot.hash,
              engineVersion: v.snapshot.engineVersion,
              createdAt: v.snapshot.createdAt,
            }
          : null;
        return {
          ...v,
          quoteCurrency,
          snapshot: snapshotPublic,
          scenarios: v.scenarios.map((sc) => ({
            ...sc,
            resultJson: redactResults ? redactScenarioResultJson(sc.resultJson) : sc.resultJson,
          })),
          documents: v.documents
            // INTERNAL documents carry margins — advisors never see them,
            // not even as list metadata.
            .filter((d) => !advisorView || d.kind !== "INTERNAL")
            .map(publicDocumentView),
        };
      }),
    };
    return NextResponse.json(sanitized);
  } catch (err) {
    return travelError(err, "[API /travel/requests/[id]]");
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await getTravelActor();
  if (!actor) return unauthorized();

  const body = await req.json().catch(() => null);
  const parsed = patchBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
  }

  try {
    const updated = await updateDraft(actor, params.id, parsed.data.expectedRevision, parsed.data.patch);
    return NextResponse.json(updated);
  } catch (err) {
    return travelError(err, "[API /travel/requests/[id]]");
  }
}
