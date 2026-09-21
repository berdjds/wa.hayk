import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import {
  ENGINE_VERSION,
  type EngineInput,
  type PolicyType,
  type RatePeriod,
  type ScenarioEngineInput,
} from "@/lib/travel/contracts";
import { addDays, calculate } from "@/lib/travel/engine";
import { getActivePolicy, getFxMap } from "@/lib/travel/settings";
import { getTravelActor, travelError, unauthorized } from "../guard";

const batchSchema = z.object({
  templateVersionId: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paxBands: z.array(z.number().int().min(1)).max(20).default([2, 4, 6]),
  hotelProductIds: z.array(z.string()).optional(),
  vehicleTypeId: z.string().optional(),
});

/**
 * Batch template pricing: runs the engine per PAX band on a synthetic
 * scenario derived from a template version — one full-tour stay on the
 * chosen (or first active) hotel with ceil(pax/2) DBL rooms, no service
 * lines (template day services are workbook-era refs, not catalog ids).
 * Invalid combinations are reported per band, never fatal.
 */
export async function POST(req: NextRequest) {
  const actor = await getTravelActor();
  if (!actor) return unauthorized();

  const body = await req.json().catch(() => null);
  const parsed = batchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
  }

  try {
    const { templateVersionId, startDate, paxBands, hotelProductIds } = parsed.data;

    const templateVersion = await prisma.templateVersion.findUnique({
      where: { id: templateVersionId },
      include: { template: true },
    });
    if (!templateVersion) {
      return NextResponse.json({ error: "Template version not found" }, { status: 404 });
    }

    const hotelId =
      hotelProductIds?.[0] ??
      (await prisma.hotelProduct.findFirst({ where: { active: true }, orderBy: { name: "asc" } }))?.id;
    if (!hotelId) {
      return NextResponse.json({ error: "No active hotel product available for batch pricing" }, { status: 400 });
    }
    const hotel = await prisma.hotelProduct.findUnique({ where: { id: hotelId } });
    if (!hotel) return NextResponse.json({ error: "Hotel product not found" }, { status: 404 });

    const rateRows = await prisma.rateVersion.findMany({
      where: { hotelProductId: hotelId, productType: "HOTEL", status: "VERIFIED", occupancy: "DBL" },
    });
    const endDate = addDays(startDate, templateVersion.nights);
    const dblRates: RatePeriod[] = rateRows.map((r) => ({
      from: r.validFrom ?? startDate,
      to: r.validTo ?? endDate,
      rate: r.amount,
      currency: r.currency,
      priority: r.priority,
      sourceRef: `RateVersion ${r.id} (${r.evidenceRef ?? "no evidence"})`,
    }));

    const policy = await getActivePolicy();
    const fxRates = await getFxMap(startDate);

    const results: unknown[] = [];
    for (const pax of paxBands) {
      const rooms = Math.ceil(pax / 2);
      const scenario: ScenarioEngineInput = {
        ref: `pax-${pax}`,
        label: `${templateVersion.template.code} — ${pax} pax`,
        tourStart: startDate,
        tourEnd: endDate,
        travelers: {
          adults: pax,
          children: 0,
          infants: 0,
          paying: pax,
          complimentary: 0,
          leaders: 0,
          staff: 0,
        },
        stays: [
          {
            ref: "stay-1",
            hotelName: hotel.name,
            city: hotel.city ?? undefined,
            checkIn: startDate,
            checkOut: endDate,
            roomAllocations: [
              {
                roomType: "DBL",
                rooms,
                adults: pax,
                children: 0,
                infants: 0,
                extraBeds: 0,
                capacityAdults: hotel.capacityAdults,
                capacityChildren: hotel.capacityChildren,
                capacityTotal: hotel.capacityTotal,
                extraBedAllowed: hotel.extraBedAllowed,
                extraBedIncludedInRate: false,
                wholeUnit: false,
              },
            ],
            rates: { DBL: dblRates },
          },
        ],
        services: [],
      };
      const input: EngineInput = {
        fx: { rates: fxRates, quoteCurrency: policy?.quoteCurrency ?? "USD" },
        policy: policy
          ? {
              type: policy.type as PolicyType,
              rate: policy.rate ?? undefined,
              minProfit: policy.minProfit ?? undefined,
              minProfitCurrency: policy.minProfitCurrency ?? undefined,
              feeFraction: policy.feeFraction ?? undefined,
              roundingIncrement: policy.roundingIncrement,
            }
          : { type: "MARKUP_ON_COST", roundingIncrement: "1" }, // → MISSING_POLICY per band
        scenarios: [scenario],
        engineVersion: ENGINE_VERSION,
      };
      const output = calculate(input);
      const sc = output.scenarios[0];
      results.push({
        pax,
        valid: sc.valid,
        sell: sc.valid ? sc.sell : null,
        perPayingPerson: sc.valid ? sc.perPayingPerson : null,
        issues: sc.issues,
      });
    }

    const run = await prisma.batchRun.create({
      data: {
        templateVersionId,
        paramsJson: JSON.stringify(parsed.data),
        resultsJson: JSON.stringify(results),
        createdById: actor.id,
      },
    });
    await writeAuditLog(
      "BATCH_RUN_CREATED",
      actor.id,
      `Batch pricing ${templateVersion.template.code} from ${startDate} for bands [${paxBands.join(", ")}]`,
    );

    return NextResponse.json({ batchRunId: run.id, results });
  } catch (err) {
    return travelError(err, "[API /travel/batch]");
  }
}
