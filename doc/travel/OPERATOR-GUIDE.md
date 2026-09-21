# Travel module — operator and admin guide

## Run locally

```bash
npm install                 # postinstall runs prisma generate
cp .env.example .env        # fill NEXTAUTH_SECRET etc.
npm run db:push             # apply schema (additive travel tables)
npm run db:seed             # existing admin user
npx tsx scripts/import-workbook.ts        # stage workbook evidence (idempotent)
npx tsx scripts/seed-travel-catalog.ts    # seed catalog + demo advisor/validator
npm run dev                 # custom server on :3000 (Socket.io + WhatsApp + notification worker)
```

Dev users after seeding: `advisor1@wacontrol.local` / `validator1@wacontrol.local`
(password `travel123`, roles ADVISOR/VALIDATOR) plus the existing admin.
Verification: `npx tsc --noEmit`, `npm test` (vitest), `npm run build`.

## Required production configuration (issuance is blocked without it)

1. **Admin → Travel → Catalog → FX & Policy**: add current FX rates (AMD per 1 currency unit)
   and create + activate a pricing policy: type (markup on cost vs true gross margin), rate,
   minimum profit + currency, rounding increment, quote currency. The imported workbook 14%
   is a **legacy markup**, seeded inactive on purpose.
2. **Agencies**: create each client agency with its uppercase short code (required before any
   request can be created for that client; package codes embed it). Managed from
   Travel → Agencies (ADMIN) — list, create, edit, deactivate/reactivate.
3. **Users**: give advisors/validators their roles; set `phone` (international format, no `+`)
   for WhatsApp notifications and ensure email addresses are real. Missing destinations are
   flagged in Travel → Notifications, not silently skipped.
4. **SMTP**: set `SMTP_HOST/PORT/USER/PASS/FROM` for the email channel; otherwise email
   deliveries show FAILED and can be retried after configuration.
5. **Rates**: verify NEEDS_REVIEW rates (Travel → Catalog → Rates) against supplier agreements
   before relying on them; especially TBC rates, conflicting cottage prices, and the recorded
   restrictions (Grand Hotel Yerevan stop-sale Oct 2026 / quote-on-request May 2026,
   Jermuk July/August limits, Cozy House extra beds — see RECONCILIATION.md).
6. **Vehicle types**: confirm seats/luggage against the actual fleet (defaults are
   placeholders: sedan 3, van 5, minibus 12, bus 48).
7. Docker: mount a volume for `data/documents/` alongside the existing data volume.

## Operator workflow

1. Advisor: Travel → New request (agency, dates, travelers) — the package code
   (`CLIENTSHORT-YYYY-MM-DD-NNNN`) is generated once and never changes.
2. Build the itinerary and scenarios on the request page. On the Itinerary tab, generate the
   day-by-day plan from the travel dates, then pick services per day from the catalog (they are
   priced automatically from verified catalog rates) or add free-text entries; overnight cities
   auto-fill from the scenario's hotel stays — "Sync cities from stays" reapplies that after
   stay edits. On the Scenarios tab, adding a hotel with its own dates splits the existing stay
   (e.g. inserting 3–5 Oct into 1–6 Oct yields 2+2+1 nights — previewed before saving). Use
   "Calculate preview" to see per-scenario costs, issues and selling totals; alternative
   scenarios are never summed together.
3. Assign a validator (or ask an admin) and Submit. The advisor cannot validate own work.
4. Validator: Travel → Review queue → open the package → Approve / Request changes / Reject
   (reason required). Approvals bind to the exact snapshot; any later edit needs a new
   version and a new review.
5. Advisor: after APPROVED, Issue → generates the client PDF (immutable, hash-recorded).
   Record the outcome (Accepted with the chosen scenario / Declined / Expired).
6. Both sides receive email + WhatsApp notifications at each step; delivery problems are
   visible under Travel → Notifications (admin can retry or reprocess the queue).

## Catalog management (ADMIN)

Catalog data is managed in the UI under Travel → Catalog: create and edit hotels and service
products, and add rate versions per product. Every new rate starts as NEEDS_REVIEW and is
ignored by pricing until an admin verifies it (Rates tab), so adding a rate is always safe;
rates are edited or archived, never deleted.

## Rollout / rollback

- Rollout is additive: new tables, routes and pages; existing WhatsApp/chat features are
  untouched except two nav buttons and nullable `User.phone`.
- Rollback: remove the additive code; the travel tables can be dropped without affecting
  User/Chat/Message/Log/WhatsAppSession. The dev SQLite DB is recreated with `npm run db:push`.
- Re-running imports/seeds is safe (idempotent keys); failed batches leave existing data intact.
