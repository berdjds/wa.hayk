import { createHash } from "node:crypto";
import { ENGINE_VERSION } from "@/lib/travel/contracts";

// The engine version is part of every snapshot hash input so a rule change
// invalidates prior quotation snapshots. Re-exported for snapshot callers.
export { ENGINE_VERSION };

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  // Money stays a decimal string here — numbers are never re-serialized, so
  // "1864.00" cannot degrade to 1864 between snapshot and recalculation.
  return value;
}

/** Deterministic JSON: object keys sorted recursively, array order kept. */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

/** sha256 hex of the canonical string — the snapshot identity for a version. */
export function snapshotHash(inputs: unknown): string {
  return createHash("sha256").update(canonicalize(inputs), "utf8").digest("hex");
}
