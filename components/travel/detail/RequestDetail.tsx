"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { versionLabel } from "@/lib/travel/contracts";
import { nightsBetween } from "@/lib/travel/engine/dates";
import TravelShell from "../TravelShell";
import { StatusBadge, apiError, money, parseJson } from "../utils";
import type { TravelRequestDetail, VersionDetail } from "../types";
import type { ScenarioResult } from "@/lib/travel/contracts";
import OverviewTab from "./OverviewTab";
import ItineraryTab from "./ItineraryTab";
import ScenariosTab from "./ScenariosTab";
import ReviewTab from "./ReviewTab";
import HistoryTab from "./HistoryTab";
import QuoteSummaryBar from "./QuoteSummaryBar";
import { useQuotePreview } from "./useQuotePreview";

interface RequestDetailProps {
  requestId: string;
  role: string;
  userId: string;
}

export interface DetailContext {
  detail: TravelRequestDetail;
  version: VersionDetail;
  isLatestVersion: boolean;
  role: string;
  userId: string;
  isOwner: boolean;
  isAdmin: boolean;
  /** Settings-level quote currency — fallback only. */
  quoteCurrency: string;
  /** Currency for the selected version's results: version-bound, else settings. */
  resultCurrency: string;
  /** owner/ADMIN and the selected version accepts content edits. */
  canEditVersion: boolean;
  /** owner/ADMIN and the request itself accepts field edits. */
  canEditRequest: boolean;
  /** Scenario id → result: live preview for editable versions, persisted snapshot otherwise. */
  quoteResults: Map<string, ScenarioResult> | null;
  quoteLoading: boolean;
  quoteError: string | null;
  recalculateQuote: () => void;
  refresh: () => void;
}

export default function RequestDetail({ requestId, role, userId }: RequestDetailProps) {
  const { toast } = useToast();
  const [detail, setDetail] = useState<TravelRequestDetail | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [quoteCurrency, setQuoteCurrency] = useState("USD");
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareA, setCompareA] = useState("");
  const [compareB, setCompareB] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await axios.get(`/api/travel/requests/${requestId}`);
      const data: TravelRequestDetail = res.data;
      setDetail(data);
      setSelectedVersionId((prev) =>
        prev && data.versions.some((v) => v.id === prev)
          ? prev
          : data.versions[data.versions.length - 1]?.id ?? null,
      );
    } catch (err) {
      toast(apiError(err, "Failed to load request"), "error");
    }
  }, [requestId, toast]);

  useEffect(() => {
    load();
    axios
      .get("/api/travel/settings")
      .then((res) => {
        if (res.data?.activePolicy?.quoteCurrency) setQuoteCurrency(res.data.activePolicy.quoteCurrency);
      })
      .catch(() => null);
  }, [load]);

  const version = useMemo(
    () => detail?.versions.find((v) => v.id === selectedVersionId) ?? detail?.versions[detail.versions.length - 1],
    [detail, selectedVersionId],
  );

  // Computed before the early return so the preview hook can run
  // unconditionally (hooks cannot sit behind the loading guard).
  const editableVersion =
    !!detail &&
    !!version &&
    (detail.ownerId === userId || role === "ADMIN") &&
    ["DRAFT", "CHANGES_REQUESTED"].includes(version.status);
  const preview = useQuotePreview(
    version?.id ?? "",
    detail?.revision ?? 0,
    editableVersion && (version?.scenarios.length ?? 0) > 0,
  );
  // Non-editable versions (and the first moments of an editable one) read the
  // snapshot persisted at submit — the approved price must not move.
  const persistedResults = useMemo(() => {
    if (!version) return null;
    const map = new Map<string, ScenarioResult>();
    for (const sc of version.scenarios) {
      const r = parseJson<ScenarioResult | null>(sc.resultJson, null);
      if (r) map.set(sc.id, r);
    }
    return map;
  }, [version]);
  const quoteResults =
    editableVersion && preview.results.size > 0 ? preview.results : persistedResults;

  if (!detail || !version) {
    return (
      <TravelShell title="Travel request" role={role} current="requests">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </TravelShell>
    );
  }

  const isOwner = detail.ownerId === userId;
  const isAdmin = role === "ADMIN";
  const latest = detail.versions[detail.versions.length - 1];
  const isLatestVersion = version.id === latest.id;
  const canEditVersion = editableVersion;
  const canEditRequest =
    (isOwner || isAdmin) && ["DRAFT", "CHANGES_REQUESTED"].includes(detail.status) && isLatestVersion;
  const canRevise =
    (isOwner || isAdmin) &&
    ["CHANGES_REQUESTED", "APPROVED", "ISSUED", "REJECTED"].includes(latest.status);

  const ctx: DetailContext = {
    detail,
    version,
    isLatestVersion,
    role,
    userId,
    isOwner,
    isAdmin,
    quoteCurrency,
    resultCurrency: version.quoteCurrency ?? quoteCurrency,
    canEditVersion,
    canEditRequest,
    quoteResults,
    quoteLoading: editableVersion ? preview.loading : false,
    quoteError: editableVersion ? preview.error : null,
    recalculateQuote: preview.recalculate,
    refresh: load,
  };

  async function handleNewRevision() {
    if (!detail) return;
    if (!confirm("Create a new draft revision cloned from the latest version?")) return;
    setBusy(true);
    try {
      const res = await axios.post(`/api/travel/requests/${detail.id}/versions`);
      toast(`Created ${versionLabel(res.data.versionNo)}`, "success");
      setSelectedVersionId(res.data.id);
      await load();
    } catch (err) {
      toast(apiError(err, "Failed to create revision"), "error");
    } finally {
      setBusy(false);
    }
  }

  const nights = nightsBetween(detail.startDate, detail.endDate);
  const cmpA = detail.versions.find((v) => v.id === compareA);
  const cmpB = detail.versions.find((v) => v.id === compareB);

  return (
    <TravelShell title={detail.packageCode} subtitle={detail.title} role={role} current="requests">
      <Card className="mb-4">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <CardTitle className="font-mono text-xl">{detail.packageCode}</CardTitle>
                <StatusBadge status={detail.status} />
              </div>
              <p className="text-sm text-muted-foreground">
                {detail.agency.shortCode} — {detail.agency.name} · {detail.startDate} → {detail.endDate} (
                {nights} night{nights === 1 ? "" : "s"} / {nights + 1} days) · Owner:{" "}
                {detail.owner.name || detail.owner.email} · Validator:{" "}
                {detail.validator ? detail.validator.name || detail.validator.email : "not assigned"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {detail.versions.map((v) => (
                <Button
                  key={v.id}
                  size="sm"
                  variant={v.id === version.id ? "default" : "outline"}
                  onClick={() => setSelectedVersionId(v.id)}
                >
                  {versionLabel(v.versionNo)}
                </Button>
              ))}
              {canRevise && (
                <Button size="sm" variant="outline" onClick={handleNewRevision} disabled={busy}>
                  New revision
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => setCompareOpen((o) => !o)}>
                Compare
              </Button>
            </div>
          </div>
        </CardHeader>
        {compareOpen && (
          <CardContent>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={compareA} onValueChange={setCompareA}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="Version A" />
                </SelectTrigger>
                <SelectContent>
                  {detail.versions.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {versionLabel(v.versionNo)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={compareB} onValueChange={setCompareB}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="Version B" />
                </SelectTrigger>
                <SelectContent>
                  {detail.versions.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {versionLabel(v.versionNo)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {cmpA && cmpB && <VersionCompare a={cmpA} b={cmpB} fallbackCurrency={quoteCurrency} />}
          </CardContent>
        )}
      </Card>

      <QuoteSummaryBar ctx={ctx} />

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="itinerary">Itinerary</TabsTrigger>
          <TabsTrigger value="scenarios">Scenarios</TabsTrigger>
          <TabsTrigger value="review">Review</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <OverviewTab ctx={ctx} />
        </TabsContent>
        <TabsContent value="itinerary">
          <ItineraryTab ctx={ctx} />
        </TabsContent>
        <TabsContent value="scenarios">
          <ScenariosTab ctx={ctx} />
        </TabsContent>
        <TabsContent value="review">
          <ReviewTab ctx={ctx} />
        </TabsContent>
        <TabsContent value="history">
          <HistoryTab ctx={ctx} />
        </TabsContent>
      </Tabs>
    </TravelShell>
  );
}

function scenarioResult(v: VersionDetail, scenarioId: string): ScenarioResult | null {
  const sc = v.scenarios.find((s) => s.id === scenarioId);
  return parseJson<ScenarioResult | null>(sc?.resultJson, null);
}

function VersionCompare({ a, b, fallbackCurrency }: { a: VersionDetail; b: VersionDetail; fallbackCurrency: string }) {
  const labels = Array.from(new Set([...a.scenarios.map((s) => s.label), ...b.scenarios.map((s) => s.label)]));
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b text-left">
          <tr>
            <th className="pb-2 font-medium">Scenario</th>
            <th className="pb-2 font-medium">
              {versionLabel(a.versionNo)} ({a.status})
            </th>
            <th className="pb-2 font-medium">
              {versionLabel(b.versionNo)} ({b.status})
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {labels.map((label) => {
            const scA = a.scenarios.find((s) => s.label === label);
            const scB = b.scenarios.find((s) => s.label === label);
            const resA = scA ? scenarioResult(a, scA.id) : null;
            const resB = scB ? scenarioResult(b, scB.id) : null;
            const cell = (sc: typeof scA, res: ScenarioResult | null, currency: string) => {
              if (!sc) return "—";
              if (!res) return sc.valid ? "valid (no result)" : "not calculated";
              return `${res.valid ? "valid" : "invalid"} · ${res.issues.length} issue(s) · sell ${money(res.sell, currency)}`;
            };
            return (
              <tr key={label}>
                <td className="py-2">{label}</td>
                <td className="py-2">{cell(scA, resA, a.quoteCurrency ?? fallbackCurrency)}</td>
                <td className="py-2">{cell(scB, resB, b.quoteCurrency ?? fallbackCurrency)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
