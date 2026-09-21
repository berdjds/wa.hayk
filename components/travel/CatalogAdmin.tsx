"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { COST_CATEGORIES, RATE_STATUSES } from "@/lib/travel/contracts";
import TravelShell from "./TravelShell";
import { StateBadge, apiError, formatDateTime, money, parseJson } from "./utils";
import type {
  Agency,
  FxVersionView,
  HotelProductView,
  ImportBatchView,
  ImportRowView,
  PolicyView,
  RateView,
  ServiceProductView,
} from "./types";

interface CatalogAdminProps {
  role: string;
  userId: string;
}

export default function CatalogAdmin({ role, userId }: CatalogAdminProps) {
  return (
    <TravelShell title="Travel catalog" subtitle="Hotels, services, rates, FX, policies, imports and agencies." role={role} current="catalog">
      <Tabs defaultValue="hotels" className="space-y-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="hotels">Hotels</TabsTrigger>
          <TabsTrigger value="services">Services</TabsTrigger>
          <TabsTrigger value="rates">Rates</TabsTrigger>
          <TabsTrigger value="fxpolicy">FX &amp; Policy</TabsTrigger>
          <TabsTrigger value="imports">Imports</TabsTrigger>
          <TabsTrigger value="agencies">Agencies</TabsTrigger>
        </TabsList>
        <TabsContent value="hotels">
          <HotelsTab />
        </TabsContent>
        <TabsContent value="services">
          <ServicesTab />
        </TabsContent>
        <TabsContent value="rates">
          <RatesTab />
        </TabsContent>
        <TabsContent value="fxpolicy">
          <FxPolicyTab />
        </TabsContent>
        <TabsContent value="imports">
          <ImportsTab />
        </TabsContent>
        <TabsContent value="agencies">
          <AgenciesTab />
        </TabsContent>
      </Tabs>
    </TravelShell>
  );
}

// ---------------------------------------------------------------------------

function rateSummary(r: RateView): string {
  const range = `${r.validFrom ?? "…"}→${r.validTo ?? "…"}`;
  const amount = r.amount == null ? "TBC" : money(r.amount, r.currency);
  return `${r.occupancy ?? "-"}${r.board ? `/${r.board}` : ""} ${amount} (${range})`;
}

function HotelsTab() {
  const { toast } = useToast();
  const [hotels, setHotels] = useState<HotelProductView[]>([]);
  const [q, setQ] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      axios
        .get(`/api/travel/catalog/hotels?q=${encodeURIComponent(q)}`)
        .then((res) => setHotels(res.data))
        .catch((err) => toast(apiError(err, "Failed to load hotels"), "error"));
    }, 300);
    return () => clearTimeout(t);
  }, [q, toast]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Hotel products</CardTitle>
        <CardDescription>Read-only catalog; verify rates on the Rates tab.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input placeholder="Search hotels..." value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-left">
              <tr>
                <th className="pb-2 font-medium">Name</th>
                <th className="pb-2 font-medium">City</th>
                <th className="pb-2 font-medium">Kind</th>
                <th className="pb-2 font-medium">Capacity</th>
                <th className="pb-2 font-medium">Boards</th>
                <th className="pb-2 font-medium">Supplier</th>
                <th className="pb-2 font-medium">Rates</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {hotels.map((h) => (
                <tr key={h.id}>
                  <td className="py-2">
                    {h.name}
                    {h.stars ? <span className="text-muted-foreground"> ({h.stars}★)</span> : null}
                  </td>
                  <td className="py-2">{h.city ?? "—"}</td>
                  <td className="py-2">{h.kind}</td>
                  <td className="py-2">
                    {h.capacityAdults}A/{h.capacityChildren}C (max {h.capacityTotal})
                    {h.extraBedAllowed ? " +EB" : ""}
                  </td>
                  <td className="py-2">{parseJson<string[]>(h.boardOptions, []).join(", ") || "—"}</td>
                  <td className="py-2">{h.supplier?.name ?? "—"}</td>
                  <td className="py-2">
                    {h.rates.length === 0 ? (
                      <span className="text-muted-foreground">none</span>
                    ) : (
                      <ul className="space-y-0.5 text-xs">
                        {h.rates.map((r) => (
                          <li key={r.id} className="flex items-center gap-1">
                            <StateBadge value={r.status} className="px-1.5 py-0 text-[10px]" />
                            {rateSummary(r)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function ServicesTab() {
  const { toast } = useToast();
  const [services, setServices] = useState<ServiceProductView[]>([]);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("ALL");

  useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (category !== "ALL") params.set("category", category);
      axios
        .get(`/api/travel/catalog/services?${params.toString()}`)
        .then((res) => setServices(res.data))
        .catch((err) => toast(apiError(err, "Failed to load services"), "error"));
    }, 300);
    return () => clearTimeout(t);
  }, [q, category, toast]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Service products</CardTitle>
        <CardDescription>Read-only catalog.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input placeholder="Search services..." value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All categories</SelectItem>
              {COST_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-left">
              <tr>
                <th className="pb-2 font-medium">Name</th>
                <th className="pb-2 font-medium">Category</th>
                <th className="pb-2 font-medium">Basis</th>
                <th className="pb-2 font-medium">Supplier</th>
                <th className="pb-2 font-medium">Rates</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {services.map((s) => (
                <tr key={s.id}>
                  <td className="py-2">{s.name}</td>
                  <td className="py-2">{s.category.replace(/_/g, " ")}</td>
                  <td className="py-2">{s.basis.replace(/_/g, " ")}</td>
                  <td className="py-2">{s.supplier?.name ?? "—"}</td>
                  <td className="py-2">
                    {s.rates.length === 0 ? (
                      <span className="text-muted-foreground">none</span>
                    ) : (
                      <ul className="space-y-0.5 text-xs">
                        {s.rates.map((r) => (
                          <li key={r.id} className="flex items-center gap-1">
                            <StateBadge value={r.status} className="px-1.5 py-0 text-[10px]" />
                            {rateSummary(r)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function RatesTab() {
  const { toast } = useToast();
  const [rates, setRates] = useState<RateView[]>([]);
  const [status, setStatus] = useState("NEEDS_REVIEW");
  const [productType, setProductType] = useState("ALL");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (status !== "ALL") params.set("status", status);
    if (productType !== "ALL") params.set("productType", productType);
    axios
      .get(`/api/travel/catalog/rates?${params.toString()}`)
      .then((res) => setRates(res.data))
      .catch((err) => toast(apiError(err, "Failed to load rates"), "error"));
  }, [status, productType, toast]);

  useEffect(load, [load]);

  async function patchRate(id: string, nextStatus: string) {
    setBusyId(id);
    try {
      await axios.patch(`/api/travel/catalog/rates/${id}`, { status: nextStatus });
      toast(`Rate ${nextStatus.toLowerCase().replace(/_/g, " ")}`, "success");
      load();
    } catch (err) {
      toast(apiError(err, "Failed to update rate"), "error");
    } finally {
      setBusyId(null);
    }
  }

  function productName(r: RateView): string {
    return r.hotelProduct?.name ?? r.vehicleType?.name ?? r.serviceProduct?.name ?? "—";
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Rate versions</CardTitle>
        <CardDescription>Rates are archived, never deleted — they are the evidence trail for snapshots.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {RATE_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={productType} onValueChange={setProductType}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All types</SelectItem>
              <SelectItem value="HOTEL">Hotel</SelectItem>
              <SelectItem value="VEHICLE">Vehicle</SelectItem>
              <SelectItem value="SERVICE">Service</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-left">
              <tr>
                <th className="pb-2 font-medium">Product</th>
                <th className="pb-2 font-medium">Occ / board</th>
                <th className="pb-2 font-medium">Amount</th>
                <th className="pb-2 font-medium">Validity</th>
                <th className="pb-2 font-medium">Evidence</th>
                <th className="pb-2 font-medium">Notes</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rates.map((r) => (
                <tr key={r.id}>
                  <td className="py-2">
                    {productName(r)}
                    <span className="ml-1 text-xs text-muted-foreground">({r.productType})</span>
                  </td>
                  <td className="py-2">
                    {r.occupancy ?? "—"}
                    {r.board ? ` / ${r.board}` : ""}
                  </td>
                  <td className="py-2">{r.amount == null ? "TBC" : money(r.amount, r.currency)}</td>
                  <td className="py-2 whitespace-nowrap text-xs">
                    {r.validFrom ?? "…"} → {r.validTo ?? "…"}
                  </td>
                  <td className="py-2 text-xs">{r.evidenceRef ?? "—"}</td>
                  <td className="py-2 text-xs">{r.notes ?? "—"}</td>
                  <td className="py-2">
                    <StateBadge value={r.status} />
                  </td>
                  <td className="py-2">
                    <div className="flex gap-1">
                      {r.status === "NEEDS_REVIEW" && (
                        <Button size="sm" variant="outline" disabled={busyId === r.id} onClick={() => patchRate(r.id, "VERIFIED")}>
                          Verify
                        </Button>
                      )}
                      {r.status !== "ARCHIVED" && (
                        <Button size="sm" variant="ghost" disabled={busyId === r.id} onClick={() => patchRate(r.id, "ARCHIVED")}>
                          Archive
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {rates.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-muted-foreground">
                    No rates for this filter.
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

function FxPolicyTab() {
  const { toast } = useToast();
  const [fx, setFx] = useState<FxVersionView[]>([]);
  const [policies, setPolicies] = useState<PolicyView[]>([]);
  const [fxForm, setFxForm] = useState({ currency: "", amdPerUnit: "", effectiveFrom: "" });
  const [policyForm, setPolicyForm] = useState({
    name: "",
    type: "MARKUP_ON_COST",
    rate: "",
    minProfit: "",
    minProfitCurrency: "USD",
    feeFraction: "",
    roundingIncrement: "1",
    quoteCurrency: "USD",
    allowBelowFloorException: false,
  });

  const load = useCallback(() => {
    axios.get("/api/travel/fx").then((res) => setFx(res.data)).catch(() => toast("Failed to load FX", "error"));
    axios
      .get("/api/travel/policies")
      .then((res) => setPolicies(res.data))
      .catch(() => toast("Failed to load policies", "error"));
  }, [toast]);

  useEffect(load, [load]);

  async function addFx(e: React.FormEvent) {
    e.preventDefault();
    try {
      await axios.post("/api/travel/fx", fxForm);
      toast("FX rate added", "success");
      setFxForm({ currency: "", amdPerUnit: "", effectiveFrom: "" });
      load();
    } catch (err) {
      toast(apiError(err, "Failed to add FX rate"), "error");
    }
  }

  async function addPolicy(e: React.FormEvent) {
    e.preventDefault();
    try {
      await axios.post("/api/travel/policies", {
        ...policyForm,
        rate: policyForm.rate || null,
        minProfit: policyForm.minProfit || null,
        minProfitCurrency: policyForm.minProfit ? policyForm.minProfitCurrency : null,
        feeFraction: policyForm.feeFraction || null,
      });
      toast("Policy version created (inactive until activated)", "success");
      setPolicyForm({ ...policyForm, name: "", rate: "", minProfit: "", feeFraction: "" });
      load();
    } catch (err) {
      toast(apiError(err, "Failed to create policy"), "error");
    }
  }

  async function activatePolicy(id: string) {
    try {
      await axios.put("/api/travel/settings", { activatePolicyId: id });
      toast("Policy activated", "success");
      load();
    } catch (err) {
      toast(apiError(err, "Failed to activate policy"), "error");
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>FX rates</CardTitle>
          <CardDescription>AMD per 1 unit, by effective date. AMD = 1 implicitly.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={addFx} className="grid gap-2 sm:grid-cols-4">
            <Input
              placeholder="USD"
              maxLength={3}
              value={fxForm.currency}
              onChange={(e) => setFxForm({ ...fxForm, currency: e.target.value.toUpperCase() })}
              required
            />
            <Input
              placeholder="AMD per unit"
              value={fxForm.amdPerUnit}
              onChange={(e) => setFxForm({ ...fxForm, amdPerUnit: e.target.value })}
              required
            />
            <Input
              type="date"
              value={fxForm.effectiveFrom}
              onChange={(e) => setFxForm({ ...fxForm, effectiveFrom: e.target.value })}
              required
            />
            <Button type="submit">Add</Button>
          </form>
          <div className="max-h-[400px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left">
                <tr>
                  <th className="pb-2 font-medium">Currency</th>
                  <th className="pb-2 font-medium">AMD per unit</th>
                  <th className="pb-2 font-medium">Effective from</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {fx.map((f) => (
                  <tr key={f.id}>
                    <td className="py-2 font-medium">{f.currency}</td>
                    <td className="py-2">{f.amdPerUnit}</td>
                    <td className="py-2">{f.effectiveFrom}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pricing policies</CardTitle>
          <CardDescription>Exactly one policy is active; creating adds a new inactive version.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={addPolicy} className="grid gap-2 sm:grid-cols-3">
            <Input
              placeholder="Name"
              value={policyForm.name}
              onChange={(e) => setPolicyForm({ ...policyForm, name: e.target.value })}
              required
            />
            <Select value={policyForm.type} onValueChange={(v) => setPolicyForm({ ...policyForm, type: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MARKUP_ON_COST">Markup on cost</SelectItem>
                <SelectItem value="GROSS_MARGIN_ON_SALES">Gross margin on sales</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="Rate fraction (e.g. 0.14)"
              value={policyForm.rate}
              onChange={(e) => setPolicyForm({ ...policyForm, rate: e.target.value })}
            />
            <Input
              placeholder="Min profit (optional)"
              value={policyForm.minProfit}
              onChange={(e) => setPolicyForm({ ...policyForm, minProfit: e.target.value })}
            />
            <Input
              placeholder="Fee fraction (optional)"
              value={policyForm.feeFraction}
              onChange={(e) => setPolicyForm({ ...policyForm, feeFraction: e.target.value })}
            />
            <Input
              placeholder="Rounding increment"
              value={policyForm.roundingIncrement}
              onChange={(e) => setPolicyForm({ ...policyForm, roundingIncrement: e.target.value })}
            />
            <Input
              placeholder="Quote currency"
              maxLength={3}
              value={policyForm.quoteCurrency}
              onChange={(e) => setPolicyForm({ ...policyForm, quoteCurrency: e.target.value.toUpperCase() })}
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={policyForm.allowBelowFloorException}
                onChange={(e) => setPolicyForm({ ...policyForm, allowBelowFloorException: e.target.checked })}
              />
              Allow below-floor exception
            </label>
            <Button type="submit">Create policy</Button>
          </form>
          <div className="max-h-[400px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left">
                <tr>
                  <th className="pb-2 font-medium">Name</th>
                  <th className="pb-2 font-medium">Type</th>
                  <th className="pb-2 font-medium">Rate</th>
                  <th className="pb-2 font-medium">Min profit</th>
                  <th className="pb-2 font-medium">Fee</th>
                  <th className="pb-2 font-medium">Quote ccy</th>
                  <th className="pb-2 font-medium">Active</th>
                  <th className="pb-2 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {policies.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2">{p.name}</td>
                    <td className="py-2 text-xs">{p.type.replace(/_/g, " ")}</td>
                    <td className="py-2">{p.rate ?? "—"}</td>
                    <td className="py-2">{p.minProfit ? money(p.minProfit, p.minProfitCurrency) : "—"}</td>
                    <td className="py-2">{p.feeFraction ?? "—"}</td>
                    <td className="py-2">{p.quoteCurrency}</td>
                    <td className="py-2">{p.active ? <StateBadge value="READY" /> : "—"}</td>
                    <td className="py-2">
                      {!p.active && (
                        <Button size="sm" variant="outline" onClick={() => activatePolicy(p.id)}>
                          Activate
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ImportsTab() {
  const { toast } = useToast();
  const [batches, setBatches] = useState<ImportBatchView[]>([]);
  const [openBatch, setOpenBatch] = useState<string | null>(null);
  const [rows, setRows] = useState<ImportRowView[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    axios
      .get("/api/travel/imports")
      .then((res) => setBatches(res.data))
      .catch((err) => toast(apiError(err, "Failed to load imports"), "error"));
  }, [toast]);

  async function openRows(batchId: string) {
    if (openBatch === batchId) {
      setOpenBatch(null);
      return;
    }
    try {
      const res = await axios.get(`/api/travel/imports/${batchId}`);
      setRows(res.data.rows);
      setSelected(new Set());
      setOpenBatch(batchId);
    } catch (err) {
      toast(apiError(err, "Failed to load batch rows"), "error");
    }
  }

  async function verifySelected(batchId: string) {
    try {
      const res = await axios.post(`/api/travel/imports/${batchId}/verify`, { rowIds: Array.from(selected) });
      toast(`Verified ${res.data.verified} row(s)`, "success");
      const refreshed = await axios.get(`/api/travel/imports/${batchId}`);
      setRows(refreshed.data.rows);
      setSelected(new Set());
      const list = await axios.get("/api/travel/imports");
      setBatches(list.data);
    } catch (err) {
      toast(apiError(err, "Verify failed"), "error");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import batches</CardTitle>
        <CardDescription>Staged workbook imports. Select staged rows to verify them.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-left">
              <tr>
                <th className="pb-2 font-medium">File</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium">Rows</th>
                <th className="pb-2 font-medium">Created</th>
                <th className="pb-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {batches.map((b) => (
                <tr key={b.id}>
                  <td className="py-2">{b.fileName}</td>
                  <td className="py-2">
                    <StateBadge value={b.status} />
                  </td>
                  <td className="py-2 text-xs">
                    {b.rowCount} total —{" "}
                    {Object.entries(b.counts)
                      .map(([s, n]) => `${s}: ${n}`)
                      .join(", ")}
                  </td>
                  <td className="py-2 whitespace-nowrap">{formatDateTime(b.createdAt)}</td>
                  <td className="py-2">
                    <Button size="sm" variant="outline" onClick={() => openRows(b.id)}>
                      {openBatch === b.id ? "Hide rows" : "Rows"}
                    </Button>
                  </td>
                </tr>
              ))}
              {batches.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-muted-foreground">
                    No import batches.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {openBatch && (
          <div className="rounded-md border p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium">Batch rows</p>
              <Button size="sm" disabled={selected.size === 0} onClick={() => verifySelected(openBatch)}>
                Verify selected ({selected.size})
              </Button>
            </div>
            <div className="max-h-[400px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-left">
                  <tr>
                    <th className="pb-2 font-medium"></th>
                    <th className="pb-2 font-medium">Entity</th>
                    <th className="pb-2 font-medium">Source ref</th>
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2 font-medium">Issue</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2">
                        {r.status === "STAGED" && (
                          <input
                            type="checkbox"
                            checked={selected.has(r.id)}
                            onChange={(e) => {
                              const next = new Set(selected);
                              if (e.target.checked) next.add(r.id);
                              else next.delete(r.id);
                              setSelected(next);
                            }}
                          />
                        )}
                      </td>
                      <td className="py-2">{r.entityType}</td>
                      <td className="py-2 font-mono text-xs">{r.sourceRef}</td>
                      <td className="py-2">
                        <StateBadge value={r.status} />
                      </td>
                      <td className="py-2 text-xs">{r.issueText ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AgenciesTab() {
  const { toast } = useToast();
  const [agencies, setAgencies] = useState<Agency[]>([]);
  const [form, setForm] = useState({ shortCode: "", name: "", contactName: "", contactEmail: "", contactPhone: "" });

  const load = useCallback(() => {
    axios
      .get("/api/travel/agencies")
      .then((res) => setAgencies(res.data))
      .catch((err) => toast(apiError(err, "Failed to load agencies"), "error"));
  }, [toast]);

  useEffect(load, [load]);

  async function addAgency(e: React.FormEvent) {
    e.preventDefault();
    try {
      await axios.post("/api/travel/agencies", {
        shortCode: form.shortCode.toUpperCase(),
        name: form.name,
        contactName: form.contactName || null,
        contactEmail: form.contactEmail || null,
        contactPhone: form.contactPhone || null,
      });
      toast("Agency created", "success");
      setForm({ shortCode: "", name: "", contactName: "", contactEmail: "", contactPhone: "" });
      load();
    } catch (err) {
      toast(apiError(err, "Failed to create agency"), "error");
    }
  }

  async function toggleActive(a: Agency) {
    try {
      await axios.patch(`/api/travel/agencies/${a.id}`, { active: !a.active });
      toast(a.active ? "Agency deactivated" : "Agency activated", "success");
      load();
    } catch (err) {
      toast(apiError(err, "Failed to update agency"), "error");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agencies</CardTitle>
        <CardDescription>Short codes feed the package code prefix.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={addAgency} className="grid gap-2 sm:grid-cols-6">
          <Input
            placeholder="SHORTCODE"
            value={form.shortCode}
            onChange={(e) => setForm({ ...form, shortCode: e.target.value.toUpperCase() })}
            required
          />
          <Input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <Input placeholder="Contact name" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
          <Input
            placeholder="Contact email"
            type="email"
            value={form.contactEmail}
            onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
          />
          <Input placeholder="Contact phone" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} />
          <Button type="submit">Create agency</Button>
        </form>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-left">
              <tr>
                <th className="pb-2 font-medium">Code</th>
                <th className="pb-2 font-medium">Name</th>
                <th className="pb-2 font-medium">Contact</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {agencies.map((a) => (
                <tr key={a.id}>
                  <td className="py-2 font-mono">{a.shortCode}</td>
                  <td className="py-2">{a.name}</td>
                  <td className="py-2 text-xs">
                    {[a.contactName, a.contactEmail, a.contactPhone].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td className="py-2">{a.active ? "Active" : "Inactive"}</td>
                  <td className="py-2">
                    <Button size="sm" variant="outline" onClick={() => toggleActive(a)}>
                      {a.active ? "Deactivate" : "Activate"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
