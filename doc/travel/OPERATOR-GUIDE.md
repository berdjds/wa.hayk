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
3. **Users**: Admin → Users now offers all four roles (ADMIN / USER / ADVISOR / VALIDATOR) and
   a phone field (international format, with or without `+`) used for WhatsApp notifications
   and document delivery. Any active user — regardless of role — can be assigned as a
   validator on a request; assignment is what grants review rights. Missing destinations are
   flagged in Travel → Notifications, not silently skipped.
4. **SMTP**: set `SMTP_HOST/PORT/USER/PASS/FROM` for the email channel; otherwise email
   deliveries show FAILED and can be retried after configuration.
5. **Rates**: verify NEEDS_REVIEW rates (Travel → Catalog → Rates) against supplier agreements
   before relying on them; especially TBC rates, conflicting cottage prices, and the recorded
   restrictions (Grand Hotel Yerevan stop-sale Oct 2026 / quote-on-request May 2026,
   Jermuk July/August limits, Cozy House extra beds — see RECONCILIATION.md).
6. **Vehicle types**: confirm seats/luggage against the actual fleet (defaults are
   placeholders: sedan 3, van 5, minibus 12, bus 48).
7. **Company branding**: Travel → Settings → "Company branding" card sets the company name,
   phone, email, website, address and brand color used on the client quotation PDF cover and
   footer. Branding is frozen into each quotation at submit time, so editing it later never
   restyles already-issued documents.
8. **Validator user group** (v0.11.0): Travel → Settings → "Validator group" is a multi-select
   of users (name, role, phone shown; a warning icon marks members without a phone — set it in
   Admin → Users). On submit, the INTERNAL costing sheet goes individually to the assigned
   validator AND every group member; on issue, the client PDF goes to owner + validator + group.
   The first active group member is auto-assigned as the validator on new requests, so submit
   never blocks on a missing assignment (re-assignable as before). This replaces the old
   validator WhatsApp group id field.
9. **Infant max age** (v0.11.0): Travel → Settings → "Infant max age" (0–12, default 2).
   Children at or below this age at return are counted as infants automatically in the traveler
   editor; the advisor can still override the infant count manually.
10. Docker: mount a volume for `data/documents/` alongside the existing data volume.

## Operator workflow

1. Advisor: Travel → New request (agency, dates, travelers) — the package code
   (`CLIENTSHORT-YYYY-MM-DD-NNNN`) is generated once and never changes. Once both dates are
   picked, an optional **template picker** lists the active template versions matching the trip
   length in nights; choosing one pre-fills the title (still editable) and, on create,
   populates the new request from the template: day-by-day itinerary with catalog-linked
   services (priced automatically) and default hotel scenario(s) with dated stays. Travelers
   are entered booking.com style: −/+ steppers for adults and children, and one "age at
   return" (0–12) dropdown per child; children at or below the infant max age (Settings) count
   as infants automatically, with manual override. The child ages feed room-allocation
   validation; the paying count defaults to 1 and auto-follows adults + children only until
   you override it manually. The same editor appears when editing a request on the Overview tab.
2. Build the itinerary and scenarios on the request page. The **quote summary bar** under the
   page header always shows the current sell price and per-paying-person price per scenario —
   it recalculates automatically after every save (use its Recalculate button to refresh on
   demand). On the Itinerary tab, an empty itinerary is generated automatically from the travel
   dates (one day per date, overnight cities pre-filled from hotel stays) and saved — the
   departure day needs no hotel, so it never raises a "no stay covers this date" warning.
   Day services are shown in two columns — **Tours** and **Tickets & degustations** — each entry
   with a quantity stepper (−/+) and its net cost (`x AMD · y USD`) from the live quote preview;
   other categories stay as plain chips (v0.11.0). Net costs are visible to the request owner,
   validators and admins. Picking a service for a day opens a picker grouped into sections
   (private-vehicle tours, per-seat group tours with their departure weekdays, tickets &
   degustations, meals, guides, staff costs, …) with a search box on top and an indicative
   catalog rate per entry; only private-vehicle tours ask for a vehicle.
   Catalog services are priced automatically from their verified rate on the day's date;
   free-text entries stay unpriced labels.
   Overnight cities auto-fill from the scenario's hotel stays — "Sync
   cities from stays" reapplies that after stay edits. On the Scenarios tab, each stay shows its
   nightly rates and stay total (AMD + quote currency) next to the scenario totals (same
   visibility rule as line costs). Adding a hotel with
   its own dates splits the existing stay (e.g. inserting 3–5 Oct into 1–6 Oct yields 2+2+1
   nights — previewed before saving). Service lines are edited once, in the "Service lines" card
   at the bottom of the Scenarios tab (day-linked catalog services appear as read-only rows —
   manage them on the Itinerary tab); alternative scenarios are never summed together.
3. Assign a validator (or ask an admin), then Submit. Any active user can be assigned —
   including yourself (self-validation is a supported mode for small teams) — and the picker
   lists all of them. When a validator group is configured (Settings), the first active member
   is pre-assigned at creation. A confirmation dialog lists the exact sell
   amounts and any blockers per scenario before the snapshot is bound — blockers do not stop the
   submit, but the validator cannot approve until they are resolved. Submit also renders the
   INTERNAL costing sheet and WhatsApps it to the assigned validator and each validator-group
   member individually when WhatsApp is connected; delivery failures never block the submit.
4. Validator: Travel → Review queue → open the package → Approve / Request changes / Reject
   (reason required). Validators without a travel role land here from their assignment and see
   only the requests they validate. Approvals bind to the exact snapshot; any later edit needs
   a new version and a new review.
5. Advisor: after APPROVED, Issue → generates the client PDF (immutable, hash-recorded) and
   WhatsApps it to owner + validator + group members. Record the outcome (Accepted with the
   chosen scenario / Declined / Expired). Generated documents live at the bottom of the Review
   tab (no separate Documents tab); each rendered document has a "Send via WhatsApp" button for
   manual delivery to picked users (with a phone on file) or WhatsApp groups. INTERNAL
   documents can only go to validators/admins — margins are inside.
6. Both sides receive email + WhatsApp notifications at each step; delivery problems are
   visible under Travel → Notifications (admin can retry or reprocess the queue).

## Template editor (ADMIN, v0.11.0)

Travel → Templates → **Edit** opens the template editor: template name, version selector, day
rows (narrative, overnight city, services with the same catalog picker as the itinerary editor,
including quantity per service), and optional default hotel scenarios per version (hotel or
free-text name, board, check-in offset + nights instead of absolute dates, room allocations).
Saving recomputes the version's nights/days from the content, which is what the new-request
template picker matches against. Changes apply to future instantiations only — existing
requests are never touched. Workbook-imported templates keep label-only day services until an
admin links catalog services here.

## Catalog management (ADMIN)

Catalog data is managed in the UI under Travel → Catalog: create and edit hotels and service
products, and add rate versions per product. Every new rate starts as NEEDS_REVIEW and is
ignored by pricing until an admin verifies it (Rates tab), so adding a rate is always safe;
rates are edited or archived, never deleted.

Transportation tours are priced **per vehicle type**: Sedan and Minivan rates are the catalog
unit prices; Sprinter and Big bus currently carry the same values pending update. To set a
fleet-specific price, open the transportation service in Catalog → Services → Rates and add
(or edit) the rate row for that vehicle (the Vehicle column shows which row applies); when an
advisor pins a transportation service to a day, they pick the vehicle and the matching rate
applies automatically.

### Tickets & degustations pricing model

Most ticket items are **per person**. Two items are priced **per group** and billed in blocks:

- **Chir's House** — 10,000 AMD per group of up to **5** people: 5 pax → 1 × 10,000;
  6 pax → 2 × 10,000; 12 pax → 3 × 10,000.
- **Lavash Baking** — 10,000 AMD per group of up to **10** people: 3/5/8/10 pax → 1 × 10,000;
  12 pax → 2 × 10,000.

In the catalog these use the "CAPACITY BLOCK" basis with a capacity of 5 / 10 (shown as "per
group of up to 5" / "per group of up to 10" in the service pickers). The group size is the
paying traveler count unless a service line overrides participants. Existing databases pick
this up by re-running the catalog seed (`npx tsx scripts/seed-travel-catalog.ts` — idempotent).

## Rollout / rollback

- Rollout is additive: new tables, routes and pages; existing WhatsApp/chat features are
  untouched except two nav buttons and nullable `User.phone`.
- Rollback: remove the additive code; the travel tables can be dropped without affecting
  User/Chat/Message/Log/WhatsAppSession. The dev SQLite DB is recreated with `npm run db:push`.
- Re-running imports/seeds is safe (idempotent keys); failed batches leave existing data intact.
