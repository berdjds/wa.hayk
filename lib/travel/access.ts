/**
 * Travel module access check (server-only — queries the DB).
 *
 * Travel roles (ADMIN / ADVISOR / VALIDATOR) always have access. Any other
 * user gets in when they hold at least one active validation assignment
 * (v0.10.0: any active user can be assigned as validator; assignment is what
 * grants review rights). Per-action RBAC still applies inside the workflow
 * layer — this helper only gates module entry.
 */

import { prisma } from "@/lib/prisma";
import { isTravelRole } from "@/lib/travel/contracts";

export async function canAccessTravel(userId: string, role: string | undefined): Promise<boolean> {
  if (isTravelRole(role)) return true;
  const assignment = await prisma.validationAssignment.findFirst({
    where: { validatorId: userId, active: true },
    select: { id: true },
  });
  return assignment !== null;
}
