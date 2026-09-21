/**
 * WhatsApp delivery of rendered quotation PDFs.
 *
 * Shared by the manual send endpoint (app/api/travel/documents/[id]/send) and
 * the best-effort auto-send after submit()/issue() in workflow.ts. Delivery
 * failures are reported per recipient and never thrown — document generation
 * and workflow transitions must not depend on WhatsApp being connected.
 */

import { readFile } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import { sendWhatsAppMessage } from "@/lib/whatsapp";
import { ROLE_ADMIN, ROLE_VALIDATOR, versionLabel } from "@/lib/travel/contracts";

export interface DocumentSendResult {
  to: string;
  ok: boolean;
  error?: string;
}

/**
 * Sends the rendered PDF of a QuoteDocument to users (by id, resolved to
 * their WhatsApp phone) and/or WhatsApp groups (by @g.us jid).
 *
 * INTERNAL documents carry margins: they may only go to ADMIN/VALIDATOR
 * users or the request's currently assigned validator (any role — the
 * assignment itself grants internal visibility, v0.10.0). Other recipients
 * get a failure entry instead of the document.
 */
export async function sendQuoteDocument(
  documentId: string,
  targets: { userIds?: string[]; groupJids?: string[] },
  actorId: string | null,
): Promise<DocumentSendResult[]> {
  const doc = await prisma.quoteDocument.findUnique({
    where: { id: documentId },
    include: {
      version: {
        select: {
          versionNo: true,
          requestId: true,
          request: { select: { packageCode: true, ownerId: true } },
        },
      },
    },
  });
  if (!doc) return [{ to: documentId, ok: false, error: "document not found" }];

  const caption = `${doc.version.request.packageCode} ${versionLabel(doc.version.versionNo)} ${doc.kind}`;
  const filename = `${doc.version.request.packageCode}-${versionLabel(doc.version.versionNo)}-${doc.kind}.pdf`;

  let mediaBase64: string | null = null;
  let loadError: string | null = null;
  if (doc.filePath === "PENDING" || doc.filePath.startsWith("FAILED:")) {
    loadError = "document is not rendered yet";
  } else {
    try {
      mediaBase64 = (await readFile(doc.filePath)).toString("base64");
    } catch {
      loadError = "document file is missing";
    }
  }

  const assignment = await prisma.validationAssignment.findFirst({
    where: { requestId: doc.version.requestId, active: true },
    select: { validatorId: true },
  });

  const results: DocumentSendResult[] = [];

  for (const userId of targets.userIds ?? []) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, role: true, phone: true, active: true },
    });
    const label = user ? user.name || user.email : userId;
    if (!user || !user.active) {
      results.push({ to: label, ok: false, error: "user not found or inactive" });
      continue;
    }
    if (
      doc.kind === "INTERNAL" &&
      user.role !== ROLE_ADMIN &&
      user.role !== ROLE_VALIDATOR &&
      user.id !== assignment?.validatorId
    ) {
      results.push({ to: label, ok: false, error: "internal documents are restricted to validators/admins" });
      continue;
    }
    if (!user.phone) {
      results.push({ to: label, ok: false, error: "no WhatsApp phone on file" });
      continue;
    }
    results.push(await deliver(user.phone, label));
  }

  for (const jid of targets.groupJids ?? []) {
    if (!jid.endsWith("@g.us")) {
      results.push({ to: jid, ok: false, error: "not a WhatsApp group id" });
      continue;
    }
    results.push(await deliver(jid, jid));
  }

  async function deliver(destination: string, label: string): Promise<DocumentSendResult> {
    if (loadError) return { to: label, ok: false, error: loadError };
    try {
      await sendWhatsAppMessage({
        remoteJid: destination,
        body: caption,
        type: "document",
        mediaBase64: mediaBase64!,
        mediaMimeType: "application/pdf",
        mediaFilename: filename,
      });
      return { to: label, ok: true };
    } catch (err: any) {
      return { to: label, ok: false, error: err?.message ?? String(err) };
    }
  }

  await writeAuditLog(
    "QUOTE_DOCUMENT_SENT",
    actorId,
    `${caption}: ${results.filter((r) => r.ok).length} sent, ${results.filter((r) => !r.ok).length} failed` +
      (results.some((r) => !r.ok)
        ? ` — ${results.filter((r) => !r.ok).map((r) => `${r.to}: ${r.error}`).join("; ")}`
        : ""),
  );

  return results;
}
