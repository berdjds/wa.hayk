"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { PageHeader } from "./TravelShell";
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
    <>
      <PageHeader
        title="Review queue"
        subtitle={
          role === "ADMIN"
            ? "All requests pending validation."
            : "Requests assigned to you for validation — open one to review its snapshot and record a decision."
        }
      />
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Package code</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Agency</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead>Owner</TableHead>
                {role === "ADMIN" && <TableHead>Validator</TableHead>}
                <TableHead>Status</TableHead>
                <TableHead className="pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="pl-4 font-mono text-xs">{r.packageCode}</TableCell>
                  <TableCell>{r.title}</TableCell>
                  <TableCell>{r.agency.shortCode}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {r.startDate} → {r.endDate}
                  </TableCell>
                  <TableCell>{r.owner.name || r.owner.email}</TableCell>
                  {role === "ADMIN" && (
                    <TableCell>{r.validator ? r.validator.name || r.validator.email : "—"}</TableCell>
                  )}
                  <TableCell>
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <Button size="sm" onClick={() => (window.location.href = `/travel/requests/${r.id}`)}>
                      Review
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                    Nothing pending validation.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
