/**
 * One-off backfill (v0.14.0): split ServiceProduct names that embed their long
 * description into `name` (short title) + `details` (client-facing text).
 *
 * A product is updated only when its name contains ": " and `details` is still
 * empty — the split happens on the FIRST ": " so
 *   "Arrival & Yerevan city tour: Zvartnots Airport · Victory Park · …"
 * becomes
 *   name:    "Arrival & Yerevan city tour"
 *   details: "Zvartnots Airport · Victory Park · …"
 *
 * Idempotent: after a successful run no product matches the criteria anymore.
 * It does NOT touch ServiceLine labels, ItineraryDay.services JSON or frozen
 * snapshots — drafts keep the labels they were saved with until re-picked.
 *
 * CLI:
 *   npx tsx scripts/split-service-details.ts [--dry-run]
 */

import { prisma } from "@/lib/prisma";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const candidates = await prisma.serviceProduct.findMany({
    where: { details: null, name: { contains: ": " } },
    orderBy: { name: "asc" },
  });

  let updated = 0;
  let skipped = 0;
  for (const p of candidates) {
    const idx = p.name.indexOf(": ");
    const name = p.name.slice(0, idx).trim();
    const details = p.name.slice(idx + 2).trim();
    if (!name || !details) {
      console.warn(`SKIP ${p.id} "${p.name}" — split would produce an empty side`);
      skipped += 1;
      continue;
    }
    console.log(`${dryRun ? "DRY  " : "SPLIT"} ${p.id}\n  name:    ${name}\n  details: ${details}`);
    if (!dryRun) {
      await prisma.serviceProduct.update({ where: { id: p.id }, data: { name, details } });
    }
    updated += 1;
  }

  console.log(
    `${dryRun ? "[dry-run] would update" : "Updated"} ${updated} service product(s); skipped ${skipped}.`,
  );
}

main()
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
