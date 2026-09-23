/**
 * Shared catalog reorder core for hotels and services.
 *
 * The admin DnD UI submits the visible list — for services often only ONE
 * category. The sortOrder column is global across all categories, and legacy
 * imported rows all share sortOrder 0, so the previous scheme (reuse the
 * submitted rows' existing slots, spread 0,1,2… on ties) collided with other
 * categories' values: sorting TICKETS could rewrite TRANSPORTATION's order.
 * The fix: splice the submitted ids into the positions they already occupy in
 * the canonical full sequence, then rewrite the whole column to a clean
 * 0..n-1 in one transaction — normalizing legacy zeros in the same pass.
 */

export interface ReorderRow {
  id: string;
  name: string;
  sortOrder: number;
}

/** The minimal Prisma model-delegate surface the helper needs (tx-scoped or not). */
export interface ReorderDelegate {
  findMany(args: {
    select: { id: true; name: true; sortOrder: true };
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }];
  }): Promise<ReorderRow[]>;
  update(args: { where: { id: string }; data: { sortOrder: number } }): Promise<unknown>;
}

/**
 * Pure splice. `rows` must be in the canonical display order
 * ([{ sortOrder: "asc" }, { name: "asc" }]). The submitted ids — in their new
 * relative order — are dropped back into the slots they currently occupy, so
 * every unsubmitted row keeps its relative position. Unknown ids are ignored.
 * Returns the full id sequence in its new order.
 */
export function computeReorderedIds(rows: ReorderRow[], ids: string[]): string[] {
  const known = new Set(rows.map((r) => r.id));
  const queue = ids.filter((id) => known.has(id));
  if (queue.length === 0) return rows.map((r) => r.id);
  const submitted = new Set(queue);
  let cursor = 0;
  return rows.map((r) => (submitted.has(r.id) ? queue[cursor++] : r.id));
}

/**
 * Applies a reorder submitted by the catalog UI. Pass a transaction-scoped
 * delegate (tx.hotelProduct / tx.serviceProduct) so the fetch + rewrite are
 * atomic. Returns the number of submitted ids that matched a row; a
 * submission of only unknown ids is a no-op.
 */
export async function applyCatalogReorder(delegate: ReorderDelegate, ids: string[]): Promise<number> {
  const rows = await delegate.findMany({
    select: { id: true, name: true, sortOrder: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  const ordered = computeReorderedIds(rows, ids);
  const knownCount = ids.filter((id) => rows.some((r) => r.id === id)).length;
  if (knownCount === 0) return 0;
  // EVERY row is rewritten to 0..n-1, not just the submitted ones — partial
  // reorders must also flush legacy all-zero sortOrders out of the column.
  for (let i = 0; i < ordered.length; i++) {
    await delegate.update({ where: { id: ordered[i] }, data: { sortOrder: i } });
  }
  return knownCount;
}
