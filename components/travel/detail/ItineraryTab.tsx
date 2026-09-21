"use client";

import { useEffect, useState } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { addDays } from "@/lib/travel/engine/dates";
import { apiError, parseJson } from "../utils";
import type { DetailContext } from "./RequestDetail";

interface DayDraft {
  dayOffset: number;
  date: string;
  narrative: string;
  overnightCity: string;
  services: string; // comma separated
}

export default function ItineraryTab({ ctx }: { ctx: DetailContext }) {
  const { toast } = useToast();
  const { version } = ctx;
  const [days, setDays] = useState<DayDraft[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDays(
      version.itineraryDays.map((d) => ({
        dayOffset: d.dayOffset,
        date: d.date,
        narrative: d.narrative ?? "",
        overnightCity: d.overnightCity ?? "",
        services: parseJson<string[]>(d.services, []).join(", "),
      })),
    );
    setDirty(false);
  }, [version.id, version.itineraryDays]);

  function update(idx: number, patch: Partial<DayDraft>) {
    setDays((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
    setDirty(true);
  }

  function addDay() {
    const last = days[days.length - 1];
    const nextOffset = last ? last.dayOffset + 1 : 0;
    // Dates are derived from the request start date so offset and date never diverge.
    setDays([
      ...days,
      { dayOffset: nextOffset, date: addDays(ctx.detail.startDate, nextOffset), narrative: "", overnightCity: "", services: "" },
    ]);
    setDirty(true);
  }

  function removeDay(idx: number) {
    setDays(
      days
        .filter((_, i) => i !== idx)
        .map((d, i) => ({ ...d, dayOffset: i, date: addDays(ctx.detail.startDate, i) })),
    );
    setDirty(true);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await axios.put(`/api/travel/versions/${version.id}/content`, {
        expectedRevision: ctx.detail.revision,
        itineraryDays: days.map((d) => ({
          dayOffset: d.dayOffset,
          date: d.date,
          narrative: d.narrative || null,
          overnightCity: d.overnightCity || null,
          services: d.services
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        })),
      });
      toast("Itinerary saved", "success");
      setDirty(false);
      ctx.refresh();
    } catch (err: any) {
      if (err?.response?.status === 409) {
        toast("This request was edited elsewhere — refreshed the latest data. Review and save again.", "error");
        ctx.refresh();
      } else {
        toast(apiError(err, "Failed to save itinerary"), "error");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Itinerary</CardTitle>
            <CardDescription>
              Day-by-day plan for this version.{ctx.canEditVersion ? "" : " Read-only for this version status."}
            </CardDescription>
          </div>
          {ctx.canEditVersion && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={addDay}>
                Add day
              </Button>
              <Button size="sm" onClick={handleSave} disabled={!dirty || saving}>
                {saving ? "Saving..." : "Save itinerary"}
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {days.length === 0 && <p className="text-sm text-muted-foreground">No itinerary days yet.</p>}
        <div className="space-y-3">
          {days.map((d, i) =>
            ctx.canEditVersion ? (
              <div key={i} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[80px_130px_1fr_160px_1fr_40px]">
                <div className="flex items-center text-sm font-medium">Day {d.dayOffset + 1}</div>
                <Input type="date" value={d.date} onChange={(e) => update(i, { date: e.target.value })} />
                <Textarea
                  rows={2}
                  placeholder="Narrative"
                  value={d.narrative}
                  onChange={(e) => update(i, { narrative: e.target.value })}
                />
                <Input
                  placeholder="Overnight city"
                  value={d.overnightCity}
                  onChange={(e) => update(i, { overnightCity: e.target.value })}
                />
                <Input
                  placeholder="Services (comma separated)"
                  value={d.services}
                  onChange={(e) => update(i, { services: e.target.value })}
                />
                <Button variant="ghost" size="sm" onClick={() => removeDay(i)}>
                  ✕
                </Button>
              </div>
            ) : (
              <div key={i} className="rounded-md border p-3 text-sm">
                <div className="mb-1 flex items-center gap-3 font-medium">
                  <span>Day {d.dayOffset + 1}</span>
                  <span className="text-muted-foreground">{d.date}</span>
                  {d.overnightCity && <span className="text-muted-foreground">· {d.overnightCity}</span>}
                </div>
                {d.narrative && <p className="whitespace-pre-wrap">{d.narrative}</p>}
                {d.services && <p className="mt-1 text-xs text-muted-foreground">Services: {d.services}</p>}
              </div>
            ),
          )}
        </div>
      </CardContent>
    </Card>
  );
}
