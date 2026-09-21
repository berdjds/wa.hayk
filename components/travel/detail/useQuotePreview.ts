"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import type { ScenarioResult } from "@/lib/travel/contracts";
import { apiError } from "../utils";

export interface QuotePreview {
  /** Scenario id → sell-side result (advisor-redacted when the viewer is an advisor). */
  results: Map<string, ScenarioResult>;
  currency: string | null;
  loading: boolean;
  error: string | null;
  recalculate: () => void;
}

/**
 * Live price preview for an editable version: POSTs the existing calculate
 * endpoint (no snapshot is persisted — only submit() binds one) and re-runs
 * whenever `revision` changes, because the server bumps the request revision
 * on every content save, making revision the "content changed" signal.
 *
 * Race guard: a monotonically increasing run id — only the latest run may
 * write state, so a slow earlier response cannot overwrite a newer one. On
 * error the previous results are kept (stale prices beat no prices).
 */
export function useQuotePreview(versionId: string, revision: number, enabled: boolean): QuotePreview {
  const [results, setResults] = useState<Map<string, ScenarioResult>>(new Map());
  const [currency, setCurrency] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runCounter = useRef(0);
  const loadedFor = useRef<string | null>(null);

  const run = useCallback(async () => {
    const runId = ++runCounter.current;
    if (loadedFor.current !== versionId) {
      // Different version: old scenario ids cannot match, drop them at once.
      loadedFor.current = versionId;
      setResults(new Map());
      setCurrency(null);
    }
    setLoading(true);
    setError(null);
    try {
      const res = await axios.post(`/api/travel/versions/${versionId}/calculate`, {});
      if (runId !== runCounter.current) return; // superseded by a newer run
      const data = res.data as { scenarios?: ScenarioResult[]; quoteCurrency?: string };
      setResults(new Map((data.scenarios ?? []).map((sc) => [sc.ref, sc])));
      setCurrency(data.quoteCurrency ?? null);
    } catch (err) {
      if (runId !== runCounter.current) return;
      setError(apiError(err, "Price calculation failed"));
    } finally {
      if (runId === runCounter.current) setLoading(false);
    }
  }, [versionId]);

  useEffect(() => {
    if (!enabled) {
      // Invalidate in-flight runs and clear state for non-editable versions —
      // those read the persisted snapshot results instead of this hook.
      runCounter.current++;
      loadedFor.current = null;
      setResults(new Map());
      setCurrency(null);
      setError(null);
      setLoading(false);
      return;
    }
    void run();
  }, [enabled, revision, run]);

  return { results, currency, loading, error, recalculate: run };
}
