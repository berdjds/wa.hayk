"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import TravelShell from "./TravelShell";
import { apiError, formatDateTime } from "./utils";
import type { PolicyView, TravelSettingsView } from "./types";

interface SettingsPanelProps {
  role: string;
  userId: string;
}

export default function SettingsPanel({ role, userId }: SettingsPanelProps) {
  const { toast } = useToast();
  const [settings, setSettings] = useState<TravelSettingsView | null>(null);
  const [activePolicy, setActivePolicy] = useState<PolicyView | null>(null);
  const [form, setForm] = useState({ companyTz: "", overdueReminderHours: "", requireSettingsForIssue: true });
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    axios
      .get("/api/travel/settings")
      .then((res) => {
        setSettings(res.data.settings);
        setActivePolicy(res.data.activePolicy ?? null);
        setForm({
          companyTz: res.data.settings.companyTz,
          overdueReminderHours:
            res.data.settings.overdueReminderHours == null ? "" : String(res.data.settings.overdueReminderHours),
          requireSettingsForIssue: res.data.settings.requireSettingsForIssue,
        });
      })
      .catch((err) => toast(apiError(err, "Failed to load settings"), "error"));
  }, [toast]);

  useEffect(load, [load]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await axios.put("/api/travel/settings", {
        companyTz: form.companyTz,
        overdueReminderHours: form.overdueReminderHours === "" ? null : Number.parseInt(form.overdueReminderHours, 10),
        requireSettingsForIssue: form.requireSettingsForIssue,
      });
      toast("Settings saved", "success");
      load();
    } catch (err) {
      toast(apiError(err, "Failed to save settings"), "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <TravelShell title="Travel settings" subtitle="Module configuration (singleton)." role={role} current="settings">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>General</CardTitle>
            <CardDescription>
              {settings ? `Last updated ${formatDateTime(settings.updatedAt)}` : "Loading…"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {settings && (
              <form onSubmit={handleSave} className="space-y-4">
                <div>
                  <Label>Company timezone</Label>
                  <Input value={form.companyTz} onChange={(e) => setForm({ ...form, companyTz: e.target.value })} required />
                  <p className="mt-1 text-xs text-muted-foreground">IANA name, e.g. Asia/Yerevan. Package code dates use it.</p>
                </div>
                <div>
                  <Label>Overdue reminder (hours)</Label>
                  <Input
                    type="number"
                    min={1}
                    placeholder="disabled"
                    value={form.overdueReminderHours}
                    onChange={(e) => setForm({ ...form, overdueReminderHours: e.target.value })}
                  />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.requireSettingsForIssue}
                    onChange={(e) => setForm({ ...form, requireSettingsForIssue: e.target.checked })}
                  />
                  Require active policy + FX before issuing
                </label>
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving..." : "Save settings"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Current configuration</CardTitle>
            <CardDescription>Read-only details.</CardDescription>
          </CardHeader>
          <CardContent>
            {settings && (
              <dl className="space-y-3 text-sm">
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Documents directory</dt>
                  <dd className="font-mono text-xs">{settings.documentsDir}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Escalation user id</dt>
                  <dd className="font-mono text-xs">{settings.escalationUserId ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Active pricing policy</dt>
                  <dd>
                    {activePolicy ? (
                      <>
                        {activePolicy.name} — {activePolicy.type.replace(/_/g, " ")}, rate {activePolicy.rate ?? "—"},
                        quote currency {activePolicy.quoteCurrency}
                      </>
                    ) : (
                      "None active — issuing is blocked while the setting above is on."
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">FX &amp; policies</dt>
                  <dd>
                    <Button variant="outline" size="sm" onClick={() => (window.location.href = "/travel/catalog")}>
                      Open catalog → FX &amp; Policy tab
                    </Button>
                  </dd>
                </div>
              </dl>
            )}
          </CardContent>
        </Card>
      </div>
    </TravelShell>
  );
}
