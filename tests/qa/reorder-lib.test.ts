/**
 * Unit tests for the catalog reorder core (lib/travel/reorder.ts).
 *
 * Regression target: legacy imported rows all share sortOrder 0, and the old
 * slot-reuse scheme spread a partial (single-category) submission as 0,1,2… —
 * colliding with other categories and destroying their saved order. The new
 * helper must splice the submitted ids into their existing positions in the
 * canonical sequence and leave every other row's relative order intact.
 */

import { describe, expect, it } from "vitest";
import { applyCatalogReorder, computeReorderedIds, type ReorderDelegate, type ReorderRow } from "@/lib/travel/reorder";

function row(id: string, sortOrder: number, name = id): ReorderRow {
  return { id, name, sortOrder };
}

describe("computeReorderedIds", () => {
  it("rewrites the full sequence when every row is submitted", () => {
    const rows = [row("a", 0), row("b", 1), row("c", 2)];
    expect(computeReorderedIds(rows, ["c", "a", "b"])).toEqual(["c", "a", "b"]);
  });

  it("splices a subset into its own positions, keeping unsubmitted rows in place", () => {
    const rows = [row("before", 0), row("g1", 1), row("g2", 2), row("after", 3)];
    expect(computeReorderedIds(rows, ["g2", "g1"])).toEqual(["before", "g2", "g1", "after"]);
  });

  it("ignores unknown ids and is a no-op when nothing matches", () => {
    const rows = [row("a", 0), row("b", 1)];
    expect(computeReorderedIds(rows, ["missing", "b", "a"])).toEqual(["b", "a"]);
    expect(computeReorderedIds(rows, ["missing"])).toEqual(["a", "b"]);
  });
});

/** In-memory delegate mimicking Prisma: canonical ordering + positional updates. */
function fakeDelegate(initial: ReorderRow[]) {
  const state = new Map(initial.map((r) => [r.id, { ...r }]));
  const delegate: ReorderDelegate = {
    async findMany() {
      return Array.from(state.values()).sort(
        (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
      );
    },
    async update({ where, data }) {
      const r = state.get(where.id);
      if (r) r.sortOrder = data.sortOrder;
      return r;
    },
  };
  const order = () =>
    Array.from(state.values())
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map((r) => r.id);
  return { delegate, order };
}

describe("applyCatalogReorder", () => {
  it("keeps every other row's relative order on a partial-category reorder", async () => {
    // Two categories interleaved in one global sequence with distinct slots.
    const { delegate, order } = fakeDelegate([
      row("transport-1", 0, "A bus"),
      row("ticket-1", 1, "B museum"),
      row("transport-2", 2, "C van"),
      row("ticket-2", 3, "D park"),
      row("transport-3", 4, "E sedan"),
    ]);

    const updated = await applyCatalogReorder(delegate, ["ticket-2", "ticket-1"]);
    expect(updated).toBe(2);
    // Tickets swap within their own (interleaved) slots; transportation rows untouched.
    expect(order()).toEqual(["transport-1", "ticket-2", "transport-2", "ticket-1", "transport-3"]);
  });

  it("normalizes the legacy all-zeros case without disturbing other categories", async () => {
    // Legacy import: every sortOrder is 0, so the canonical order is by name.
    const { delegate, order } = fakeDelegate([
      row("transport-1", 0, "Bus"),
      row("ticket-1", 0, "Museum"),
      row("ticket-2", 0, "Park"),
      row("transport-2", 0, "Van"),
    ]);

    // Canonical order: Bus, Museum, Park, Van. Reverse the tickets only.
    const updated = await applyCatalogReorder(delegate, ["ticket-2", "ticket-1"]);
    expect(updated).toBe(2);
    // Tickets swap their slots; both transportation rows keep their places,
    // and the whole column is rewritten to a clean 0..n-1.
    expect(order()).toEqual(["transport-1", "ticket-2", "ticket-1", "transport-2"]);
  });

  it("returns 0 and writes nothing when all submitted ids are unknown", async () => {
    const writes: string[] = [];
    const { delegate } = fakeDelegate([row("a", 0), row("b", 1)]);
    const counting: ReorderDelegate = {
      findMany: delegate.findMany,
      async update(args) {
        writes.push(args.where.id);
        return delegate.update(args);
      },
    };
    expect(await applyCatalogReorder(counting, ["nope"])).toBe(0);
    expect(writes).toEqual([]);
  });
});
