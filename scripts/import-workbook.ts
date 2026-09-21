/**
 * CLI: stage the workbook evidence JSON into ImportBatch/ImportRow.
 *
 *   npx tsx scripts/import-workbook.ts [path-to-evidence.json]
 *
 * Defaults to doc/travel/Workbook-Evidence.json. The idempotency key is a
 * sha256 prefix of the file, so re-running on the same file is a no-op.
 * Exits non-zero on hard failure.
 */

import { createHash } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";
import { stageWorkbookEvidence } from "@/lib/travel/import";

async function main() {
  const filePath = path.resolve(
    process.argv[2] ?? path.join(__dirname, "..", "doc", "travel", "Workbook-Evidence.json"),
  );

  const content = readFileSync(filePath); // throws if missing — hard failure
  const sha256 = createHash("sha256").update(content).digest("hex");
  const idempotencyKey = `workbook-evidence-${sha256.slice(0, 16)}`;

  console.log(`[import-workbook] file: ${filePath}`);
  console.log(`[import-workbook] sha256: ${sha256}`);

  const result = await stageWorkbookEvidence(filePath, { idempotencyKey });

  if (result.skipped) {
    console.log(
      `[import-workbook] batch already staged (id ${result.batchId}, ${result.rows} rows) — skipped`,
    );
  } else {
    const byType = await prisma.importRow.groupBy({
      by: ["entityType"],
      where: { batchId: result.batchId },
      _count: { _all: true },
    });
    console.log(`[import-workbook] staged batch ${result.batchId}: ${result.rows} rows`);
    for (const t of byType.sort((a, b) => a.entityType.localeCompare(b.entityType))) {
      console.log(`  ${t.entityType}: ${t._count._all}`);
    }
  }
}

main()
  .catch((e) => {
    console.error("[import-workbook] failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
