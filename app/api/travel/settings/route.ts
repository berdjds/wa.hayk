import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { getTravelSettings } from "@/lib/travel/settings";
import { getTravelActor, travelError, unauthorized } from "../guard";

const updateSettingsSchema = z.object({
  companyTz: z.string().min(1).optional(),
  overdueReminderHours: z.number().int().min(1).nullish(),
  escalationUserId: z.string().nullish(),
  requireSettingsForIssue: z.boolean().optional(),
  documentsDir: z.string().min(1).optional(),
  /** Activates this PricingPolicyVersion (deactivating all others). */
  activatePolicyId: z.string().nullish(),
});

export async function GET() {
  const actor = await getTravelActor();
  if (!actor) return unauthorized();

  try {
    const settings = await getTravelSettings();
    const activePolicy = await prisma.pricingPolicyVersion.findFirst({
      where: { active: true },
    });
    // Non-admin roles (advisors) must not read markup/margin policy — only
    // the currency a quote will be priced in.
    if (actor.role !== "ADMIN") {
      return NextResponse.json({
        settings,
        activePolicy: activePolicy ? { quoteCurrency: activePolicy.quoteCurrency } : null,
      });
    }
    return NextResponse.json({ settings, activePolicy });
  } catch (err) {
    return travelError(err, "[API /travel/settings]");
  }
}

export async function PUT(req: NextRequest) {
  const actor = await getTravelActor();
  if (!actor) return unauthorized();
  if (actor.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = updateSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
  }

  try {
    const { activatePolicyId, ...settingsPatch } = parsed.data;

    if (activatePolicyId) {
      const policy = await prisma.pricingPolicyVersion.findUnique({
        where: { id: activatePolicyId },
      });
      if (!policy) {
        return NextResponse.json({ error: "Policy version not found" }, { status: 404 });
      }
      // Exactly one active policy: deactivate all, then activate the target.
      await prisma.$transaction([
        prisma.pricingPolicyVersion.updateMany({ where: { active: true }, data: { active: false } }),
        prisma.pricingPolicyVersion.update({ where: { id: activatePolicyId }, data: { active: true } }),
        prisma.travelSettings.update({
          where: { id: "default" },
          data: { defaultPolicyId: activatePolicyId },
        }),
      ]);
      await writeAuditLog("TRAVEL_POLICY_ACTIVATED", actor.id, `Activated policy ${policy.name} (${policy.id})`);
    }

    let settings = await getTravelSettings();
    if (Object.keys(settingsPatch).length > 0) {
      settings = await prisma.travelSettings.update({
        where: { id: "default" },
        data: settingsPatch,
      });
      await writeAuditLog("TRAVEL_SETTINGS_UPDATED", actor.id, JSON.stringify(settingsPatch));
    }

    return NextResponse.json(settings);
  } catch (err) {
    return travelError(err, "[API /travel/settings]");
  }
}
