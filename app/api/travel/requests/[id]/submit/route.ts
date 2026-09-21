import { NextRequest, NextResponse } from "next/server";
import { ROLE_ADVISOR } from "@/lib/travel/contracts";
import { redactScenarioResult } from "@/lib/travel/redact";
import { submit } from "@/lib/travel/workflow";
import { getTravelActor, travelError, unauthorized } from "../../../guard";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const actor = await getTravelActor();
  if (!actor) return unauthorized();

  try {
    const submitted = await submit(actor, params.id);
    // Advisors get the binding identity (versionId/hash) and the sell-side
    // scenario summary — never the full engine result with internal costing.
    if (actor.role === ROLE_ADVISOR) {
      return NextResponse.json({
        versionId: submitted.versionId,
        hash: submitted.hash,
        quoteCurrency: submitted.quoteCurrency,
        scenarios: submitted.result.scenarios.map(redactScenarioResult),
      });
    }
    return NextResponse.json(submitted);
  } catch (err) {
    return travelError(err, "[API /travel/requests/[id]/submit]");
  }
}
