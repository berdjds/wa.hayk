# B2B Travel module — implementation and decision record

Implemented 2026-09-21 against `Kimi-Master-Prompt.md` and `WAControl-B2B-Module-Plan.md`.
Workbook evidence: `Workbook-Evidence.json` / `Formula-inventory.json` (static extraction; the
original `Tour Calculator v12.xlsm` was **not available** in this repository — agreement-image
rate reconciliation remains unverified, see RECONCILIATION.md).

## What was built

A versioned B2B travel package costing and quotation module inside WAControl:

- `lib/travel/contracts.ts` — frozen shared contract (money as decimal strings, ISO calendar
  dates, statuses, issue codes, engine DTOs, notification payload).
- `lib/travel/engine/` — pure deterministic calculation engine (decimal.js; no I/O, no clock,
  no DB): dates/nights, hotel nightly rate expansion with priority/ambiguity, occupancy and
  extra-bed rules, whole-unit cottages, 11 pricing bases, vehicle capacity, FX conversion
  (`fx[c] = AMD per 1 unit`), markup/margin/min-profit/fee policies, single round-up stage,
  per-scenario independence, structured issues + full trace.
- `lib/travel/snapshots.ts` — canonical JSON + sha256 snapshot hashing.
- `lib/travel/codes.ts` — transactional `CLIENTSHORT-YYYY-MM-DD-NNNN` package codes
  (PackageCodeCounter upsert, never count+1, min 4-digit padding, company-timezone date).
- `lib/travel/settings.ts` — TravelSettings singleton, active policy, effective-dated FX map.
- `lib/travel/import.ts` + `scripts/import-workbook.ts` — workbook evidence → staging
  (ImportBatch/ImportRow, idempotent, provenance per sheet!cell).
- `scripts/seed-travel-catalog.ts` — idempotent catalog seed (34 hotels, 95 services,
  13 templates, 237 rate versions, 4 vehicle types, Georgia USD PAX bands; TBC/conflicted
  rates staged as NEEDS_REVIEW).
- `lib/travel/resolve.ts` — DB → engine DTO resolution (VERIFIED rates only, overrides with
  reason/actor, stop-sale/quote-on-request enforcement, FX as of travel start, active policy).
- `lib/travel/workflow.ts` — DRAFT → PENDING_VALIDATION → APPROVED → ISSUED (+CHANGES_REQUESTED,
  REJECTED, ACCEPTED/DECLINED/EXPIRED, CANCELLED); assigned-validator-only decisions, no
  self-approval, hash-bound approvals, transactional issue with idempotency, revisions.
- `lib/travel/notifications.ts` + `lib/email.ts` — transactional outbox (WorkflowEvent +
  per-recipient/channel NotificationDelivery, dedup keys), async worker (wired in `server.ts`),
  email via SMTP (nodemailer) and WhatsApp via existing `sendWhatsAppMessage`; missing
  destinations flagged SKIPPED_NO_DESTINATION; overdue-validation sweep with escalation.
- `lib/travel/pdf/` — client quotation and internal costing HTML→PDF via a dedicated puppeteer
  browser (draft watermark, Unicode fonts, repeated table headers, page numbers; CLIENT docs
  contain no costs/margins/supplier refs).
- `app/api/travel/**` — requests, versions, submit/review/issue/outcome, agencies, catalog,
  rates verification, templates + instantiate, batch pricing, settings/policies/FX, imports,
  documents (authorized download), notifications (list/retry/process).
- `app/travel/**` + `components/travel/**` — requests workspace, review queue, templates,
  catalog/settings, notifications UI; nav buttons in both existing dashboards.
- `tests/` — vitest suites: engine, travel-db, workflow, pdf (see "Verification").

## Reuse of existing WAControl features

- NextAuth credentials + JWT roles (`User.role` extended with ADVISOR/VALIDATOR; ADMIN is
  also the manager for floor exceptions and settings).
- `writeAuditLog()` for all mutations (UPPER_SNAKE actions), `lib/prisma.ts` singleton,
  zod body validation and `{ error }` response conventions in every new route.
- Existing WhatsApp client (`sendWhatsAppMessage`) reused for the WhatsApp notification
  channel; Socket.io (`__waControlState.io`) emits `travel_notification` for live UI updates.
- Puppeteer/Chromium already shipped for WhatsApp is reused for PDF rendering (separate
  browser instance, honors `PUPPETEER_EXECUTABLE_PATH` — no new system dependency in Docker).
- UI conventions: Card/Tabs/Dialog/Toast, axios client fetching, light shadcn theme.

## Decisions and assumptions (reversible, recorded per the master prompt)

1. **Single organization.** WAControl has no tenancy; org scope = the deployment. All travel
   records are scoped by role, not tenant.
2. **Agency model added.** No client/agency records existed; `Agency` (with admin-maintained
   uppercase `shortCode`) is module-owned and does not affect WhatsApp `Chat` records.
3. **Money = decimal strings.** SQLite has no decimal type; decimal.js is the arithmetic
   authority. Client code never recomputes totals.
4. **Package code date/sequence defaults** (user specified components, not reset rules):
   date = request creation day in company timezone (`TravelSettings.companyTz`, default
   `Asia/Yerevan`); sequence resets per agency per creation day; minimum 4-digit padding,
   grows naturally; generated once, immutable.
5. **Roles.** `ADMIN` doubles as validator-eligible manager; only ADMIN may grant below-floor
   exceptions, manage settings/rates/agencies, and reassign validators. `USER` has no travel
   access (401 at API, redirect at pages).
6. **Approval blocks on engine blockers.** A version with BLOCKER issues (missing rates, FX,
   occupancy, capacity, stop-sale, below floor without exception) cannot be approved;
   warnings (e.g. unused beds) do not block.
7. **Issue-time settings gate.** With `TravelSettings.requireSettingsForIssue` (default true),
   issuance requires an active pricing policy and a quote-currency FX rate. The seeded policy
   ("Legacy workbook markup 14%") is intentionally **inactive** and has **no minProfit** —
   production settings are an explicit admin task.
8. **Notification merging.** The planned NotificationOutbox + NotificationDelivery pair is
   implemented as WorkflowEvent + NotificationDelivery (one row per event+recipient+channel,
   `dedupKey` unique) — same semantics, fewer tables.
9. **Documents on local disk** under `TravelSettings.documentsDir` (`data/documents/`, Docker
   volume candidate), never under `public/uploads/` (which is publicly reachable). Downloads
   stream through an authorized API route; INTERNAL documents are ADMIN/VALIDATOR only.
10. **Vehicle checks at engine level only** — service resolution does not yet attach a vehicle
    assignment to versions (documented gap; engine validates `vehicleChecks` when provided).
11. **Rate seasons stay textual** for imported catalog rates: free-text seasonal notes are
    stored on the rate/hotel but not parsed into validity windows; ambiguous cottage pricing
    (Elegant, Mariot differing SGL/DBL/TPL columns) is staged NEEDS_REVIEW, not activated.
12. **New dependencies** (sanctioned by the master prompt's test/email requirements):
    decimal.js, nodemailer@^7 (pinned for next-auth optional peer), vitest. No other upgrades.
13. **Email is greenfield**: SMTP_* env vars; when unconfigured, email deliveries are flagged
    FAILED (visible, retryable) — never silently "sent".
14. **Tests do not contact real recipients**: email/WhatsApp/PDF senders are mocked in
    workflow tests; the PDF smoke test uses local Chromium/Chrome only.
15. **Snapshot hash input** = sha256 of canonical `{ engineVersion, inputs }`; review decisions
    and issuance bind to it; issuance re-verifies inside the transaction with an atomic
    status guard (`updateMany` on status) so a concurrent edit cannot slip under an approval.
    Client-facing display data (agency name/contacts, title, dates, travelers) is frozen at
    submit into `CalculationSnapshot.displayJson` (not hashed — it is not pricing-relevant);
    document regeneration uses the frozen copy so issued artifacts are reproducible.
16. **Concurrency hardening**: submit/review/issue use in-transaction atomic status guards
    (double-submit/double-review losers get 409); `createRequest` retries SQLite lock-race
    failures (P1008/P2028) — code generation stays atomic per attempt, so retries leave only
    harmless sequence gaps.

## Known limitations

- **Split groups (parallel hotels on the same night) are blocked** in v1: any two stays covering
  one night raise `NIGHT_OVERLAP`. The spec allows parallel hotels with disjoint traveler
  allocations, but the current contract has no per-stay traveler subsets to prove disjointness,
  so the conservative block is deliberate until per-stay allocation is modeled.
- The original xlsm is absent: agreement-image rates (67 images) were not re-verified;
  conflicting/ambiguous rates are staged as NEEDS_REVIEW with evidence anchors.
- `RateVersion.weekdays`/`minStay` are stored but not yet enforced during resolution
  (weekday departures validated for shared tours only via product metadata display).
- Template instantiation copies itinerary days; service pricing lines are assembled by the
  advisor (template service refs are workbook provenance, not catalog ids).
- Batch pricing prices stays + template structure per PAX band; it does not reproduce the
  workbook's broken Mass Calculation totals (intentionally).
- WhatsApp notifications require the linked session to be `ready`; failures are visible and
  retryable, and never block or reverse workflow transitions.
