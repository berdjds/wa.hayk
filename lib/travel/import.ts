/**
 * Staging import for the statically-extracted workbook evidence
 * (doc/travel/Workbook-Evidence.json). The original .xlsm is not available;
 * the JSON is the source of truth. Formulas are NEVER evaluated — cached
 * string values are stored as evidence, with the formula text preserved in
 * rawJson (plan §8: "Formula-derived prices require recorded numeric
 * interpretation; never evaluate arbitrary imported expressions").
 *
 * Rows land in ImportBatch/ImportRow with status STAGED (or ERROR for
 * unparseable/ambiguous rows). Activation into catalog tables is a separate
 * step (scripts/seed-travel-catalog.ts).
 */

import { createHash } from "crypto";
import { readFileSync } from "fs";
import { basename } from "path";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { CostCategory } from "@/lib/travel/contracts";

// ---------------------------------------------------------------------------
// Evidence file shape
// ---------------------------------------------------------------------------

export interface EvidenceCell {
  cell: string;
  value: string;
  formula?: string;
}

export interface WorkbookEvidence {
  sha256: string;
  source_filename: string;
  sheets: { name: string; cells: EvidenceCell[] }[];
}

// ---------------------------------------------------------------------------
// Sheet access helpers
// ---------------------------------------------------------------------------

type CellMap = Map<string, EvidenceCell>;

function sheetMap(evidence: WorkbookEvidence, name: string): CellMap {
  const sheet = evidence.sheets.find((s) => s.name === name);
  if (!sheet) throw new Error(`Evidence file is missing sheet "${name}"`);
  return new Map(sheet.cells.map((c) => [c.cell, c]));
}

function cell(map: CellMap, ref: string): EvidenceCell | undefined {
  return map.get(ref);
}

function value(map: CellMap, ref: string): string | null {
  const c = map.get(ref);
  return c === undefined ? null : c.value;
}

/** Raw cell snapshot for rawJson: value plus formula text when present. */
function rawCells(map: CellMap, refs: string[]): Record<string, { value: string; formula?: string }> {
  const out: Record<string, { value: string; formula?: string }> = {};
  for (const ref of refs) {
    const c = cell(map, ref);
    if (c !== undefined) out[ref] = c.formula ? { value: c.value, formula: c.formula } : { value: c.value };
  }
  return out;
}

const NUMERIC = /^\d+(\.\d+)?$/;

/**
 * The ONE non-negative-decimal predicate for workbook evidence — shared by
 * import staging and the seed script so a decimal cell ("24000.50") is never
 * accepted by one layer and dropped by the other.
 */
export function isNumeric(v: string | null): v is string {
  return v !== null && NUMERIC.test(v.trim());
}

// ---------------------------------------------------------------------------
// Parsed workbook model (shared with scripts/seed-travel-catalog.ts)
// ---------------------------------------------------------------------------

export interface HotelCatalogRow {
  row: number;
  name: string;
  /** SGL/DBL/TPL/EXTRA_BED raw string per column C/D/E/F; null = empty cell. */
  rates: Record<"SGL" | "DBL" | "TPL" | "EXTRA_BED", string | null>;
  rateFormulas: Record<string, string>; // column -> formula text, when the cell held one
  seasonalNote: string | null; // L
  note: string | null; // M
}

export const OCCUPANCY_COLUMNS = [
  { col: "C", occupancy: "SGL" },
  { col: "D", occupancy: "DBL" },
  { col: "E", occupancy: "TPL" },
  { col: "F", occupancy: "EXTRA_BED" },
] as const;

export interface ServiceCatalogRow {
  row: number;
  name: string;
  amount: string | null; // null = empty/TBC cell
  currency: "AMD";
  category: CostCategory;
  /** Shared group tours carry weekday notes in F (rows 69:72). */
  note: string | null;
  /** Row 149 "Lunch Gaid Driver" sits in guest meals but is a staff cost. */
  reclassified: boolean;
}

export interface GeorgiaBandRow {
  row: number;
  col: "C" | "D" | "E";
  hotel: string; // B cell, e.g. "3★ Vista hotel or similar"
  duration: "3N/4D" | "4N/5D";
  bandHeader: string; // B208 / B213 program description
  paxBand: 2 | 4 | 6;
  amount: string;
  currency: "USD";
  basis: "PER_PERSON";
}

export interface TemplateRow {
  headerRow: number;
  code: string; // verbatim, incl. the ARMGG typo (plan §3.6)
  name: string;
  nights: number;
  days: number;
  durationNote: string | null; // set when duration had to be derived
  dayNarratives: { day: number; narrative: string }[];
  legacyMarkup: string | null; // normalized decimal string, e.g. "0.14"
  legacyMarkupRaw: string | null; // as found, e.g. "0.14000000000000001"
  provenance: string;
}

export interface ParsedWorkbook {
  hotels: HotelCatalogRow[];
  services: ServiceCatalogRow[];
  georgiaBands: GeorgiaBandRow[];
  templates: TemplateRow[];
}

// Row ranges in "Tour Calculator" (plan §3.1/§3.3).
const HOTEL_ROW_RANGE: [number, number] = [5, 38];

const SERVICE_RANGES: { range: [number, number]; category: CostCategory }[] = [
  { range: [52, 74], category: "TRANSPORTATION" },
  { range: [94, 111], category: "TICKETS" },
  { range: [119, 122], category: "EXTRA_SERVICES" },
  { range: [133, 149], category: "GUEST_MEALS" },
  { range: [157, 174], category: "GUIDES" },
  { range: [181, 183], category: "STAFF_ACCOMMODATION" },
  { range: [190, 193], category: "STAFF_MEALS" },
  { range: [199, 202], category: "TOUR_LEADER" },
];

// Georgia USD-per-person bands: header row -> data rows (plan §3.6).
const GEORGIA_BLOCKS = [
  { headerRow: 208, dataRows: [209, 210, 211], duration: "3N/4D" as const },
  { headerRow: 213, dataRows: [214, 215, 216], duration: "4N/5D" as const },
];
const GEORGIA_PAX_COLUMNS = [
  { col: "C" as const, pax: 2 as const },
  { col: "D" as const, pax: 4 as const },
  { col: "E" as const, pax: 6 as const },
];

// Template header rows in "Mass Calculation" (plan §3.6 table).
export const TEMPLATE_HEADER_ROWS = [2, 13, 24, 35, 46, 57, 68, 87, 98, 109, 120, 136, 147];

const DURATION_RE = /(\d+)\s*nights?\s*\/\s*(\d+)\s*days?/i;
const DAY_RE = /^Day\s*(\d+)\./;

export function parseWorkbookEvidence(evidence: WorkbookEvidence): ParsedWorkbook {
  const tc = sheetMap(evidence, "Tour Calculator");
  const mc = sheetMap(evidence, "Mass Calculation");

  const hotels: HotelCatalogRow[] = [];
  for (let r = HOTEL_ROW_RANGE[0]; r <= HOTEL_ROW_RANGE[1]; r++) {
    const name = value(tc, `B${r}`);
    if (!name) continue; // empty slots (plan: eight empty slots through row 46)
    const rates: HotelCatalogRow["rates"] = { SGL: null, DBL: null, TPL: null, EXTRA_BED: null };
    const rateFormulas: Record<string, string> = {};
    for (const { col, occupancy } of OCCUPANCY_COLUMNS) {
      const c = cell(tc, `${col}${r}`);
      rates[occupancy] = c?.value ?? null;
      if (c?.formula) rateFormulas[occupancy] = c.formula;
    }
    hotels.push({
      row: r,
      name,
      rates,
      rateFormulas,
      seasonalNote: value(tc, `L${r}`),
      note: value(tc, `M${r}`),
    });
  }

  const services: ServiceCatalogRow[] = [];
  for (const { range, category } of SERVICE_RANGES) {
    for (let r = range[0]; r <= range[1]; r++) {
      const name = value(tc, `B${r}`);
      if (!name) continue;
      const raw = value(tc, `C${r}`);
      // Row 149 "Lunch Gaid Driver" is misclassified staff food inside the
      // guest-meals block (plan §3.3); stage it under STAFF_MEALS.
      const reclassified = category === "GUEST_MEALS" && /gaid|guide/i.test(name) && /driver/i.test(name);
      services.push({
        row: r,
        name,
        amount: isNumeric(raw) ? raw.trim() : null,
        currency: "AMD",
        category: reclassified ? "STAFF_MEALS" : category,
        note: value(tc, `F${r}`),
        reclassified,
      });
    }
  }

  const georgiaBands: GeorgiaBandRow[] = [];
  for (const block of GEORGIA_BLOCKS) {
    const bandHeader = value(tc, `B${block.headerRow}`) ?? "";
    for (const r of block.dataRows) {
      const hotel = value(tc, `B${r}`);
      if (!hotel) continue;
      for (const { col, pax } of GEORGIA_PAX_COLUMNS) {
        const raw = value(tc, `${col}${r}`);
        if (!isNumeric(raw)) continue;
        georgiaBands.push({
          row: r,
          col,
          hotel,
          duration: block.duration,
          bandHeader,
          paxBand: pax,
          amount: raw.trim(),
          currency: "USD",
          basis: "PER_PERSON",
        });
      }
    }
  }

  const templates: TemplateRow[] = [];
  for (const headerRow of TEMPLATE_HEADER_ROWS) {
    const code = value(mc, `A${headerRow}`);
    const name = value(mc, `B${headerRow}`);
    if (!code || !name) continue;

    // Legacy "Margin %" sits one row above each header; the label is wrong —
    // the workbook applies it as markup on cost (plan §3.4).
    const markupRaw = value(mc, `B${headerRow - 1}`);
    const markupNum = markupRaw !== null ? Number(markupRaw) : NaN;
    const legacyMarkup = Number.isFinite(markupNum) ? String(markupNum) : null;

    // Duration is usually at C<header>; ARMG-S26-0304A has it displaced to
    // C88 ("Transportation" sits at C87) — check the next row too.
    let nights: number | null = null;
    let days: number | null = null;
    for (const r of [headerRow, headerRow + 1]) {
      const m = (value(mc, `C${r}`) ?? "").match(DURATION_RE);
      if (m) {
        nights = parseInt(m[1], 10);
        days = parseInt(m[2], 10);
        break;
      }
    }

    const dayNarratives: { day: number; narrative: string }[] = [];
    for (let r = headerRow + 1; r <= headerRow + 20; r++) {
      if (TEMPLATE_HEADER_ROWS.includes(r)) break;
      const a = value(mc, `A${r}`);
      const m = a?.match(DAY_RE);
      if (!m) continue;
      const narrative = value(mc, `B${r}`);
      if (narrative) dayNarratives.push({ day: parseInt(m[1], 10), narrative });
    }

    let durationNote: string | null = null;
    if (nights === null || days === null) {
      // GEO-S26-0405A states no C duration; derive from itinerary day count
      // (5 day rows -> 4 nights / 5 days, matching the code suffix 0405).
      days = dayNarratives.length;
      nights = Math.max(days - 1, 0);
      durationNote = `Duration not stated at C${headerRow}; derived from ${days} itinerary days`;
    }

    templates.push({
      headerRow,
      code,
      name,
      nights,
      days,
      durationNote,
      dayNarratives,
      legacyMarkup,
      legacyMarkupRaw: markupRaw,
      provenance: `Mass Calculation row ${headerRow}`,
    });
  }

  return { hotels, services, georgiaBands, templates };
}

// ---------------------------------------------------------------------------
// Staging
// ---------------------------------------------------------------------------

interface RowSpec {
  entityType: string;
  sourceRef: string;
  rawJson: string;
  normalizedJson?: string;
  status: "STAGED" | "ERROR";
  issueText?: string;
}

const TBC_ISSUE = "TBC rate — needs supplier verification";

function buildRowSpecs(evidence: WorkbookEvidence, parsed: ParsedWorkbook): RowSpec[] {
  const tc = sheetMap(evidence, "Tour Calculator");
  const mc = sheetMap(evidence, "Mass Calculation");
  const specs: RowSpec[] = [];

  for (const h of parsed.hotels) {
    const refs = ["B", "C", "D", "E", "F", "L", "M"].map((c) => `${c}${h.row}`);
    specs.push({
      entityType: "HOTEL",
      sourceRef: `Tour Calculator!B${h.row}`,
      rawJson: JSON.stringify(rawCells(tc, refs)),
      normalizedJson: JSON.stringify({
        name: h.name,
        rates: h.rates,
        seasonalNote: h.seasonalNote,
        note: h.note,
      }),
      status: "STAGED",
    });
    for (const { col, occupancy } of OCCUPANCY_COLUMNS) {
      const ref = `${col}${h.row}`;
      const raw = h.rates[occupancy];
      const formula = h.rateFormulas[occupancy];
      const numeric = isNumeric(raw);
      specs.push({
        entityType: "RATE",
        sourceRef: `Tour Calculator!${ref}`,
        rawJson: JSON.stringify(rawCells(tc, [ref, `B${h.row}`])),
        normalizedJson: JSON.stringify({
          hotel: h.name,
          occupancy,
          amount: numeric ? raw!.trim() : null,
          currency: "AMD",
          // e.g. F8 "=5000+10000": cached value stored, formula kept as evidence
          formulaDerived: formula ?? null,
        }),
        status: "STAGED",
        issueText: numeric
          ? formula
            ? `Formula-derived price (${formula}); cached value stored, commercial meaning unverified`
            : undefined
          : TBC_ISSUE,
      });
    }
  }

  for (const s of parsed.services) {
    const refs = [`B${s.row}`, `C${s.row}`, `F${s.row}`];
    specs.push({
      entityType: "SERVICE",
      sourceRef: `Tour Calculator!C${s.row}`,
      rawJson: JSON.stringify(rawCells(tc, refs)),
      normalizedJson: JSON.stringify({
        name: s.name,
        category: s.category,
        amount: s.amount,
        currency: s.currency,
        note: s.note,
        isStaffCost:
          s.category === "STAFF_ACCOMMODATION" ||
          s.category === "STAFF_MEALS" ||
          s.category === "TOUR_LEADER",
      }),
      status: "STAGED",
      issueText: s.reclassified
        ? `Misclassified in guest meals at Tour Calculator row ${s.row}; staged as STAFF_MEALS`
        : s.amount === null
          ? "No numeric price in source cell"
          : undefined,
    });
  }

  for (const g of parsed.georgiaBands) {
    const ref = `${g.col}${g.row}`;
    specs.push({
      entityType: "GEORGIA_BAND",
      sourceRef: `Tour Calculator!${ref}`,
      rawJson: JSON.stringify(rawCells(tc, [`B${g.row}`, ref, `B${g.duration === "3N/4D" ? 208 : 213}`])),
      normalizedJson: JSON.stringify({
        hotel: g.hotel,
        duration: g.duration,
        paxBand: g.paxBand,
        amount: g.amount,
        currency: g.currency,
        basis: g.basis,
        program: g.bandHeader,
      }),
      status: "STAGED",
    });
  }

  for (const t of parsed.templates) {
    const refs: string[] = [`A${t.headerRow}`, `B${t.headerRow}`, `C${t.headerRow}`, `A${t.headerRow - 1}`, `B${t.headerRow - 1}`];
    for (const d of t.dayNarratives) {
      const r = t.headerRow + d.day;
      refs.push(`A${r}`, `B${r}`);
    }
    specs.push({
      entityType: "TEMPLATE",
      sourceRef: `Mass Calculation!A${t.headerRow}`,
      rawJson: JSON.stringify(rawCells(mc, refs)),
      normalizedJson: JSON.stringify({
        code: t.code,
        name: t.name,
        nights: t.nights,
        days: t.days,
        durationNote: t.durationNote,
        dayNarratives: t.dayNarratives,
        legacyMarkup: t.legacyMarkup,
        legacyMarkupRaw: t.legacyMarkupRaw,
        provenance: t.provenance,
      }),
      status: "STAGED",
    });
  }

  return specs;
}

export interface StageResult {
  batchId: string;
  rows: number;
  skipped: boolean;
}

/**
 * Stages a workbook evidence JSON file into ImportBatch/ImportRow.
 * Idempotent on opts.idempotencyKey: a repeat call returns the existing batch
 * with skipped: true. Row writes are upserts on @@unique(batchId, entityType,
 * sourceRef), so a crashed batch can be re-staged without duplicates.
 */
export async function stageWorkbookEvidence(
  filePath: string,
  opts: { idempotencyKey: string; createdById?: string },
): Promise<StageResult> {
  const content = readFileSync(filePath);
  const sourceHash = createHash("sha256").update(content).digest("hex");

  const existing = await prisma.importBatch.findUnique({
    where: { idempotencyKey: opts.idempotencyKey },
  });
  if (existing) {
    const rows = await prisma.importRow.count({ where: { batchId: existing.id } });
    return { batchId: existing.id, rows, skipped: true };
  }

  let evidence: WorkbookEvidence;
  try {
    evidence = JSON.parse(content.toString("utf8")) as WorkbookEvidence;
  } catch (e) {
    throw new Error(`Evidence file is not parseable JSON: ${(e as Error).message}`);
  }
  if (!Array.isArray(evidence.sheets)) {
    throw new Error("Evidence file has no sheets array");
  }

  const parsed = parseWorkbookEvidence(evidence);
  const specs = buildRowSpecs(evidence, parsed);

  let batch;
  try {
    batch = await prisma.importBatch.create({
      data: {
        sourceHash,
        fileName: basename(filePath),
        idempotencyKey: opts.idempotencyKey,
        createdById: opts.createdById ?? null,
      },
    });
  } catch (e) {
    // Concurrent stager won the idempotency race — report their batch.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const winner = await prisma.importBatch.findUnique({
        where: { idempotencyKey: opts.idempotencyKey },
      });
      if (winner) {
        const rows = await prisma.importRow.count({ where: { batchId: winner.id } });
        return { batchId: winner.id, rows, skipped: true };
      }
    }
    throw e;
  }

  await prisma.$transaction(
    specs.map((s) =>
      prisma.importRow.upsert({
        where: {
          batchId_entityType_sourceRef: {
            batchId: batch.id,
            entityType: s.entityType,
            sourceRef: s.sourceRef,
          },
        },
        update: {
          rawJson: s.rawJson,
          normalizedJson: s.normalizedJson ?? null,
          status: s.status,
          issueText: s.issueText ?? null,
        },
        create: {
          batchId: batch.id,
          entityType: s.entityType,
          sourceRef: s.sourceRef,
          rawJson: s.rawJson,
          normalizedJson: s.normalizedJson ?? null,
          status: s.status,
          issueText: s.issueText ?? null,
        },
      }),
    ),
  );

  return { batchId: batch.id, rows: specs.length, skipped: false };
}
