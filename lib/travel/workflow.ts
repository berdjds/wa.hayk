/**
 * Travel quotation workflow state machine.
 *
 * Every transition function takes the acting user as `{ id, role, ... }` and
 * enforces RBAC itself (routes stay thin). State changes, audit-relevant rows
 * and notification outbox rows commit in ONE interactive transaction via
 * queueWorkflowEvent(), so a committed transition always has its event and a
 * rolled-back one never notifies.
 *
 * Errors are WorkflowError(code, message, httpStatus) — routes map them
 * verbatim; ZodError from input schemas maps to 400.
 *
 * Status guards follow QUOTE_TRANSITIONS in contracts.ts; approval binds to
 * the exact CalculationSnapshot hash so a validator can never approve
 * something other than what was computed.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { Prisma } from "@prisma/client";
import type { User } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { writeAuditLog } from "@/lib/audit";
import {
  COST_CATEGORIES,
  PRICING_BASES,
  REVIEW_ACTIONS,
  ROLE_ADMIN,
  ROLE_ADVISOR,
  ROLE_VALIDATOR,
  canGrantFloorException,
  normalizeDayServices,
  versionLabel,
  type EngineOutput,
  type NotificationPayload,
  type QuoteStatus,
  type WorkflowEventType,
} from "@/lib/travel/contracts";
import { calculate } from "@/lib/travel/engine";
import { buildEngineInputForVersion } from "@/lib/travel/resolve";
import { canonicalize, snapshotHash } from "@/lib/travel/snapshots";
import { generatePackageCode } from "@/lib/travel/codes";
import { getActivePolicy, getCompanyBranding, getFxMap, getTravelSettings } from "@/lib/travel/settings";
import { queueWorkflowEvent } from "@/lib/travel/notifications";
import type { QuotationPdfBranding, QuotationPdfItineraryDay } from "@/lib/travel/pdf/types";

// ---------------------------------------------------------------------------
// Errors and actor
// ---------------------------------------------------------------------------

export class WorkflowError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly httpStatus: number = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "WorkflowError";
  }
}

export interface WorkflowActor {
  id: string;
  role: string;
  name?: string | null;
  email?: string | null;
}

/**
 * Interactive SQLite transactions can lose the write-lock race under
 * concurrency (P1008) or time out waiting for it (P2028). Every transaction
 * body in this module is idempotent-by-guard (status updateMany checks,
 * unique dedup keys), so retrying the whole transaction is safe and turns
 * spurious lock errors into the correct domain outcome (e.g. 409
 * INVALID_STATE for the loser of a race). WorkflowErrors are never retried.
 */
const TX_RETRYABLE = new Set(["P1008", "P2028"]);

export async function tx<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  const MAX_ATTEMPTS = 6;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // Generous maxWait/timeout: SQLite serializes writers, so under a burst
      // each transaction queues behind the others; the 5s defaults expire
      // before the lock is even acquired.
      return await prisma.$transaction(fn, { maxWait: 20000, timeout: 30000 });
    } catch (err: any) {
      lastErr = err;
      if (!TX_RETRYABLE.has(err?.code) || attempt === MAX_ATTEMPTS) throw err;
      await new Promise((r) => setTimeout(r, 100 * attempt));
    }
  }
  throw lastErr;
}

function actorName(actor: WorkflowActor): string {
  return actor.name || actor.email || actor.id;
}

// ---------------------------------------------------------------------------
// Input schemas (routes safeParse with these; functions re-parse defensively)
// ---------------------------------------------------------------------------

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

// Non-negative decimal money; trimmed first, plain-decimal syntax only so
// "0x10"/"1e3" are rejected at the boundary (engine re-validates regardless).
const moneyString = z.string().trim().regex(/^\d+(\.\d+)?$/, "expected a non-negative decimal string");
// Payload-size caps: free text is bounded so a pasted blob cannot blow up a
// request row or a snapshot.
const shortString = z.string().max(200);
const longString = z.string().max(4000);

export const travelerSchema = z
  .object({
    adults: z.number().int().min(0),
    children: z.number().int().min(0),
    infants: z.number().int().min(0),
    // One age per child, 0-17 (age at return/check-out) — mirrors the
    // booking.com occupancy picker the operator works from.
    childAges: z.array(z.number().int().min(0).max(17)).optional(),
    paying: z.number().int().min(0),
    complimentary: z.number().int().min(0),
    leaders: z.number().int().min(0),
    staff: z.number().int().min(0),
  })
  .superRefine((t, ctx) => {
    if (t.childAges !== undefined && t.childAges.length !== t.children) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["childAges"],
        message: "childAges must list one age per child",
      });
    }
  });

export const createRequestSchema = z.object({
  agencyId: z.string().min(1).max(200),
  agencyRef: shortString.nullish(),
  title: z.string().min(1).max(200),
  destinations: z.array(shortString).optional(),
  startDate: isoDate,
  endDate: isoDate,
  travelers: travelerSchema,
  roomPrefs: longString.nullish(),
  flightDetails: longString.nullish(),
  notes: longString.nullish(),
});
export type CreateRequestInput = z.infer<typeof createRequestSchema>;

export const updateDraftSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  destinations: z.array(shortString).optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  travelers: travelerSchema.optional(),
  roomPrefs: longString.nullish(),
  flightDetails: longString.nullish(),
  notes: longString.nullish(),
  agencyRef: shortString.nullish(),
});
export type UpdateDraftInput = z.infer<typeof updateDraftSchema>;

export const allocationSchema = z.object({
  roomType: z.string().min(1).max(200),
  rooms: z.number().int().min(0),
  adults: z.number().int().min(0),
  children: z.number().int().min(0),
  infants: z.number().int().min(0),
  extraBeds: z.number().int().min(0),
  capacityAdults: z.number().int().min(0),
  capacityChildren: z.number().int().min(0),
  capacityTotal: z.number().int().min(0),
  extraBedAllowed: z.boolean(),
  extraBedIncludedInRate: z.boolean(),
  wholeUnit: z.boolean(),
});

// Attribution is NEVER client-supplied: saveVersionContent stamps actor.id
// server-side; resolve.ts still demands reason+actor on the stored record.
const rateOverrideSchema = z.object({
  rate: moneyString,
  reason: z.string().trim().min(1).max(4000),
});

export const stayContentSchema = z.object({
  hotelProductId: shortString.nullish(),
  hotelName: z.string().min(1).max(200),
  city: shortString.nullish(),
  checkIn: isoDate,
  checkOut: isoDate,
  board: shortString.nullish(),
  allocations: z.array(allocationSchema).min(1),
  rateOverrides: z.record(rateOverrideSchema).nullish(),
});

export const scenarioContentSchema = z.object({
  /** Client-side key so service lines can reference this scenario before ids exist. */
  key: shortString.optional(),
  label: z.string().min(1).max(200),
  stays: z.array(stayContentSchema).max(50).default([]),
});

export const serviceLineContentSchema = z
  .object({
    /** References scenarioContentSchema.key; null = shared across scenarios. */
    scenarioKey: shortString.nullish(),
    category: z.enum(COST_CATEGORIES),
    label: z.string().min(1).max(200),
    basis: z.enum(PRICING_BASES),
    currency: z.string().max(10).default("AMD"),
    unitRate: moneyString.nullish(),
    quantity: moneyString.default("1"),
    participants: z.number().int().min(0).nullish(),
    capacity: z.number().int().min(1).nullish(),
    includedElsewhere: z.boolean().default(false),
    isStaffCost: z.boolean().default(false),
    overrideRate: moneyString.nullish(),
    overrideReason: longString.nullish(),
    sourceRef: shortString.nullish(),
    /** Catalog link, echoed back by editors so day-linked lines survive the delete-many+recreate below. */
    serviceProductId: z.string().nullish(),
    /** YYYY-MM-DD of the itinerary day this line is pinned to; null = not day-linked. */
    date: isoDate.nullish(),
    /** Selected fleet vehicle; per-vehicle SERVICE rates resolve for it. null = base rate. */
    vehicleTypeId: z.string().nullish(),
  })
  .superRefine((line, ctx) => {
    // An override rate without a recorded reason is unauditable — refuse it
    // at the boundary, not later in resolve.ts.
    if (line.overrideRate != null && !line.overrideReason?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["overrideReason"],
        message: "overrideReason is required when overrideRate is set",
      });
    }
  });

/** A day service is normally a structured item; legacy string items (pre-Phase-3 payloads and template JSON) are accepted and normalized. */
const dayServiceItemSchema = z.preprocess(
  (value) => (typeof value === "string" ? { label: value } : value),
  z.object({ serviceProductId: z.string().nullish(), label: shortString, vehicleTypeId: z.string().nullish() }),
);

export const itineraryDayContentSchema = z.object({
  dayOffset: z.number().int().min(0),
  date: isoDate,
  narrative: longString.nullish(),
  overnightCity: shortString.nullish(),
  services: z.array(dayServiceItemSchema).nullish(),
});

export const saveVersionContentSchema = z.object({
  /** Optimistic lock on TravelRequest.revision (see updateDraft). */
  expectedRevision: z.number().int().min(0),
  scenarios: z.array(scenarioContentSchema).max(10).optional(),
  itineraryDays: z.array(itineraryDayContentSchema).max(60).optional(),
  serviceLines: z.array(serviceLineContentSchema).max(200).optional(),
});
export type SaveVersionContentInput = z.infer<typeof saveVersionContentSchema>;

export const reviewSchema = z.object({
  action: z.enum(REVIEW_ACTIONS),
  reason: longString.nullish(),
  snapshotHash: z.string().min(1).max(200),
});

export const issueSchema = z.object({
  idempotencyKey: z.string().min(1).max(200).nullish(),
  belowFloorExceptionReason: longString.nullish(),
});

export const outcomeSchema = z.object({
  outcome: z.enum(["ACCEPTED", "DECLINED", "EXPIRED"]),
  scenarioId: shortString.nullish(),
});

export const assignValidatorSchema = z.object({
  validatorId: z.string().min(1).max(200),
  dueAt: z.string().datetime({ offset: true }).nullish(),
});

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function assertRole(actor: WorkflowActor, roles: string[], code = "FORBIDDEN") {
  if (!roles.includes(actor.role)) {
    throw new WorkflowError(code, `role ${actor.role} is not allowed to perform this action`, 403);
  }
}

function assertOwnerOrAdmin(actor: WorkflowActor, ownerId: string) {
  if (actor.role !== ROLE_ADMIN && actor.id !== ownerId) {
    throw new WorkflowError("FORBIDDEN", "only the owning advisor or an admin may do this", 403);
  }
}

async function loadRequest(requestId: string) {
  const request = await prisma.travelRequest.findUnique({
    where: { id: requestId },
    include: { agency: true, owner: true },
  });
  if (!request) throw new WorkflowError("REQUEST_NOT_FOUND", `travel request ${requestId} not found`, 404);
  return request;
}

async function loadLatestVersion(requestId: string) {
  return prisma.quoteVersion.findFirst({
    where: { requestId },
    orderBy: { versionNo: "desc" },
  });
}

async function loadVersion(versionId: string) {
  const version = await prisma.quoteVersion.findUnique({
    where: { id: versionId },
    include: {
      request: { include: { agency: true, owner: true } },
      snapshot: true,
    },
  });
  if (!version) throw new WorkflowError("VERSION_NOT_FOUND", `quote version ${versionId} not found`, 404);
  return version;
}

async function activeAssignment(requestId: string) {
  return prisma.validationAssignment.findFirst({
    where: { requestId, active: true },
    include: { validator: true },
  });
}

function buildPayload(
  request: { id: string; packageCode: string; agency: { shortCode: string } },
  versionNo: number,
  event: WorkflowEventType,
  actor: WorkflowActor | null,
  extras: Partial<NotificationPayload> = {},
): NotificationPayload {
  return {
    packageCode: request.packageCode,
    clientShort: request.agency.shortCode,
    versionLabel: versionLabel(versionNo),
    event,
    actorName: actor ? actorName(actor) : "System",
    link: `${process.env.NEXTAUTH_URL ?? ""}/travel/requests/${request.id}`,
    timestamp: new Date().toISOString(),
    ...extras,
  };
}

async function loadUsersById(ids: (string | null | undefined)[]): Promise<User[]> {
  const unique = Array.from(new Set(ids.filter((x): x is string => !!x)));
  if (unique.length === 0) return [];
  return prisma.user.findMany({ where: { id: { in: unique } } });
}

/** Status transitions allowed by QUOTE_TRANSITIONS, checked centrally. */
function assertTransition(from: string, allowed: QuoteStatus[], action: string) {
  if (!(allowed as string[]).includes(from)) {
    throw new WorkflowError(
      "INVALID_STATE",
      `cannot ${action} a version in status ${from}`,
      409,
    );
  }
}

// ---------------------------------------------------------------------------
// createRequest
// ---------------------------------------------------------------------------

export async function createRequest(actor: WorkflowActor, data: CreateRequestInput) {
  assertRole(actor, [ROLE_ADMIN, ROLE_ADVISOR]);
  const parsed = createRequestSchema.parse(data);
  if (parsed.endDate <= parsed.startDate) {
    throw new WorkflowError("DATE_ORDER", `endDate ${parsed.endDate} must be after startDate ${parsed.startDate}`);
  }

  // Fail fast with a client error instead of the generic 500 a
  // PackageCodeError would map to; inactive agencies must never get new work.
  const agency = await prisma.agency.findUnique({ where: { id: parsed.agencyId } });
  if (!agency) {
    throw new WorkflowError("AGENCY_NOT_FOUND", `agency ${parsed.agencyId} does not exist`, 404);
  }
  if (!agency.active) {
    throw new WorkflowError("AGENCY_INACTIVE", `agency ${agency.name} (${agency.shortCode}) is inactive`, 400);
  }

  // SQLite serializes writes; under burst concurrency the interactive
  // transaction can lose the lock race (P1008/P2028). Retry the whole creation
  // a few times — code generation is atomic per attempt, so retries only
  // leave harmless sequence gaps, never duplicate codes.
  const MAX_ATTEMPTS = 6;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await createRequestOnce(actor, parsed);
    } catch (err: any) {
      lastErr = err;
      const code = err?.code;
      const retryable = code === "P1008" || code === "P2028";
      if (!retryable || attempt === MAX_ATTEMPTS) throw err;
      await new Promise((r) => setTimeout(r, 100 * attempt));
    }
  }
  throw lastErr;
}

async function createRequestOnce(actor: WorkflowActor, parsed: CreateRequestInput) {
  // Code generation runs its own atomic counter transaction (see codes.ts) and
  // validates that the agency exists and carries a shortCode.
  const packageCode = await generatePackageCode(parsed.agencyId);

  // Skeleton allocation so the draft is calculable-shaped from the start;
  // the advisor refines rooms via saveVersionContent.
  const lodging = parsed.travelers.adults + parsed.travelers.children + parsed.travelers.infants;
  const defaultAllocation = {
    roomType: "DBL",
    rooms: Math.max(1, Math.ceil(Math.max(lodging, 1) / 2)),
    adults: parsed.travelers.adults,
    children: parsed.travelers.children,
    infants: parsed.travelers.infants,
    extraBeds: 0,
    capacityAdults: 2,
    capacityChildren: 0,
    capacityTotal: 2,
    extraBedAllowed: false,
    extraBedIncludedInRate: false,
    wholeUnit: false,
  };

  // Batch transaction with pre-generated ids: no interactive transaction, so
  // no SQLite write lock is held across query round-trips. This is what makes
  // a concurrent creation burst reliable (lock hold ≈ one statement).
  const requestId = randomUUID();
  const versionId = randomUUID();
  const scenarioId = randomUUID();
  const [request, version] = await prisma.$transaction([
      prisma.travelRequest.create({
        data: {
          id: requestId,
          packageCode,
          agencyId: parsed.agencyId,
          agencyRef: parsed.agencyRef ?? null,
          ownerId: actor.id,
          title: parsed.title,
          destinations: parsed.destinations ? JSON.stringify(parsed.destinations) : null,
          startDate: parsed.startDate,
          endDate: parsed.endDate,
          travelers: JSON.stringify(parsed.travelers),
          roomPrefs: parsed.roomPrefs ?? null,
          flightDetails: parsed.flightDetails ?? null,
          notes: parsed.notes ?? null,
          status: "DRAFT",
        },
      }),
      prisma.quoteVersion.create({
        data: { id: versionId, requestId, versionNo: 1, status: "DRAFT" },
      }),
      prisma.scenario.create({
        data: { id: scenarioId, versionId, label: "Option A" },
      }),
      prisma.staySegment.create({
        data: {
          scenarioId,
          hotelName: "TBD",
          checkIn: parsed.startDate,
          checkOut: parsed.endDate,
          allocations: JSON.stringify([defaultAllocation]),
        },
      }),
    ],
  );

  await writeAuditLog("REQUEST_CREATED", actor.id, `Created ${packageCode} "${parsed.title}"`);
  return { request, version };
}

// ---------------------------------------------------------------------------
// updateDraft — optimistic locking on TravelRequest.revision
// ---------------------------------------------------------------------------

const MATERIAL_PATCH_FIELDS = ["destinations", "startDate", "endDate", "travelers"] as const;

export async function updateDraft(
  actor: WorkflowActor,
  requestId: string,
  expectedRevision: number,
  patch: UpdateDraftInput,
) {
  const parsed = updateDraftSchema.parse(patch);
  const request = await loadRequest(requestId);
  assertOwnerOrAdmin(actor, request.ownerId);

  const version = await loadLatestVersion(requestId);
  if (!version) throw new WorkflowError("VERSION_NOT_FOUND", "request has no versions", 404);
  assertTransition(version.status, ["DRAFT", "CHANGES_REQUESTED"], "edit");

  const nextStart = parsed.startDate ?? request.startDate;
  const nextEnd = parsed.endDate ?? request.endDate;
  if (nextEnd <= nextStart) {
    throw new WorkflowError("DATE_ORDER", `endDate ${nextEnd} must be after startDate ${nextStart}`);
  }

  const material = MATERIAL_PATCH_FIELDS.some((f) => parsed[f] !== undefined);

  const data: Prisma.TravelRequestUpdateManyMutationInput = {
    revision: { increment: 1 },
  };
  if (parsed.title !== undefined) data.title = parsed.title;
  if (parsed.destinations !== undefined) data.destinations = JSON.stringify(parsed.destinations);
  if (parsed.startDate !== undefined) data.startDate = parsed.startDate;
  if (parsed.endDate !== undefined) data.endDate = parsed.endDate;
  if (parsed.travelers !== undefined) data.travelers = JSON.stringify(parsed.travelers);
  if (parsed.roomPrefs !== undefined) data.roomPrefs = parsed.roomPrefs;
  if (parsed.flightDetails !== undefined) data.flightDetails = parsed.flightDetails;
  if (parsed.notes !== undefined) data.notes = parsed.notes;
  if (parsed.agencyRef !== undefined) data.agencyRef = parsed.agencyRef;

  await tx(async (tx) => {
    const res = await tx.travelRequest.updateMany({
      where: { id: requestId, revision: expectedRevision },
      data,
    });
    if (res.count === 0) {
      throw new WorkflowError(
        "CONFLICT",
        `revision mismatch: expected ${expectedRevision}, request was modified concurrently`,
        409,
      );
    }
    // A material edit invalidates a previously computed snapshot (only
    // reachable from CHANGES_REQUESTED — DRAFTs have no snapshot yet).
    if (material) {
      await tx.calculationSnapshot.deleteMany({ where: { versionId: version.id } });
    }
  });

  await writeAuditLog("REQUEST_UPDATED", actor.id, `Updated ${request.packageCode} (material: ${material})`);
  return prisma.travelRequest.findUnique({ where: { id: requestId } });
}

// ---------------------------------------------------------------------------
// saveVersionContent — replace scenario/stay/line/itinerary collections
// ---------------------------------------------------------------------------

export async function saveVersionContent(
  actor: WorkflowActor,
  versionId: string,
  content: SaveVersionContentInput,
) {
  const parsed = saveVersionContentSchema.parse(content);
  const version = await loadVersion(versionId);
  assertOwnerOrAdmin(actor, version.request.ownerId);
  assertTransition(version.status, ["DRAFT", "CHANGES_REQUESTED"], "edit content of");

  const result = await tx(async (tx) => {
    const scenarioIdByKey = new Map<string, string>();

    if (parsed.scenarios) {
      await tx.scenario.deleteMany({ where: { versionId } }); // cascades stays
      for (const sc of parsed.scenarios) {
        const created = await tx.scenario.create({
          data: { versionId, label: sc.label },
        });
        if (sc.key) scenarioIdByKey.set(sc.key, created.id);
        for (const stay of sc.stays) {
          await tx.staySegment.create({
            data: {
              scenarioId: created.id,
              hotelProductId: stay.hotelProductId ?? null,
              hotelName: stay.hotelName,
              city: stay.city ?? null,
              checkIn: stay.checkIn,
              checkOut: stay.checkOut,
              board: stay.board ?? null,
              allocations: JSON.stringify(stay.allocations),
              // Attribution is stamped here, never trusted from the client —
              // otherwise an override could be pinned on someone else.
              rateOverrides: stay.rateOverrides
                ? JSON.stringify(
                    Object.fromEntries(
                      Object.entries(stay.rateOverrides).map(([roomType, ov]) => [
                        roomType,
                        { rate: ov.rate, reason: ov.reason, actorId: actor.id },
                      ]),
                    ),
                  )
                : null,
            },
          });
        }
      }
    }

    if (parsed.serviceLines) {
      // Client-supplied catalog links must reference real products (batched;
      // same guard style as the itinerary-day sync). Line payloads stay
      // authoritative for category/basis — no product-field copying here.
      const linkedProductIds = Array.from(
        new Set(
          parsed.serviceLines.map((l) => l.serviceProductId).filter((id): id is string => !!id),
        ),
      );
      if (linkedProductIds.length) {
        const found = await tx.serviceProduct.findMany({ where: { id: { in: linkedProductIds } } });
        const foundIds = new Set(found.map((p) => p.id));
        for (const id of linkedProductIds) {
          if (!foundIds.has(id)) {
            throw new WorkflowError("SERVICE_PRODUCT_UNKNOWN", `unknown service product ${id}`, 400);
          }
        }
      }
      const linkedVehicleIds = Array.from(
        new Set(
          parsed.serviceLines.map((l) => l.vehicleTypeId).filter((id): id is string => !!id),
        ),
      );
      if (linkedVehicleIds.length) {
        const found = await tx.vehicleType.findMany({ where: { id: { in: linkedVehicleIds } } });
        const foundIds = new Set(found.map((v) => v.id));
        for (const id of linkedVehicleIds) {
          if (!foundIds.has(id)) {
            throw new WorkflowError("VEHICLE_TYPE_UNKNOWN", `unknown vehicle type ${id}`, 400);
          }
        }
      }
      await tx.serviceLine.deleteMany({ where: { versionId } });
      for (const line of parsed.serviceLines) {
        const scenarioId = line.scenarioKey ? scenarioIdByKey.get(line.scenarioKey) ?? null : null;
        if (line.scenarioKey && !scenarioId) {
          throw new WorkflowError(
            "SCENARIO_KEY_UNKNOWN",
            `service line "${line.label}" references unknown scenario key "${line.scenarioKey}"`,
          );
        }
        await tx.serviceLine.create({
          data: {
            versionId,
            scenarioId,
            category: line.category,
            label: line.label,
            basis: line.basis,
            currency: line.currency,
            unitRate: line.unitRate ?? null,
            quantity: line.quantity,
            participants: line.participants ?? null,
            capacity: line.capacity ?? null,
            includedElsewhere: line.includedElsewhere,
            isStaffCost: line.isStaffCost,
            overrideRate: line.overrideRate ?? null,
            overrideReason: line.overrideRate != null ? line.overrideReason ?? null : null,
            overrideById: line.overrideRate != null ? actor.id : null,
            sourceRef: line.sourceRef ?? null,
            serviceProductId: line.serviceProductId ?? null,
            date: line.date ?? null,
            vehicleTypeId: line.vehicleTypeId ?? null,
          },
        });
      }
    }

    // True when the itinerary-day → linked ServiceLine sync below creates,
    // retargets or deletes a line; such changes alter the calculation, so the
    // snapshot invalidation further down keys on it.
    let linkedLinesChanged = false;

    if (parsed.itineraryDays) {
      await tx.itineraryDay.deleteMany({ where: { versionId } });
      for (const day of parsed.itineraryDays) {
        await tx.itineraryDay.create({
          data: {
            versionId,
            dayOffset: day.dayOffset,
            date: day.date,
            narrative: day.narrative ?? null,
            overnightCity: day.overnightCity ?? null,
            services: day.services ? JSON.stringify(day.services) : null,
          },
        });
      }

      // Sync day-linked service lines: each catalog service pinned to a day
      // exists as exactly one shared ServiceLine per (product, date, vehicle)
      // triple — the same tour in two different vehicles is two lines. Manual
      // lines (no serviceProductId) and scenario-bound lines are never
      // touched here — they belong to the Scenarios tab editor.
      const desired = new Map<string, { productId: string; date: string; vehicleTypeId: string | null }>();
      for (const day of parsed.itineraryDays) {
        for (const svc of day.services ?? []) {
          if (svc.serviceProductId) {
            const vehicleTypeId = svc.vehicleTypeId ?? null;
            desired.set(`${svc.serviceProductId}${day.date}${vehicleTypeId ?? ""}`, {
              productId: svc.serviceProductId,
              date: day.date,
              vehicleTypeId,
            });
          }
        }
      }
      // One batched lookup for all referenced products; unknown or inactive
      // products are a client error, not a silent skip.
      const desiredPairs = Array.from(desired.values());
      const productIds = Array.from(new Set(desiredPairs.map((d) => d.productId)));
      const products = productIds.length
        ? await tx.serviceProduct.findMany({ where: { id: { in: productIds } } })
        : [];
      const productById = new Map(products.map((p) => [p.id, p]));
      for (const { productId } of desiredPairs) {
        const product = productById.get(productId);
        if (!product) {
          throw new WorkflowError("SERVICE_PRODUCT_UNKNOWN", `unknown service product ${productId}`, 400);
        }
        if (!product.active) {
          throw new WorkflowError("SERVICE_PRODUCT_INACTIVE", `service product "${product.name}" is inactive`, 400);
        }
      }
      // Vehicle selections must reference real fleet rows (same guard style).
      const vehicleIds = Array.from(
        new Set(desiredPairs.map((d) => d.vehicleTypeId).filter((id): id is string => !!id)),
      );
      if (vehicleIds.length) {
        const found = await tx.vehicleType.findMany({ where: { id: { in: vehicleIds } } });
        const foundIds = new Set(found.map((v) => v.id));
        for (const id of vehicleIds) {
          if (!foundIds.has(id)) {
            throw new WorkflowError("VEHICLE_TYPE_UNKNOWN", `unknown vehicle type ${id}`, 400);
          }
        }
      }

      const linked = await tx.serviceLine.findMany({
        where: { versionId, serviceProductId: { not: null }, scenarioId: null },
      });
      const unmatched = [...linked];
      for (const { productId, date, vehicleTypeId } of desiredPairs) {
        const exactIdx = unmatched.findIndex(
          (l) => l.serviceProductId === productId && l.date === date && (l.vehicleTypeId ?? null) === vehicleTypeId,
        );
        if (exactIdx >= 0) {
          unmatched.splice(exactIdx, 1);
          continue;
        }
        // Same product on a different day or with a changed vehicle: retarget
        // the existing line so any manual edits on it (quantity, typed rate,
        // override) survive the move. Prefer the line already carrying the
        // same vehicle so two-vehicle days never steal each other's lines.
        let moveIdx = unmatched.findIndex(
          (l) => l.serviceProductId === productId && (l.vehicleTypeId ?? null) === vehicleTypeId,
        );
        if (moveIdx < 0) moveIdx = unmatched.findIndex((l) => l.serviceProductId === productId);
        if (moveIdx >= 0) {
          const line = unmatched.splice(moveIdx, 1)[0];
          await tx.serviceLine.update({ where: { id: line.id }, data: { date, vehicleTypeId } });
          linkedLinesChanged = true;
          continue;
        }
        const product = productById.get(productId)!;
        await tx.serviceLine.create({
          data: {
            versionId,
            scenarioId: null, // day-linked lines are shared across scenarios
            category: product.category,
            label: product.name,
            basis: product.basis,
            currency: "AMD",
            // null rate on purpose: resolve.ts prices linked lines from the
            // catalog band covering `date` (per vehicle when one is selected).
            unitRate: null,
            quantity: "1",
            capacity: product.capacity ?? null,
            serviceProductId: productId,
            date,
            vehicleTypeId,
          },
        });
        linkedLinesChanged = true;
      }
      for (const stale of unmatched) {
        await tx.serviceLine.delete({ where: { id: stale.id } });
        linkedLinesChanged = true;
      }
    }

    // Scenario/service changes alter the calculation; a stored snapshot (from
    // a CHANGES_REQUESTED round) must not survive them. Day-only edits keep
    // the snapshot unless they moved linked lines.
    if (parsed.scenarios || parsed.serviceLines || linkedLinesChanged) {
      await tx.calculationSnapshot.deleteMany({ where: { versionId } });
    }
    // Optimistic lock: the client edits what it last read. A stale
    // expectedRevision means the request changed underneath the editor.
    const lock = await tx.travelRequest.updateMany({
      where: { id: version.requestId, revision: parsed.expectedRevision },
      data: { revision: { increment: 1 } },
    });
    if (lock.count === 0) {
      throw new WorkflowError(
        "CONFLICT",
        `revision mismatch: expected ${parsed.expectedRevision}, request was modified concurrently`,
        409,
      );
    }

    return tx.quoteVersion.findUnique({
      where: { id: versionId },
      include: {
        scenarios: { include: { stays: true } },
        itineraryDays: { orderBy: { dayOffset: "asc" } },
        serviceLines: true,
      },
    });
  });

  await writeAuditLog("QUOTE_CONTENT_SAVED", actor.id, `Saved content for ${version.request.packageCode} ${versionLabel(version.versionNo)}`);
  return result;
}

// ---------------------------------------------------------------------------
// submit — resolve + calculate + snapshot + PENDING_VALIDATION
// ---------------------------------------------------------------------------

export async function submit(actor: WorkflowActor, requestId: string) {
  const request = await loadRequest(requestId);
  assertOwnerOrAdmin(actor, request.ownerId);

  const version = await loadLatestVersion(requestId);
  if (!version) throw new WorkflowError("VERSION_NOT_FOUND", "request has no versions", 404);
  assertTransition(version.status, ["DRAFT", "CHANGES_REQUESTED"], "submit");
  const resubmission = version.status === "CHANGES_REQUESTED";

  const assignment = await activeAssignment(requestId);
  if (!assignment) {
    throw new WorkflowError("VALIDATOR_NOT_ASSIGNED", "assign a validator before submitting", 400);
  }

  // Engine work happens outside the transaction (pure, no I/O) so the SQLite
  // write lock is only held for the fast writes below.
  const input = await buildEngineInputForVersion(version.id);
  const result = calculate(input);

  // Loaded here (before the transaction) so the day-by-day itinerary freezes
  // into displayJson alongside the other client-facing display data.
  const itineraryDays = await prisma.itineraryDay.findMany({
    where: { versionId: version.id },
    orderBy: { dayOffset: "asc" },
  });
  // Company branding is frozen the same way: editing TravelSettings later must
  // not retroactively restyle an issued document.
  const branding = await getCompanyBranding();

  const inputsJson = canonicalize(input);
  // The engine version is part of the hashed identity so a rule change
  // invalidates prior snapshots (see snapshots.ts).
  const hash = snapshotHash({ engineVersion: input.engineVersion, inputs: input });
  const resultJson = JSON.stringify(result);
  // Freeze client-facing display data with the snapshot: historical documents
  // must not change when the agency/name/dates are edited later.
  const displayJson = JSON.stringify({
    agency: {
      name: request.agency.name,
      shortCode: request.agency.shortCode,
      contactName: request.agency.contactName,
      contactEmail: request.agency.contactEmail,
      contactPhone: request.agency.contactPhone,
    },
    // Frozen so historical documents keep quoting in the currency the price
    // was computed in, even if the active policy changes currency later.
    quoteCurrency: input.fx.quoteCurrency ?? "USD",
    title: request.title,
    startDate: request.startDate,
    endDate: request.endDate,
    agencyRef: request.agencyRef,
    flightDetails: request.flightDetails,
    travelers: request.travelers,
    destinations: request.destinations,
    // Services are stored normalized (DayServiceItem[]) so issued documents
    // are stable even if the normalization rules ever change.
    itineraryDays: itineraryDays.map((day) => ({
      dayOffset: day.dayOffset,
      date: day.date,
      narrative: day.narrative,
      overnightCity: day.overnightCity,
      services: normalizeDayServices(day.services),
    })),
    branding,
  });

  try {
    await tx(async (tx) => {
      await tx.calculationSnapshot.upsert({
        where: { versionId: version.id },
        update: { inputsJson, resultJson, displayJson, engineVersion: input.engineVersion, hash, createdById: actor.id },
        create: {
          versionId: version.id,
          inputsJson,
          resultJson,
          displayJson,
          engineVersion: input.engineVersion,
          hash,
          createdById: actor.id,
        },
      });
      // Per-scenario validity is persisted so the UI can show issues without
      // re-running the engine. Submit is allowed with issues visible.
      for (const sc of result.scenarios) {
        await tx.scenario.update({
          where: { id: sc.ref },
          data: { valid: sc.valid, resultJson: JSON.stringify(sc) },
        });
      }
      // Atomic guard: two concurrent submits both pass the read-time status
      // check; only the first may flip the version. A loser rolls back its
      // snapshot upsert and notification rows with the transaction.
      const guard = await tx.quoteVersion.updateMany({
        where: { id: version.id, status: { in: ["DRAFT", "CHANGES_REQUESTED"] } },
        data: { status: "PENDING_VALIDATION", submittedById: actor.id, submittedAt: new Date() },
      });
      if (guard.count === 0) {
        throw new WorkflowError("INVALID_STATE", "version was submitted concurrently", 409);
      }
      await tx.travelRequest.update({
        where: { id: requestId },
        data: { status: "PENDING_VALIDATION" },
      });

      const recipients = await loadUsersById([request.ownerId, assignment.validatorId]);
      await queueWorkflowEvent(tx, {
        requestId,
        versionId: version.id,
        type: resubmission ? "RESUBMITTED" : "SUBMITTED",
        actorId: actor.id,
        payload: buildPayload(request, version.versionNo, resubmission ? "RESUBMITTED" : "SUBMITTED", actor, {
          action: "Validate this quotation",
          dueAt: assignment.dueAt?.toISOString(),
        }),
        recipients,
      });
    });
  } catch (err) {
    // Practically unreachable: scenario refs are fresh cuids per version, so
    // two versions never produce identical canonical inputs. Guard anyway —
    // silently reusing another version's hash would corrupt approval binding.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new WorkflowError("SNAPSHOT_COLLISION", "snapshot hash collides with an existing snapshot", 500);
    }
    throw err;
  }

  await writeAuditLog(
    "QUOTE_SUBMITTED",
    actor.id,
    `${resubmission ? "Resubmitted" : "Submitted"} ${request.packageCode} ${versionLabel(version.versionNo)} (hash ${hash.slice(0, 12)}…)`,
  );
  return { versionId: version.id, hash, result, quoteCurrency: input.fx.quoteCurrency ?? "USD" };
}

// ---------------------------------------------------------------------------
// review — validator decision bound to the exact snapshot hash
// ---------------------------------------------------------------------------

export async function review(
  actor: WorkflowActor,
  versionId: string,
  input: z.infer<typeof reviewSchema>,
) {
  const parsed = reviewSchema.parse(input);
  const version = await loadVersion(versionId);
  const request = version.request;

  assertTransition(version.status, ["PENDING_VALIDATION"], "review");

  // Decision rights belong to the CURRENT active assignment only — a
  // reassigned former validator loses them immediately.
  const assignment = await activeAssignment(request.id);
  if (!assignment || assignment.validatorId !== actor.id) {
    throw new WorkflowError("NOT_ASSIGNED_VALIDATOR", "only the currently assigned validator may review", 403);
  }
  if (version.submittedById && version.submittedById === actor.id) {
    throw new WorkflowError("SELF_APPROVAL", "the validator who submitted a version cannot review it", 403);
  }

  if (!version.snapshot) {
    throw new WorkflowError("SNAPSHOT_MISSING", "version has no calculation snapshot", 409);
  }
  if (parsed.snapshotHash !== version.snapshot.hash) {
    throw new WorkflowError(
      "SNAPSHOT_STALE",
      "snapshot hash mismatch — the version changed since this review was loaded",
      409,
    );
  }

  if ((parsed.action === "REQUEST_CHANGES" || parsed.action === "REJECT") && !parsed.reason?.trim()) {
    throw new WorkflowError("REASON_REQUIRED", `${parsed.action} requires a non-empty reason`, 400);
  }

  if (parsed.action === "APPROVE") {
    const result = JSON.parse(version.snapshot.resultJson) as EngineOutput;
    const blockers = result.issues.filter((i) => i.severity === "BLOCKER");
    if (blockers.length > 0) {
      throw new WorkflowError(
        "ENGINE_INVALID",
        `cannot approve: ${blockers.length} blocking engine issue(s)`,
        400,
        blockers,
      );
    }
  }

  const nextStatus: QuoteStatus =
    parsed.action === "APPROVE" ? "APPROVED" : parsed.action === "REQUEST_CHANGES" ? "CHANGES_REQUESTED" : "REJECTED";
  const eventType: WorkflowEventType =
    parsed.action === "APPROVE" ? "APPROVED" : parsed.action === "REQUEST_CHANGES" ? "CHANGES_REQUESTED" : "REJECTED";

  await tx(async (tx) => {
    await tx.reviewDecision.create({
      data: {
        versionId,
        snapshotHash: parsed.snapshotHash,
        action: parsed.action,
        reason: parsed.reason ?? null,
        actorId: actor.id,
      },
    });
    // Atomic guard: two concurrent decisions both pass the read-time status
    // check; only the first may flip the version. A loser's ReviewDecision
    // row and notifications roll back with the transaction.
    const guard = await tx.quoteVersion.updateMany({
      where: { id: versionId, status: "PENDING_VALIDATION" },
      data: {
        status: nextStatus,
        decidedById: actor.id,
        decidedAt: new Date(),
        decisionReason: parsed.reason ?? null,
      },
    });
    if (guard.count === 0) {
      throw new WorkflowError("INVALID_STATE", "version was already decided concurrently", 409);
    }
    await tx.travelRequest.update({ where: { id: request.id }, data: { status: nextStatus } });

    // Advisor gets the decision/reason/action; the deciding validator gets a
    // confirmation (spec: both parties are notified on every decision).
    const recipients = await loadUsersById([request.ownerId, assignment.validatorId]);
    await queueWorkflowEvent(tx, {
      requestId: request.id,
      versionId,
      type: eventType,
      actorId: actor.id,
      payload: buildPayload(request, version.versionNo, eventType, actor, {
        action: parsed.action === "REQUEST_CHANGES" ? "Revise and resubmit" : undefined,
        reason: parsed.reason ?? undefined,
      }),
      recipients,
    });
  });

  await writeAuditLog(
    "QUOTE_REVIEWED",
    actor.id,
    `${parsed.action} ${request.packageCode} ${versionLabel(version.versionNo)}${parsed.reason ? `: ${parsed.reason}` : ""}`,
  );
  return { status: nextStatus };
}

// ---------------------------------------------------------------------------
// issue — idempotent CLIENT document + ISSUED status
// ---------------------------------------------------------------------------

/** Identifies the PDF document layout; independent of the notification wording. */
const DOCUMENT_TEMPLATE_VERSION = "1";

/**
 * Renders the PDF for an existing QuoteDocument row and updates
 * filePath/sha256. Failures NEVER reverse the workflow: the document row is
 * marked FAILED:<message> and can be regenerated via retryDocument(). The PDF
 * module (lib/travel/pdf/render.ts) is owned by another agent — a missing or
 * failing module takes the same non-fatal failure path.
 */
async function renderDocumentPdf(documentId: string): Promise<{ ok: boolean; error?: string }> {
  const doc = await prisma.quoteDocument.findUnique({
    where: { id: documentId },
    include: {
      version: { include: { request: { include: { agency: true } }, snapshot: true } },
    },
  });
  if (!doc) throw new WorkflowError("DOCUMENT_NOT_FOUND", `quote document ${documentId} not found`, 404);
  const snapshotRow = doc.version.snapshot;
  if (!snapshotRow) {
    throw new WorkflowError("SNAPSHOT_MISSING", "document version has no snapshot", 409);
  }

  try {
    const { renderQuotationPdf } = await import("@/lib/travel/pdf/render");
    const { version } = doc;
    const { request } = version;
    // Prefer the display data frozen at submit time so regenerating a document
    // (retryDocument) after an agency rename/date edit reproduces the same
    // artifact; live records are only a fallback for pre-freeze snapshots.
    const frozen = snapshotRow.displayJson ? JSON.parse(snapshotRow.displayJson) : null;
    const agency = frozen?.agency ?? {
      name: request.agency.name,
      shortCode: request.agency.shortCode,
      contactName: request.agency.contactName,
      contactEmail: request.agency.contactEmail,
      contactPhone: request.agency.contactPhone,
    };
    // Itinerary days joined displayJson after the first frozen snapshots
    // existed; pre-freeze snapshots fall back to live rows (same pattern as
    // the other display fields above).
    const itineraryDays: QuotationPdfItineraryDay[] =
      frozen?.itineraryDays ??
      (await prisma.itineraryDay.findMany({
        where: { versionId: version.id },
        orderBy: { dayOffset: "asc" },
      })).map((day) => ({
        dayOffset: day.dayOffset,
        date: day.date,
        narrative: day.narrative,
        overnightCity: day.overnightCity,
        services: normalizeDayServices(day.services),
      }));
    // Branding joined displayJson with the PDF redesign; pre-freeze snapshots
    // fall back to the live settings (same pattern as itineraryDays above).
    const branding: QuotationPdfBranding = frozen?.branding ?? (await getCompanyBranding());
    // The renderer consumes parsed snapshot JSON verbatim — it never
    // recomputes prices (see lib/travel/pdf/types.ts).
    const buf = await renderQuotationPdf({
      snapshotHash: doc.snapshotHash,
      versionLabel: versionLabel(version.versionNo),
      packageCode: request.packageCode,
      kind: doc.kind as "CLIENT" | "INTERNAL",
      draft: false,
      agency,
      request: {
        title: frozen?.title ?? request.title,
        startDate: frozen?.startDate ?? request.startDate,
        endDate: frozen?.endDate ?? request.endDate,
        agencyRef: frozen ? frozen.agencyRef : request.agencyRef,
        flightDetails: frozen ? frozen.flightDetails : request.flightDetails,
        travelers: JSON.parse(frozen?.travelers ?? request.travelers),
        destinations: (frozen?.destinations ?? request.destinations)
          ? JSON.parse(frozen?.destinations ?? request.destinations)
          : undefined,
      },
      issuedAt: doc.issuedAt?.toISOString(),
      validUntil: version.validUntil,
      terms: version.terms,
      snapshot: JSON.parse(snapshotRow.resultJson),
      inputs: JSON.parse(snapshotRow.inputsJson),
      itineraryDays,
      branding,
    });
    const settings = await getTravelSettings();
    await mkdir(settings.documentsDir, { recursive: true });
    const filePath = `${settings.documentsDir}/${doc.id}.pdf`;
    await writeFile(filePath, buf);
    const sha256 = createHash("sha256").update(buf).digest("hex");
    await prisma.quoteDocument.update({ where: { id: doc.id }, data: { filePath, sha256 } });
    return { ok: true };
  } catch (err: any) {
    const message = err?.message ?? String(err);
    await prisma.quoteDocument.update({
      where: { id: doc.id },
      data: { filePath: `FAILED:${message}` },
    });
    console.error(`[Travel] PDF render failed for document ${doc.id}: ${message}`);
    return { ok: false, error: message };
  }
}

export async function issue(
  actor: WorkflowActor,
  versionId: string,
  input: z.infer<typeof issueSchema> = {},
) {
  const parsed = issueSchema.parse(input ?? {});
  const version = await loadVersion(versionId);
  const request = version.request;
  assertOwnerOrAdmin(actor, request.ownerId);

  const idempotencyKey = parsed.idempotencyKey ?? `issue-${versionId}`;

  // Idempotent re-issue: a document under this key means the whole transition
  // already committed (document and status change share one transaction).
  // The key is scoped to THIS version: reusing it for another version is a
  // conflict, not a silent idempotent hit on someone else's document.
  const existing = await prisma.quoteDocument.findUnique({ where: { idempotencyKey } });
  if (existing) {
    if (existing.versionId !== versionId) {
      throw new WorkflowError(
        "IDEMPOTENCY_CONFLICT",
        `idempotency key "${idempotencyKey}" is already used by a document of another version`,
        409,
      );
    }
    return { document: existing, idempotent: true };
  }

  assertTransition(version.status, ["APPROVED"], "issue");

  if (!version.snapshot) {
    throw new WorkflowError("SNAPSHOT_MISSING", "version has no calculation snapshot", 409);
  }

  const settings = await getTravelSettings();
  if (settings.requireSettingsForIssue) {
    const policy = await getActivePolicy();
    const fxMap = await getFxMap(request.startDate);
    const quoteCurrency = policy?.quoteCurrency ?? "USD";
    if (!policy || !fxMap[quoteCurrency]) {
      throw new WorkflowError(
        "SETTINGS_INCOMPLETE",
        `issuing requires an active pricing policy and a ${quoteCurrency} FX rate`,
        400,
      );
    }
  }

  // Below-floor: with round-up rounding the engine rarely emits this (see
  // policy.ts), but when a snapshot carries it, issuing needs a manager
  // exception with a recorded reason.
  const result = JSON.parse(version.snapshot.resultJson) as EngineOutput;
  const belowFloor = result.issues.some((i) => i.code === "BELOW_FLOOR");
  if (belowFloor) {
    if (!canGrantFloorException(actor.role)) {
      throw new WorkflowError("FLOOR_EXCEPTION_FORBIDDEN", "below-floor issuing requires a manager (ADMIN)", 403);
    }
    if (!parsed.belowFloorExceptionReason?.trim()) {
      throw new WorkflowError("FLOOR_EXCEPTION_REASON_REQUIRED", "below-floor issuing requires a reason", 400);
    }
  }

  const hashBefore = version.snapshot.hash;

  let documentId: string;
  try {
    documentId = await tx(async (tx) => {
      const snap = await tx.calculationSnapshot.findUnique({ where: { versionId } });
      if (!snap || snap.hash !== hashBefore) {
        throw new WorkflowError("SNAPSHOT_STALE", "snapshot changed during issue", 409);
      }
      // Atomic guard: status flips only if still APPROVED (race-safe).
      const guard = await tx.quoteVersion.updateMany({
        where: { id: versionId, status: "APPROVED" },
        data: { status: "ISSUED" },
      });
      if (guard.count === 0) {
        throw new WorkflowError("INVALID_STATE", "version is no longer APPROVED", 409);
      }
      const doc = await tx.quoteDocument.create({
        data: {
          versionId,
          snapshotHash: hashBefore,
          kind: "CLIENT",
          templateVersion: DOCUMENT_TEMPLATE_VERSION,
          filePath: "PENDING",
          sha256: "",
          idempotencyKey,
          issuedAt: new Date(),
          createdById: actor.id,
        },
      });
      await tx.travelRequest.update({ where: { id: request.id }, data: { status: "ISSUED" } });

      const assignment = await tx.validationAssignment.findFirst({
        where: { requestId: request.id, active: true },
      });
      const recipients = await loadUsersById([request.ownerId, assignment?.validatorId]);
      await queueWorkflowEvent(tx, {
        requestId: request.id,
        versionId,
        type: "ISSUED",
        actorId: actor.id,
        payload: buildPayload(request, version.versionNo, "ISSUED", actor, {
          reason: parsed.belowFloorExceptionReason
            ? `below-floor exception: ${parsed.belowFloorExceptionReason}`
            : undefined,
        }),
        recipients,
      });
      return doc.id;
    });
  } catch (err) {
    // Lost the idempotency race: the winner committed document + status, so
    // returning its document is the correct idempotent outcome.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const doc = await prisma.quoteDocument.findUnique({ where: { idempotencyKey } });
      if (doc && doc.versionId !== versionId) {
        throw new WorkflowError(
          "IDEMPOTENCY_CONFLICT",
          `idempotency key "${idempotencyKey}" is already used by a document of another version`,
          409,
        );
      }
      if (doc) return { document: doc, idempotent: true };
    }
    throw err;
  }

  await writeAuditLog(
    "QUOTE_ISSUED",
    actor.id,
    `Issued ${request.packageCode} ${versionLabel(version.versionNo)} (key ${idempotencyKey})` +
      (belowFloor ? ` — BELOW_FLOOR exception: ${parsed.belowFloorExceptionReason}` : ""),
  );

  // Outside the transaction: PDF rendering is slow and must never hold the
  // write lock or reverse ISSUED on failure.
  await renderDocumentPdf(documentId);

  const document = await prisma.quoteDocument.findUnique({ where: { id: documentId } });
  return { document: document!, idempotent: false };
}

/** Regenerates the PDF for an existing QuoteDocument row (after FAILED). */
export async function retryDocument(actor: WorkflowActor, documentId: string) {
  const doc = await prisma.quoteDocument.findUnique({
    where: { id: documentId },
    include: { version: { include: { request: true } } },
  });
  if (!doc) throw new WorkflowError("DOCUMENT_NOT_FOUND", `quote document ${documentId} not found`, 404);
  assertOwnerOrAdmin(actor, doc.version.request.ownerId);

  const result = await renderDocumentPdf(documentId);
  await writeAuditLog(
    "DOCUMENT_REGENERATED",
    actor.id,
    `Regenerated document ${documentId}: ${result.ok ? "ok" : `failed (${result.error})`}`,
  );
  return prisma.quoteDocument.findUnique({ where: { id: documentId } });
}

// ---------------------------------------------------------------------------
// recordOutcome — ACCEPTED / DECLINED / EXPIRED from ISSUED
// ---------------------------------------------------------------------------

export async function recordOutcome(
  actor: WorkflowActor,
  versionId: string,
  input: z.infer<typeof outcomeSchema>,
) {
  const parsed = outcomeSchema.parse(input);
  const version = await loadVersion(versionId);
  const request = version.request;
  assertOwnerOrAdmin(actor, request.ownerId);
  assertTransition(version.status, ["ISSUED"], "record an outcome on");

  if (parsed.outcome === "ACCEPTED") {
    if (!parsed.scenarioId) {
      throw new WorkflowError("SCENARIO_REQUIRED", "ACCEPTED requires scenarioId", 400);
    }
    const scenario = await prisma.scenario.findFirst({
      where: { id: parsed.scenarioId, versionId },
    });
    if (!scenario) {
      throw new WorkflowError("SCENARIO_NOT_FOUND", `scenario ${parsed.scenarioId} does not belong to this version`, 400);
    }
  }

  await tx(async (tx) => {
    // Atomic guard (same pattern as submit/review/issue): two concurrent
    // outcome records both pass the read-time check; only the first flips.
    const guard = await tx.quoteVersion.updateMany({
      where: { id: versionId, status: "ISSUED" },
      data: {
        status: parsed.outcome,
        outcomeScenarioId: parsed.outcome === "ACCEPTED" ? parsed.scenarioId! : null,
      },
    });
    if (guard.count === 0) {
      throw new WorkflowError("INVALID_STATE", "version is no longer ISSUED — outcome was recorded concurrently", 409);
    }
    await tx.travelRequest.update({ where: { id: request.id }, data: { status: parsed.outcome } });

    const assignment = await tx.validationAssignment.findFirst({
      where: { requestId: request.id, active: true },
    });
    const recipients = await loadUsersById([request.ownerId, assignment?.validatorId]);
    await queueWorkflowEvent(tx, {
      requestId: request.id,
      versionId,
      type: "OUTCOME_RECORDED",
      actorId: actor.id,
      payload: buildPayload(request, version.versionNo, "OUTCOME_RECORDED", actor, {
        reason: `outcome: ${parsed.outcome}`,
      }),
      recipients,
    });
  });

  await writeAuditLog(
    "QUOTE_OUTCOME_RECORDED",
    actor.id,
    `${parsed.outcome} ${request.packageCode} ${versionLabel(version.versionNo)}`,
  );
  return { status: parsed.outcome };
}

// ---------------------------------------------------------------------------
// Validator assignment
// ---------------------------------------------------------------------------

async function assertAssignableValidator(targetId: string): Promise<User> {
  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target || !target.active) {
    throw new WorkflowError("VALIDATOR_INVALID", `user ${targetId} does not exist or is inactive`, 400);
  }
  if (target.role !== ROLE_VALIDATOR && target.role !== ROLE_ADMIN) {
    throw new WorkflowError("VALIDATOR_INVALID", `user ${target.email} has role ${target.role}, not a validator`, 400);
  }
  return target;
}

async function setValidator(
  actor: WorkflowActor,
  requestId: string,
  input: z.infer<typeof assignValidatorSchema>,
  auditAction: string,
) {
  const parsed = assignValidatorSchema.parse(input);
  const request = await loadRequest(requestId);
  const target = await assertAssignableValidator(parsed.validatorId);
  const dueAt = parsed.dueAt ? new Date(parsed.dueAt) : null;

  const previous = await activeAssignment(requestId);

  await tx(async (tx) => {
    // Deactivating the old assignment immediately revokes its decision
    // rights: review() only honors the CURRENT active assignment.
    await tx.validationAssignment.updateMany({
      where: { requestId, active: true },
      data: { active: false, deactivatedAt: new Date() },
    });
    await tx.validationAssignment.create({
      data: {
        requestId,
        validatorId: target.id,
        assignedById: actor.id,
        dueAt,
        active: true,
      },
    });
    await tx.travelRequest.update({
      where: { id: requestId },
      data: { currentValidatorId: target.id },
    });

    // WORKFLOW_EVENT_TYPES has no "ASSIGNED" — a notification event is only
    // emitted when an assignment is REPLACED (REASSIGNED).
    if (previous) {
      const latest = await tx.quoteVersion.findFirst({
        where: { requestId },
        orderBy: { versionNo: "desc" },
      });
      const recipients = await loadUsersById([previous.validatorId, target.id, request.ownerId]);
      await queueWorkflowEvent(tx, {
        requestId,
        versionId: latest?.id ?? null,
        type: "REASSIGNED",
        actorId: actor.id,
        payload: buildPayload(request, latest?.versionNo ?? 1, "REASSIGNED", actor, {
          action: "Validate this quotation",
          dueAt: dueAt?.toISOString(),
        }),
        recipients,
      });
    }
  });

  await writeAuditLog(
    auditAction,
    actor.id,
    `${previous ? "Reassigned" : "Assigned"} ${request.packageCode} to ${target.email}${dueAt ? ` (due ${dueAt.toISOString()})` : ""}`,
  );
  return activeAssignment(requestId);
}

/** ADMIN, or the owner assigning someone else (self-assignment would enable self-approval). */
export async function assignValidator(
  actor: WorkflowActor,
  requestId: string,
  input: z.infer<typeof assignValidatorSchema>,
) {
  const request = await loadRequest(requestId);
  if (actor.role !== ROLE_ADMIN) {
    assertOwnerOrAdmin(actor, request.ownerId);
    if (input.validatorId === actor.id) {
      throw new WorkflowError("SELF_ASSIGNMENT", "the owner cannot assign themselves as validator", 403);
    }
  }
  return setValidator(actor, requestId, input, "VALIDATOR_ASSIGNED");
}

/** ADMIN-only reassignment (manager action, notifies old + new validator). */
export async function reassign(
  actor: WorkflowActor,
  requestId: string,
  input: z.infer<typeof assignValidatorSchema>,
) {
  assertRole(actor, [ROLE_ADMIN]);
  return setValidator(actor, requestId, input, "VALIDATOR_REASSIGNED");
}

// ---------------------------------------------------------------------------
// createRevision — clone content into a new DRAFT version
// ---------------------------------------------------------------------------

const REVISABLE_STATUSES: QuoteStatus[] = ["CHANGES_REQUESTED", "APPROVED", "ISSUED", "REJECTED"];

export async function createRevision(actor: WorkflowActor, requestId: string) {
  const request = await loadRequest(requestId);
  assertOwnerOrAdmin(actor, request.ownerId);

  const latest = await prisma.quoteVersion.findFirst({
    where: { requestId },
    orderBy: { versionNo: "desc" },
    include: {
      scenarios: { include: { stays: true } },
      itineraryDays: true,
      serviceLines: true,
    },
  });
  if (!latest) throw new WorkflowError("VERSION_NOT_FOUND", "request has no versions", 404);
  assertTransition(latest.status, REVISABLE_STATUSES, "revise");

  const newVersion = await tx(async (tx) => {
    const created = await tx.quoteVersion.create({
      data: {
        requestId,
        versionNo: latest.versionNo + 1,
        status: "DRAFT",
        terms: latest.terms,
        validUntil: latest.validUntil,
        templateVersionId: latest.templateVersionId,
      },
    });
    const scenarioIdMap = new Map<string, string>();
    for (const sc of latest.scenarios) {
      const newSc = await tx.scenario.create({
        data: { versionId: created.id, label: sc.label },
      });
      scenarioIdMap.set(sc.id, newSc.id);
      for (const stay of sc.stays) {
        await tx.staySegment.create({
          data: {
            scenarioId: newSc.id,
            hotelProductId: stay.hotelProductId,
            hotelName: stay.hotelName,
            city: stay.city,
            checkIn: stay.checkIn,
            checkOut: stay.checkOut,
            board: stay.board,
            allocations: stay.allocations,
            rateOverrides: stay.rateOverrides,
          },
        });
      }
    }
    for (const day of latest.itineraryDays) {
      await tx.itineraryDay.create({
        data: {
          versionId: created.id,
          dayOffset: day.dayOffset,
          date: day.date,
          narrative: day.narrative,
          overnightCity: day.overnightCity,
          services: day.services,
        },
      });
    }
    for (const line of latest.serviceLines) {
      await tx.serviceLine.create({
        data: {
          versionId: created.id,
          scenarioId: line.scenarioId ? scenarioIdMap.get(line.scenarioId) ?? null : null,
          category: line.category,
          label: line.label,
          basis: line.basis,
          currency: line.currency,
          unitRate: line.unitRate,
          quantity: line.quantity,
          participants: line.participants,
          capacity: line.capacity,
          includedElsewhere: line.includedElsewhere,
          isStaffCost: line.isStaffCost,
          overrideRate: line.overrideRate,
          overrideReason: line.overrideReason,
          overrideById: line.overrideById,
          sourceRef: line.sourceRef,
          // Catalog links survive revisions so day-driven pricing keeps
          // resolving in the new draft.
          serviceProductId: line.serviceProductId,
          date: line.date,
          vehicleTypeId: line.vehicleTypeId,
        },
      });
    }
    // Snapshots are deliberately NOT copied: a new version must be
    // recalculated and re-approved on its own inputs.
    await tx.travelRequest.update({ where: { id: requestId }, data: { status: "DRAFT" } });
    return created;
  });

  await writeAuditLog(
    "QUOTE_REVISION_CREATED",
    actor.id,
    `Created ${versionLabel(newVersion.versionNo)} for ${request.packageCode} from ${versionLabel(latest.versionNo)}`,
  );
  return newVersion;
}
