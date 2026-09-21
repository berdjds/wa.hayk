import { prisma } from "@/lib/prisma";

/**
 * Writes an audit log entry. Never throws: audit logging must not fail the
 * underlying action. If the user id does not exist in the database (stale JWT
 * after a database reset), retries with userId = null ("System").
 */
export async function writeAuditLog(
  action: string,
  userId: string | null | undefined,
  details?: string
) {
  try {
    await prisma.log.create({
      data: { action, userId: userId ?? null, details },
    });
  } catch (err: any) {
    if (userId && err?.code === "P2003") {
      try {
        await prisma.log.create({
          data: { action, userId: null, details: `${details || ""} (user ${userId} no longer exists)`.trim() },
        });
        return;
      } catch (retryErr: any) {
        console.error("[audit] retry failed:", retryErr?.message || retryErr);
        return;
      }
    }
    console.error("[audit] failed to write log:", err?.message || err);
  }
}
