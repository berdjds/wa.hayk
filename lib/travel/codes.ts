/**
 * Package code generation: CLIENTSHORT-YYYY-MM-DD-NNNN (contracts.ts).
 *
 * The sequence lives in PackageCodeCounter (one row per agency+date) and is
 * incremented atomically inside a transaction — never count+1, so concurrent
 * requests cannot collide. The NNNN padding is a minimum; sequences beyond
 * 9999 simply grow (String(seq) is not truncated).
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  MIN_CODE_SEQ_PADDING,
  PACKAGE_CODE_PATTERN,
  type ISODate,
} from "@/lib/travel/contracts";
import { companyToday } from "@/lib/travel/settings";

export type PackageCodeErrorCode = "AGENCY_NOT_FOUND" | "AGENCY_NO_SHORTCODE";

export class PackageCodeError extends Error {
  constructor(
    public readonly code: PackageCodeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PackageCodeError";
  }
}

const MAX_SEQ_RETRIES = 3;

export async function generatePackageCode(
  agencyId: string,
  opts?: { date?: ISODate },
): Promise<string> {
  const agency = await prisma.agency.findUnique({ where: { id: agencyId } });
  if (!agency) {
    throw new PackageCodeError("AGENCY_NOT_FOUND", `Agency ${agencyId} does not exist`);
  }
  if (!agency.shortCode) {
    throw new PackageCodeError(
      "AGENCY_NO_SHORTCODE",
      `Agency ${agencyId} has no shortCode`,
    );
  }
  const dateKey = opts?.date ?? (await companyToday());

  for (let attempt = 0; attempt < MAX_SEQ_RETRIES; attempt++) {
    try {
      // Batch (non-interactive) transaction: the upsert+increment is a single
      // atomic statement. Interactive transactions would hold a SQLite write
      // lock across a network round-trip and time out under concurrency.
      const [counter] = await prisma.$transaction([
        prisma.packageCodeCounter.upsert({
          where: { agencyId_dateKey: { agencyId, dateKey } },
          update: { lastSeq: { increment: 1 } },
          create: { agencyId, dateKey, lastSeq: 1 },
        }),
      ]);
      const seq = String(counter.lastSeq).padStart(MIN_CODE_SEQ_PADDING, "0");
      return `${agency.shortCode}-${dateKey}-${seq}`;
    } catch (e) {
      // Concurrent first insert of the counter row loses the unique race;
      // retry and the upsert takes the update path.
      const isUniqueRace =
        e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
      if (!isUniqueRace || attempt === MAX_SEQ_RETRIES - 1) throw e;
    }
  }
  throw new Error("unreachable");
}

export interface ParsedPackageCode {
  shortCode: string;
  dateKey: ISODate;
  seq: number;
}

/** Parses a package code; returns null when the format does not match. */
export function parsePackageCode(code: string): ParsedPackageCode | null {
  if (!PACKAGE_CODE_PATTERN.test(code)) return null;
  const [shortCode, y, m, d, seq] = code.split("-");
  return { shortCode, dateKey: `${y}-${m}-${d}`, seq: parseInt(seq, 10) };
}
