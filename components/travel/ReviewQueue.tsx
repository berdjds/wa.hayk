"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import TravelShell from "./TravelShell";
import { StatusBadge, apiError } from "./utils";
import type { RequestListItem } from "./types";

interface ReviewQueueProps {
  role: string;
  userId: string;
}

export default function ReviewQueue({ role, userId }: ReviewQueueProps) {
  const { toast } = useToast();
  const [items, setItems] = useState<RequestListItem[]>([]);

  useEffect(() => {
    axios
      .get("/api/travel/requests?status=PENDING_VALIDATION")
      .then((res) => {
        const all: RequestListItem[] = res.data;
        // Validators act on their own assignments; admins see the whole queue.
        setItems(role === "ADMIN" ? all : all.filter((r) => r.validator?.id === userId));
      })
      .catch((err) => toast(apiError(err, "Failed to load review queue"), "error"));
  }, [role, userId, toast]);

  return (
    <TravelShell
      title="Review queue"
      subtitle={role === "ADMIN" ? "All requests pending validation." : "Requests assigned to you for validation."}
      role={role}
      current="review"
    >
      <Card>
        <CardHeader>
          <CardTitle>Pending validation ({items.length})</CardTitle>
          <CardDescription>Open a request to review its snapshot and record a decision.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left">
                <tr>
                  <th className="pb-2 font-medium">Package code</th>
                  <th className="pb-2 font-medium">Title</th>
                  <th className="pb-2 font-medium">Agency</th>
                  <th className="pb-2 font-medium">Dates</th>
                  <th className="pb-2 font-medium">Owner</th>
                  {role === "ADMIN" && <th className="pb-2 font-medium">Validator</th>}
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2 font-mono text-xs">{r.packageCode}</td>
                    <td className="py-2">{r.title}</td>
                    <td className="py-2">{r.agency.shortCode}</td>
                    <td className="py-2 whitespace-nowrap">
                      {r.startDate} → {r.endDate}
                    </td>
                    <td className="py-2">{r.owner.name || r.owner.email}</td>
                    {role === "ADMIN" && (
                      <td className="py-2">{r.validator ? r.validator.name || r.validator.email : "—"}</td>
                    )}
                    <td className="py-2">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="py-2">
                      <Button size="sm" onClick={() => (window.location.href = `/travel/requests/${r.id}`)}>
                        Review
                      </Button>
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-muted-foreground">
                      Nothing pending validation.
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
