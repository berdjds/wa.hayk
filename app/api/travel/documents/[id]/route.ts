import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { ROLE_ADMIN, ROLE_VALIDATOR } from "@/lib/travel/contracts";
import { getTravelActor, travelError, unauthorized } from "../../guard";

// Streams a quotation PDF. CLIENT documents: request owner, the currently
// assigned validator or ADMIN (others get 404 — existence is not disclosed);
// INTERNAL: ADMIN/VALIDATOR only. The filesystem path is never exposed.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await getTravelActor();
  if (!actor) return unauthorized();

  try {
    const doc = await prisma.quoteDocument.findUnique({
      where: { id: params.id },
      include: { version: { select: { requestId: true, request: { select: { ownerId: true } } } } },
    });
    if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (doc.kind === "INTERNAL") {
      if (actor.role !== ROLE_ADMIN && actor.role !== ROLE_VALIDATOR) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    } else if (actor.role !== ROLE_ADMIN) {
      const isOwner = doc.version.request.ownerId === actor.id;
      let isAssignedValidator = false;
      if (actor.role === ROLE_VALIDATOR) {
        const assignment = await prisma.validationAssignment.findFirst({
          where: { requestId: doc.version.requestId, active: true },
          select: { validatorId: true },
        });
        isAssignedValidator = assignment?.validatorId === actor.id;
      }
      if (!isOwner && !isAssignedValidator) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
    }

    if (doc.filePath === "PENDING" || doc.filePath.startsWith("FAILED:")) {
      return NextResponse.json({ error: "Document is not rendered yet" }, { status: 404 });
    }

    let bytes: Buffer;
    try {
      bytes = await readFile(doc.filePath);
    } catch {
      return NextResponse.json({ error: "Document file is missing" }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${doc.id}.pdf"`,
        "X-Content-SHA256": doc.sha256,
      },
    });
  } catch (err) {
    return travelError(err, "[API /travel/documents/[id]]");
  }
}
