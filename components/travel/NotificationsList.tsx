"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import TravelShell from "./TravelShell";
import { StateBadge, apiError, formatDateTime } from "./utils";
import type { NotificationDeliveryView } from "./types";

interface NotificationsListProps {
  role: string;
  userId: string;
}

export default function NotificationsList({ role }: NotificationsListProps) {
  const { toast } = useToast();
  const [deliveries, setDeliveries] = useState<NotificationDeliveryView[]>([]);
  const [status, setStatus] = useState("ALL");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  const isAdmin = role === "ADMIN";

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (status !== "ALL") params.set("status", status);
    axios
      .get(`/api/travel/notifications?${params.toString()}`)
      .then((res) => setDeliveries(res.data))
      .catch((err) => toast(apiError(err, "Failed to load notifications"), "error"));
  }, [status, toast]);

  useEffect(load, [load]);

  async function retry(id: string) {
    setBusyId(id);
    try {
      await axios.post("/api/travel/notifications/retry", { ids: [id] });
      toast("Delivery requeued", "success");
      load();
    } catch (err) {
      toast(apiError(err, "Retry failed"), "error");
    } finally {
      setBusyId(null);
    }
  }

  async function processQueue() {
    setProcessing(true);
    try {
      const res = await axios.post("/api/travel/notifications/process", { limit: 50 });
      toast(`Queue processed: ${JSON.stringify(res.data)}`, "success");
      load();
    } catch (err) {
      toast(apiError(err, "Process failed"), "error");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <TravelShell
      title="Notifications"
      subtitle={isAdmin ? "All workflow notification deliveries." : "Your workflow notification deliveries."}
      role={role}
      current="notifications"
    >
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>Deliveries</CardTitle>
              <CardDescription>Transactional outbox — one row per event, recipient and channel.</CardDescription>
            </div>
            {isAdmin && (
              <Button variant="outline" onClick={processQueue} disabled={processing}>
                {processing ? "Processing..." : "Process queue"}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              <SelectItem value="QUEUED">Queued</SelectItem>
              <SelectItem value="SENT">Sent</SelectItem>
              <SelectItem value="FAILED">Failed</SelectItem>
              <SelectItem value="SKIPPED_NO_DESTINATION">Skipped (no destination)</SelectItem>
            </SelectContent>
          </Select>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left">
                <tr>
                  <th className="pb-2 font-medium">Event</th>
                  <th className="pb-2 font-medium">Channel</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Destination</th>
                  <th className="pb-2 font-medium">Body</th>
                  <th className="pb-2 font-medium">Error</th>
                  <th className="pb-2 font-medium">Created</th>
                  {isAdmin && <th className="pb-2 font-medium"></th>}
                </tr>
              </thead>
              <tbody className="divide-y">
                {deliveries.map((d) => (
                  <tr key={d.id}>
                    <td className="py-2">
                      <a className="underline" href={`/travel/requests/${d.event.requestId}`}>
                        {d.event.type.replace(/_/g, " ")}
                      </a>
                    </td>
                    <td className="py-2">
                      <Badge variant={d.channel === "WHATSAPP" ? "default" : "secondary"}>{d.channel}</Badge>
                    </td>
                    <td className="py-2">
                      <StateBadge value={d.status} />
                      {d.attempts > 0 && <span className="ml-1 text-xs text-muted-foreground">×{d.attempts}</span>}
                    </td>
                    <td className="py-2 text-xs">{d.destination ?? "—"}</td>
                    <td className="max-w-xs py-2">
                      <span className="line-clamp-2 text-xs">{d.body}</span>
                    </td>
                    <td className="max-w-xs py-2">
                      <span className="line-clamp-2 text-xs text-red-700">{d.lastError ?? ""}</span>
                    </td>
                    <td className="py-2 whitespace-nowrap text-xs">{formatDateTime(d.createdAt)}</td>
                    {isAdmin && (
                      <td className="py-2">
                        {d.status === "FAILED" && (
                          <Button size="sm" variant="outline" disabled={busyId === d.id} onClick={() => retry(d.id)}>
                            Retry
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
                {deliveries.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-muted-foreground">
                      No deliveries.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </TravelShell>
  );
}
