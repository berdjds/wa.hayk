"use client";

import { useState } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { versionLabel } from "@/lib/travel/contracts";
import { StateBadge, apiError, formatDateTime, shortHash } from "../utils";
import type { DetailContext } from "./RequestDetail";

export default function DocumentsTab({ ctx }: { ctx: DetailContext }) {
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  const docs = ctx.detail.versions
    .flatMap((v) => v.documents.map((d) => ({ ...d, versionNo: v.versionNo, versionId: v.id })))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  async function handleRetry(versionId: string, documentId: string) {
    setBusyId(documentId);
    try {
      await axios.post(`/api/travel/versions/${versionId}/issue`, { retryDocumentId: documentId });
      toast("Document regenerated", "success");
      ctx.refresh();
    } catch (err) {
      toast(apiError(err, "Retry failed"), "error");
    } finally {
      setBusyId(null);
    }
  }

  const canRetry = ctx.isAdmin;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Documents</CardTitle>
        <CardDescription>Generated documents for this request. The list is filtered to your role.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-left">
              <tr>
                <th className="pb-2 font-medium">Version</th>
                <th className="pb-2 font-medium">Kind</th>
                <th className="pb-2 font-medium">State</th>
                <th className="pb-2 font-medium">Created</th>
                <th className="pb-2 font-medium">Issued at</th>
                <th className="pb-2 font-medium">SHA-256</th>
                <th className="pb-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {docs.map((d) => (
                <tr key={d.id}>
                  <td className="py-2">{versionLabel(d.versionNo)}</td>
                  <td className="py-2">{d.kind}</td>
                  <td className="py-2">
                    <StateBadge value={d.renderState} />
                  </td>
                  <td className="py-2 whitespace-nowrap">{formatDateTime(d.createdAt)}</td>
                  <td className="py-2 whitespace-nowrap">{formatDateTime(d.issuedAt)}</td>
                  <td className="py-2 font-mono text-xs">{shortHash(d.sha256)}</td>
                  <td className="py-2">
                    <div className="flex gap-2">
                      {d.renderState === "READY" && (
                        <a href={`/api/travel/documents/${d.id}`} target="_blank" rel="noreferrer">
                          <Button size="sm" variant="outline">
                            Download
                          </Button>
                        </a>
                      )}
                      {d.renderState === "FAILED" && canRetry && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busyId === d.id}
                          onClick={() => handleRetry(d.versionId, d.id)}
                        >
                          {busyId === d.id ? "Retrying..." : "Retry render"}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {docs.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-muted-foreground">
                    No documents yet — issue an approved version to generate the client PDF.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
