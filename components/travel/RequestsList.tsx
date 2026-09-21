"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { QUOTE_STATUSES } from "@/lib/travel/contracts";
import TravelShell from "./TravelShell";
import TravelerSetupEditor from "./TravelerSetupEditor";
import { StatusBadge, apiError } from "./utils";
import type { Agency, RequestListItem, TravelerSetupView } from "./types";

const EMPTY_TRAVELERS: TravelerSetupView = {
  adults: 2,
  children: 0,
  infants: 0,
  childAges: [],
  // Operator default: one paying traveler until adjusted — deliberately not
  // adults+children, so the auto-follow logic in TravelerSetupEditor leaves it alone.
  paying: 1,
  complimentary: 0,
  leaders: 0,
  staff: 0,
};

interface RequestsListProps {
  role: string;
  userId: string;
}

export default function RequestsList({ role, userId }: RequestsListProps) {
  const { toast } = useToast();
  const [requests, setRequests] = useState<RequestListItem[]>([]);
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("ALL");
  const [onlyMine, setOnlyMine] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    agencyId: "",
    title: "",
    startDate: "",
    endDate: "",
    notes: "",
    travelers: { ...EMPTY_TRAVELERS },
  });

  const canCreate = role === "ADMIN" || role === "ADVISOR";
  const invalidDates = form.startDate !== "" && form.endDate !== "" && !(form.endDate > form.startDate);

  const fetchRequests = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (status !== "ALL") params.set("status", status);
      if (onlyMine && role !== "ADVISOR") params.set("ownerId", userId);
      const res = await axios.get(`/api/travel/requests?${params.toString()}`);
      setRequests(res.data);
    } catch (err) {
      toast(apiError(err, "Failed to load requests"), "error");
    }
  }, [q, status, onlyMine, role, userId, toast]);

  // Debounce the search box; status/mine changes refetch immediately.
  useEffect(() => {
    const t = setTimeout(fetchRequests, 300);
    return () => clearTimeout(t);
  }, [fetchRequests]);

  useEffect(() => {
    axios
      .get("/api/travel/agencies")
      .then((res) => setAgencies(res.data))
      .catch(() => toast("Failed to load agencies", "error"));
  }, [toast]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.agencyId) {
      toast("Pick an agency", "error");
      return;
    }
    setSaving(true);
    try {
      const res = await axios.post("/api/travel/requests", {
        agencyId: form.agencyId,
        title: form.title,
        startDate: form.startDate,
        endDate: form.endDate,
        travelers: form.travelers,
        notes: form.notes || null,
      });
      toast(`Created ${res.data.request.packageCode}`, "success");
      window.location.href = `/travel/requests/${res.data.request.id}`;
    } catch (err) {
      toast(apiError(err, "Failed to create request"), "error");
      setSaving(false);
    }
  }

  function setTravelers(travelers: TravelerSetupView) {
    setForm((f) => ({ ...f, travelers }));
  }

  return (
    <TravelShell title="Travel Requests" subtitle="B2B quotations and packages." role={role} current="requests">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>Requests</CardTitle>
              <CardDescription>
                {role === "ADVISOR" ? "Your quotation requests." : "All quotation requests."}
              </CardDescription>
            </div>
            {canCreate && <Button onClick={() => setCreateOpen(true)}>New request</Button>}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder="Search code, title, agency..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="max-w-xs"
            />
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                {QUOTE_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {role !== "ADVISOR" && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
                Owned by me
              </label>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left">
                <tr>
                  <th className="pb-2 font-medium">Package code</th>
                  <th className="pb-2 font-medium">Title</th>
                  <th className="pb-2 font-medium">Agency</th>
                  <th className="pb-2 font-medium">Dates</th>
                  <th className="pb-2 font-medium">Owner</th>
                  <th className="pb-2 font-medium">Validator</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {requests.map((r) => (
                  <tr
                    key={r.id}
                    className="cursor-pointer hover:bg-accent"
                    onClick={() => (window.location.href = `/travel/requests/${r.id}`)}
                  >
                    <td className="py-2 font-mono text-xs">{r.packageCode}</td>
                    <td className="py-2">{r.title}</td>
                    <td className="py-2">
                      {r.agency.shortCode} — {r.agency.name}
                    </td>
                    <td className="py-2 whitespace-nowrap">
                      {r.startDate} → {r.endDate}
                    </td>
                    <td className="py-2">{r.owner.name || r.owner.email}</td>
                    <td className="py-2">{r.validator ? r.validator.name || r.validator.email : "—"}</td>
                    <td className="py-2">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="py-2 whitespace-nowrap">{new Date(r.updatedAt).toLocaleString()}</td>
                  </tr>
                ))}
                {requests.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-muted-foreground">
                      No requests found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>New travel request</DialogTitle>
            <DialogDescription>The package code is generated from the agency and today&apos;s date.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Agency</Label>
                <Select value={form.agencyId} onValueChange={(v) => setForm({ ...form, agencyId: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select agency" />
                  </SelectTrigger>
                  <SelectContent>
                    {agencies.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.shortCode} — {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Title</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
              </div>
              <div>
                <Label>Start date</Label>
                <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required />
              </div>
              <div>
                <Label>End date</Label>
                <Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} required />
              </div>
            </div>
            {invalidDates && <p className="text-xs text-red-600">End date must be after the start date.</p>}
            <div>
              <Label>Travelers</Label>
              <TravelerSetupEditor value={form.travelers} onChange={setTravelers} />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={saving || invalidDates}>
                {saving ? "Creating..." : "Create request"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </TravelShell>
  );
}
