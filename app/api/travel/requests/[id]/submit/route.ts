import { NextRequest, NextResponse } from "next/server";
import { submit } from "@/lib/travel/workflow";
import { getTravelActor, travelError, unauthorized } from "../../../guard";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await getTravelActor();
  if (!actor) return unauthorized();

  try {
    const submitted = await submit(actor, params.id);
    // submit() asserts owner-or-admin, so an ADVISOR here is the request owner —
    // and the owner sees full costing (v0.11.0). Redaction would only apply to
    // a non-owner advisor, who cannot submit.
    return NextResponse.json(submitted);
  } catch (err) {
    return travelError(err, "[API /travel/requests/[id]/submit]");
  }
}
