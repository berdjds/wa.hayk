# B2B travel costing and quotations: WAControl module plan

Prepared 21 September 2026. Scope: add a module to the user's existing WAControl application. This is an implementation specification, not a replacement application or a claim that the repository has been inspected.

## 1. Recommendation

Build a versioned quotation module around one deterministic, server-authoritative calculation engine. Reuse WAControl's existing agency/client records, authentication, permissions, navigation, database access, document storage and deployment conventions wherever they exist. Keep the Excel workbook as migration evidence. Import useful catalog data and itinerary templates, but do not reproduce its broken references, incomplete comparison totals or ambiguous units.

The supplied screenshot shows `app`, `components`, `hooks`, `lib`, `prisma`, `types`, Next.js configuration, TypeScript files and Docker/deployment files. These suggest Next.js, TypeScript and Prisma, but versions, database provider, authentication, tenancy, live features and deployment topology remain unverified. Kimi must inspect the actual repository before selecting concrete implementation paths. The screenshot also shows modified files; preserve existing uncommitted work.

## 2. Evidence and inspection boundaries

The requested `/mnt/data/Tour Calculator v12.xlsm` was recovered through its attachment in the referenced conversation. Its local attachment copy was inspected without saving changes or executing macros.

- Filename: `Tour Calculator v12.xlsm`; size: 10,390,648 bytes.
- SHA-256: `02cf436b72a7698a8e45b5bab4195d1023d162bbbe45d40b3df248a3fa4483f8`.
- Inspected workbook XML, all populated cells, expanded shared formulas, defined names, validations, protection, calculation settings, embedded VBA source and the embedded agreement-image inventory.
- 5 worksheets, 2,277 formula cells, 18 defined-name entries, 67 agreement images.
- VBA was statically extracted. Native Excel recalculation and interactive button behavior were not run. Cached values are identified as cached, not freshly calculated proof.
- All 67 agreement images were inventoried, visually surveyed and processed with text recognition. Important examples were checked against readable originals; OCR text is not a fully verified, ready-to-import contract dataset. Armenian text and ambiguous rate tables require human verification before activation.
- No external-link, connection, query, structured-table or pivot parts appeared in the inspected package inventory. This does not remove the broken local `#REF!` formulas and names.
- The workbook requests full recalculation on load; no explicit iterative-calculation configuration was found.

### Worksheet inventory

| Worksheet | State | Stored used range | Populated cells | Formula cells | Purpose |
|---|---|---|---:|---:|---|
| How to Use | Visible | A1:D32 | 28 | 0 | Instructions and reset guidance |
| 4+1 Ani Central Inn | Hidden | A1:Z1000 | 620 | 89 | Older worked costing example, with per-person allocation |
| Hotels and Agreements | Visible | A1:OH126 | 71 | 0 | Wide gallery of supplier agreements and correspondence; 67 images |
| Tour Calculator | Visible | A1:Z217 | 1,069 | 340 | Current catalog, quantity inputs, cost summary and hotel comparison |
| Mass Calculation | Visible | A1:AB167 | 2,522 | 1,848 | Package templates and 2/4/6-PAX pricing grids |

The agreement, calculator and mass-calculation sheets have sheet protection. The reset code unprotects and reprotects without a password. Spreadsheet protection is not a substitute for application authorization.

### Named ranges and validations

There are nine distinct `Google_Sheet_Link_<number>` names, each present at workbook scope and local scope for `Tour Calculator`: 18 entries, all hidden and all referring to `#REF!`. Suffixes are 1050968339, 1159501534, 1378156378, 1533961141, 1755038960, 2014937067, 58523416, 754675765 and 865546236. They do not provide usable business keys.

The hidden sheet has two list validations with broken `#REF!` sources. `Tour Calculator!K81` offers only 3–7 nights; room, PAX and quantity inputs use a 0–40 list. The hotel comparison uses `B5:B46` as its selection source. These lists do not enforce room occupancy, itinerary coverage, participant eligibility, vehicle capacity or seasonal rate validity.

## 3. Actual workbook behavior

### 3.1 Accommodation and agreements

`Tour Calculator!B5:M38` contains 34 named hotel/product rows, with another eight empty slots through row 46. Hotel rooms and cottages are sometimes separate products. Rates in C:F represent SGL, DBL, TPL and extra bed; G:J represent entered nights or room-nights. The calculation multiplies each rate by its corresponding quantity, with no separate room-count multiplier:

`K5 = IFERROR(IF(G5>0,C5*G5,0)+IF(H5>0,D5*H5,0)+IF(I5>0,E5*I5,0)+IF(J5>0,F5*J5,0),"Check the room price")`

Therefore, two double rooms for three nights require six double room-nights in H, despite the abbreviated “DBL Nts” header. `K47=SUM(K5:K46)` adds the accommodation rows. A text error such as “Check the room price” can be ignored by SUM, producing an understated numeric total. Blank prices multiplied by positive quantities can also behave as zero. Missing rates must instead invalidate a selected scenario.

Seasonality is mostly free text in L:M, not executable logic. Examples include `L19` with split 2026 dates, `L27` with weekend conditions and `L33` with Friday/Saturday/Sunday rates. `M27` describes a two-room cottage for up to five PAX. `M37` says full board and `M38` says three meals daily. These require real product categories, occupancy limits, meal entitlements and nightly rate rules.

Some prices are arithmetic expressions, not supplier lookup links: F8 is `5000+10000`, E15 is `62250+8000`, E34 is `150000-15000`. Store the resulting amount plus source evidence and any adjustment rationale; do not assume a formula establishes the supplier's commercial meaning.

Several rates contain `TBC`. Selected unknown rates must remain unresolved. Unused room types with unknown rates must not invalidate an otherwise complete scenario.

The agreement gallery adds rules beyond the flattened catalog. Examples by image anchor in `Hotels and Agreements`:

| Evidence | Implication |
|---|---|
| M2/M40: Royal Plaza seasonal rates and individual/group cancellation terms | Separate rate seasons and cancellation policies; avoid one generic hotel rule |
| AK2/AK55: 14th Floor room categories, extra-bed restriction and child policy | Extra bed is a supplement to an eligible room, not an independent room |
| CS2/CS48: Ramada high/mid/low seasons, child and extra-bed rules | Resolve by service night and occupancy; retain source terms |
| FM2: Ani Central Inn rate sheet contains conflicting year wording | Import as needing confirmation rather than silently assuming a year |
| IS2: Teghenis weekday/weekend rates and cottage capacities | Whole-cottage prices must not be multiplied as if each bedroom were a separately charged room |
| KO2: 8*8 special weekday/weekend rates; heading refers to 2025 | Do not automatically activate these as 2026 rates |
| LM2: Ani Forest Hills BB/HB/FB alternatives and child terms | Board basis changes the rate and meal coverage |
| MW2/MW50: Grand Resort Jermuk monthly package rates and inclusions | Medical/meal package and commission-inclusive wording need explicit interpretation |
| EN2/EN45: DoubleTree occupancy-dependent room prices, child/extra-bed and early/late policies | Single/double occupancy is distinct from physical room category |
| NK2: Yerani group-tour schedule/rates | Shared departure services need weekday and included-service rules |

There are apparent catalog/agreement mismatches worth supplier review, not automatic correction. For example, the Opera Suite catalog has DBL 67,500 AMD at D11, while the visible agreement at BU2 lists several different room categories and prices; the selected product is not identified. Best Western catalog naming should also be reconciled with the Congress-branded agreement at CG2. Jermuk's flattened rates omit the full monthly matrix. A full import must map each price to category, occupancy, board basis, validity and source.

Additional material conflicts and restrictions found in the embedded agreements:

- **Cozy House:** F36 offers an extra bed at 10,000 AMD, but the supplier email anchored at LY89 explicitly says extra beds are not provided. One child under four and a requested cot are separate provisions. Do not activate this supplement without supplier reconciliation.
- **Grand Hotel Yerevan:** L22 says May–October, but the email at GW40 says October 2026 is closed for sales and May 2026 requires a written price offer rather than the standard TA rate. These are statements in the stored supplier correspondence, not a live availability check. Implement stop-sale dates and quote-on-request status before normal seasonal rate selection.
- **Dilijan hotel identity:** the agreement/policy images at LA2 and LA62 sit under a Best Western-labelled gallery column, while the policy footer identifies Paradise Hotel. Hotel identity and rate ownership must be resolved before import.
- **Teghenis:** correspondence at IS59 says cottages exclude breakfast, while room bookings include it; the table at IS2 defines weekends as Friday/Saturday. This differs from 8*8's Friday/Saturday/Sunday weekend definition. Weekend calendars belong to each rate contract.
- **Grand Resort Jermuk:** correspondence at MW69 says no one-night bookings and no group bookings in July/August, and distinguishes a commissionable medical package from a non-commissionable breakfast package. A numeric room price alone is insufficient.
- **Radisson:** the agreement at IG2 separates extra bed 10,000 AMD from the third person's breakfast 9,000 AMD, while the catalog retains only one extra-bed amount. Included breakfast must be defined per occupant, not simply per hotel.
- **Paris:** the agreement at DQ2 includes close-out dates and special date bands. Some contractual ranges overlap at boundaries; import must not guess inclusive/exclusive semantics.

Supplier restrictions and named-event references above are reported solely as workbook evidence. Their present validity requires supplier confirmation. The implementation must store evidence dates and allow new verified agreement versions to supersede earlier ones without rewriting historical quotes.

### 3.2 Dates, rooms and PAX

The settings panel contains client, date, PAX, currency, FX and percentage labels at I51:K56. The inspected client/date/PAX inputs are blank. `K54=USD`, `K55=365`, `K56=14%`.

Group setup uses `K81="5 Nights / 6 Days"`, K82=1 SGL, K83=0 DBL, K84=1 TPL, K85=0 extra beds. K88:K91 multiply room counts by `LEFT(K81,1)`. This assumes single-digit durations and is unrelated to actual start/end dates. L88 counts nominal occupancy as `SGL + 2*DBL + 3*TPL + extra beds`, returning four. It does not reconcile to the separate K53 PAX input or validate hotel-specific capacity.

Despite the note at I92, G5:J46 do not contain formulas linking them to K88:K91 in this file, and the extracted VBA contains no autofill procedure. The comparison grid uses room-night totals directly. Thus “auto-fill the accommodation table” is not established by the inspected implementation.

### 3.3 Transport, activities and operating costs

Current non-hotel rows calculate `unit price × entered quantity`, with category subtotals:

| Category | Rows | Subtotal | Interpretation and migration need |
|---|---|---|---|
| Transportation | 52:89 | E90 | Private transfers/tours and shared group tours coexist; basis must become explicit |
| Tickets/degustations | 94:114 | E115 | Usually per person; Lavash is group-priced in mass templates |
| Extra services | 119:128 | E129 | Jeep 1–3 PAX, boat 1–25 PAX, concert and masterclass need capacity/basis rules |
| Guest meals | 133:152 | E153 | Person-meals; row 149 is labelled guide/driver lunch inside guest meals and needs reclassification |
| Guide/local guide | 157:176 | E177 | Language, half/full day, transfer and local-guide variants |
| Guide/driver accommodation | 181:185 | E186 | Staff room-nights, separate from paying guest accommodation |
| Guide/driver meals | 190:194 | E195 | Staff person-meals |
| Tour leader costs | 199:203 | E204 | Tickets, meals and rooms for non-paying leader where applicable |

Examples: C52 arrival 10,000 AMD; C53 arrival plus city tour 35,000; C57 Sevan/Tsaghkadzor/Dilijan 45,000; C58 Garni/Geghard 30,000; C74 cross-border transfer 120,000. These are workbook values, not verified current supplier quotes. No current vehicle-type price matrix identifies which vehicle they buy.

Shared group tours C69:C72 are 10,900/13,900/12,900/16,900 AMD with weekday notes in F69:F72. In mass templates these charges scale per PAX. A common itinerary description cannot imply that every mentioned ticket, meal or cable car is included. Store explicit included components, options and departures.

Lavash baking C96 is 10,000 AMD; mass E5:G5 charge the same group amount at 2/4/6 PAX, whereas Garni E3:G3 scales with PAX. Jeep C119 is 20,000 per selected unit, boat C120 is 40,000, but capacity is only embedded in names. The new engine must make both unit basis and capacity explicit.

Guide examples: English half/full day C157:C158 are 20,000/30,000, arrival guiding C163 is 10,000; local museum guides are separate. Guide/driver overnight C181:C182 is 10,000 each, and meals C190:C193 are 2,500 each. Quantity units must be explicit so staff-days do not get multiplied by traveler PAX.

The hidden historical sheet documents sedan 1–2, van/Viano 3–5, Sprinter 6–12, Iveco 13–18 and big bus 18–48 at B3:B7. The boundary at 18 overlaps. These are historical labels, not validated capacities or current price bands. Its transport, guide and other sections use two parallel `rate × days/km × quantity` terms. Preserve support for per-trip, per-day and per-km pricing, but configure actual passenger seats and luggage limits per vehicle.

### 3.4 Totals, FX and the meaning of margin

`Tour Calculator!K59:K67` pulls all nine category totals; K68 sums them in AMD. Pricing is:

1. `K72 = ROUNDUP(K68/K55,0)` — converts AMD to USD, then rounds the cost up.
2. `K73 = ROUNDUP(K72*K56,0)` — adds a percentage of rounded cost.
3. `K74 = K72+K73` — final group selling price.

This is **markup on cost**, despite the “Margin %” label and How to Use!B30 saying it applies to final price. At 14% markup, unrounded gross margin is 14/114 ≈ 12.2807%. At cost 1,000 USD, 14% markup sells for 1,140; 14% gross margin sells for 1,162.790697… . This is a business decision that must be made explicit in the application, with imported percentages labelled legacy markup.

FX direction is **365 AMD per 1 USD**. The currency label is not a currency-conversion engine; the final labels/formulas assume USD. No minimum-profit threshold is implemented in the current calculator. “Net Profit” does not establish accounting net profit after all business expenses or taxes.

The hidden sheet has different historical pricing: C93=4 PAX, C94=380 numeric FX despite the “Currency” label, C95=USD despite the “Exchange rate” label, I93=40 fixed profit per person, and bank-fee/commission inputs. D97 combines per-person cost/FX, fixed profit, bank-fee allocation and a commission expression that adds PAX to a monetary quantity. This is dimensionally suspicious. D99 also uses I94 although a separate TPL-profit label exists. Do not promote these expressions to new policy without reconciliation.

### 3.5 Hotel comparisons

I96:Z104 contains nine alternative hotels. L:O multiply selected hotel rates by the common room-night totals; P totals accommodation. Q/R/S/T add transport/tickets/extras/guides. U totals **only those five categories**.

Guest meals, guide/driver accommodation, guide/driver meals and tour-leader costs (K63 and K65:K67) are omitted from every comparison. This makes the comparison systematically incomplete when any of those costs is selected.

The cached Cascade example has 1 SGL + 1 TPL for 5 nights: `24,000×5 + 38,000×5 = 310,000 AMD`. At FX 365, the workbook rounds to 850 USD, adds ceil(850×14%)=119, and quotes 969 USD. The main input quantities are blank, so K74 remains zero while the comparison shows prices. These are separate calculation paths, not one reconciled quote.

Some comparisons evaluate unknown room rates even at zero room quantity, yielding “Calculate Manually.” Z98 can then produce “USD Calculate Manually.” The application must use typed valid/invalid results, never mix error text into currency fields.

### 3.6 Bulk packages and template catalog

Mass Calculation contains 527 formulas with literal `#REF!`, and 1,829 cached error cells out of 1,848 formulas. All 18 defined-name entries are also broken. Do not use its cached prices as acceptance targets.

| Template code | Name | Nights/days | Source row | Legacy markup |
|---|---|---|---:|---:|
| ARM-S26-0304A | Armenia Classic Discovery | 3/4 | 2 | 15% |
| ARM-S26-0405A | Armenia Standard | 4/5 | 13 | 14% |
| ARM-S26-0405B | Armenia Adventure · Khor Virap & Jermuk | 4/5 | 24 | 14% |
| ARM-S26-0506A | Armenia Grand Tour · Jermuk Edition | 5/6 | 35 | 14% |
| ARM-S26-0506B | Armenia Leisure · Free Day Edition | 5/6 | 46 | 14% |
| ARM-S26-0607A | Armenia Comprehensive | 6/7 | 57 | 14% |
| ARM-S26-0708A | Armenia Full Experience | 7/8 | 68 | 14% |
| ARMG-S26-0304A | Armenia Classic Discovery | 3/4, duration at C88 | 87 | 18% |
| ARMG-S26-0405A | Armenia Standard | 4/5 | 98 | 17% |
| ARMGG-S26-0506A | Armenia Grand Tour · Jermuk Edition | 5/6 | 109 | 16% |
| ARMG-S26-0506B | Armenia Grand Tour · Jermuk Edition | 5/6 | 120 | 16% |
| GEO-S26-0405A | Georgia Discovery | 4/5 from five itinerary days and supplier product | 136 | 15% |
| COM-S26-0607A | Caucasus Combined · Georgia & Armenia | 6/7 | 147 | 14% |

Preserve source IDs exactly, including the double G in ARMGG, until an administrator approves a correction/alias. The two group templates labelled Jermuk do not contain Jermuk in their inspected itineraries; titles require review. Preserve itinerary day text separately from selected services and overnight cities. A Jermuk excursion does not automatically imply a Jermuk hotel night.

The private grids assume DBL occupancy: one/two/three rooms for 2/4/6 travelers, tickets proportional to PAX, shared activities once, and transport held constant across the three PAX columns. That transport assumption is unsafe without a vehicle rule. Some hotel VLOOKUPs omit the final match argument; exact matching cannot be assumed.

Further confirmed formula defects:

- Georgia O136 and P136 use E136 (the 2-PAX per-person rate) times 4 and 6 instead of the corresponding F/G rates. The same pattern appears in rows 137:138.
- Combined J147:L154 use the same single hotel-room factor for all three PAX columns, unlike the private templates' 1/2/3 room factors.
- Spare U formulas in some blocks reference Q values and, in the group block, an earlier block's percentage. They are not the primary final-price path but show copying drift.

`Tour Calculator!B208:E216` contains Georgia USD-per-person supplier packages for PAX 2/4/6, separate from AMD items. For example, the four-night Vista product is 292/216/165 USD per person. A group of four should use `216×4=864 USD` before the configured selling policy, not `292×4=1,168`. D215=331 exceeds C215=327 for the four-star offer; flag for supplier confirmation rather than assuming monotonic pricing.

### 3.7 VBA

Six VBA class modules were extracted: ThisWorkbook, Sheet1, Sheet2, Sheet6, Sheet4 and Sheet5. Only Sheet5 contains executable source: `Sub ResetForm()`.

It targets `ThisWorkbook.Sheets("Tour Calculator")`, asks for confirmation, disables screen updating, unprotects the sheet, clears non-formula quantity cells in eight service blocks plus G5:J46, clears J51:K52 and K53, reprotects, and restores screen updating.

It **does not reset** FX, currency, percentage, duration, room counts, hotel comparisons or modified catalog prices. It always targets the original sheet even if an operator duplicates a calculator sheet, contrary to the guide's copy-sheet workflow. There is no error handler to restore state if a runtime error occurs. No quote persistence, PDF export, approval, automatic hotel allocation or pricing macro was present in the extracted source. Static review does not prove runtime behavior or constitute a malware audit.

## 4. Improved operator workflow

Add a “Travel packages” area within WAControl, using the existing navigation and visual components. Recommended views: Requests, Templates, Supplier rates, Review queue and Settings, subject to existing permissions.

1. **Create request.** Select the existing agency and contact, capture agency reference, responsible salesperson, title, destinations, travel start/end dates, travelers, room preferences, flight/transfer details, quotation deadline, currency and notes. Generate a durable request ID immediately.
2. **Build itinerary.** Start from a versioned template or blank plan. Dates derive from start date; each day has narrative, visits, overnight city, services and inclusions. Allow itinerary edits without silently selecting every mentioned paid attraction.
3. **Price services.** Attach transfers/tours, vehicle selections, activities, meals, guides, staff and other costs to dates. Default eligible participants from the request but show exclusions, free places and manual quantity changes.
4. **Create hotel scenarios.** Begin with one full-stay hotel segment. Duplicate a scenario to compare alternatives. Add a new destination/hotel by specifying its check-in and check-out or “from this date to tour end”; preview how the existing segment splits.
5. **Validate and calculate.** Show costs by category, missing rates, occupancy, vehicle shortfalls, itinerary/date conflicts, selected policy, FX, profit floor and final prices. Changes autosave drafts with conflict detection.
6. **Submit to validator.** The travel advisor submits to an assigned validator. Freeze a candidate version and calculation snapshot. The validator sees cost detail, overrides, source rates and differences from prior version, then requests changes, rejects or approves the exact snapshot. A quotation cannot be issued before this approval.
7. **Issue quotation.** Generate a client-facing PDF from the approved snapshot. Record document hash and issue metadata. Downloading/generating a PDF is separate from sending it externally. Revisions produce new version numbers and supersede earlier offers without deleting them.
8. **Track outcome.** Draft, under review, changes requested, approved, issued, accepted, declined, expired, cancelled/superseded. Acceptance identifies exactly one offered scenario and issued version; supplier bookings are separate from quotation status.

Display an always-visible summary: dates/days/nights, travelers, room allocation, selected scenario, total cost, selling price and issues. Keep internal costing restricted to staff. A client must not receive margins, supplier rates or internal notes through PDFs, previews or APIs.

### Advisor and validator workflow with notifications

The travel advisor initiates and owns the request, prepares the package and submits it to the assigned validator. The validator is a distinct authorized user, potentially mapped to an existing manager role. The advisor cannot validate their own request. After approval, the advisor may issue the approved quotation if their role permits it; approval does not automatically send a quotation to the client. Changes to approved content require resubmission and a new approval.

Use `DRAFT → PENDING_VALIDATION → APPROVED → ISSUED`, with `CHANGES_REQUESTED → revised draft → PENDING_VALIDATION` and a separate `REJECTED` outcome. Require a reason for returned/rejected requests and record reassignment, withdrawal, resubmission and every decision. A rejected version remains historical; continuing work creates a new candidate. Only the assigned validator or an authorized reassigned validator can decide. Capture assignment before submission; missing assignment blocks submission. Notify both parties of reassignment and remove the former validator's ability to approve the pending assignment.

Send role-specific notifications through **both email and WhatsApp using WAControl's existing integrations**. Inspect and reuse actual delivery services, sender accounts, templates, queues, contact profiles and delivery callbacks. Do not create a separate messaging system. Notifications accompany committed workflow events:

| Event | Travel advisor receives | Validator receives |
|---|---|---|
| Submitted/resubmitted | Submission confirmation and assigned validator | Action required: validate package, due date and secure link |
| Changes requested | Action required with return reason and secure link | Confirmation that the request was returned |
| Rejected | Decision and reason | Decision confirmation |
| Approved | Ready to issue the approved version | Approval confirmation |
| Issued | Issuance confirmation and version | Confirmation that the approved quotation was issued |
| Reassigned | New validator/owner information as applicable | New assignee receives action; previous assignee receives reassignment notice |
| Validation overdue | Escalation/status notice if configured | Action reminder according to admin-configured timing |
| Notification failure | Visible delivery issue for authorized users | Visible delivery issue for authorized users; route escalation to the configured responsible role |

Every notification includes package code, client/agency short name, quote version, event/status, responsible actor, required action (if any), event time and an authenticated link. Include deadlines and concise reasons where relevant. Keep supplier prices, margins and sensitive traveler details out of notification bodies. Show separate recipient/channel delivery status: queued, sent, delivered if supported, failed, and read only if actually reported. Never equate provider acceptance with delivery or a read receipt with workflow approval.

Persist a transactional outbox event with the workflow transition, then deliver asynchronously. Deduplicate by event ID + recipient + channel; track provider IDs, retries, failure reasons and delivery receipts. Failed delivery must not undo an approval or cause duplicate quotation issuance. Expose failures in the application with a retry action and configured escalation. If a user lacks a verified email/WhatsApp destination, flag it before assignment/submission; do not claim both channels succeeded. Validate stale event reminders against current version/status before sending. Links always require current permissions; approval happens inside the authenticated workflow, not by interpreting a WhatsApp reply.

Suggested internal templates: “Package {packageCode} · {version}: validation required. Submitted by {advisor}. Review by {dueAt}: {link}”; “Package {packageCode} · {version}: changes requested by {validator}. {reason}. Update: {link}”; “Package {packageCode} · {version}: approved by {validator}. Ready to issue: {link}”. Maintain versioned templates in the system. Use provider-required template mechanisms where the current integration requires them. Implement and test with mocks/test recipients; live messaging credentials and recipient setup are deployment configuration, not a reason to send real notifications while developing.

## 5. Core rules and calculation contract

### Dates and accommodation allocation

Use destination-local calendar dates, not elapsed UTC hours, for travel days and hotel nights. `nights=endDate-startDate`, `days=nights+1`. Same-day tours have one day and zero nights. Reject end before start; early arrivals, overnight flights and pre/post nights are explicit extensions.

Hotel intervals are `[checkIn, checkOut)`. Each overnight date for each lodging participant must be covered exactly once, or explicitly marked self-arranged/no accommodation with a reason. Never validate merely by summing nights: equal sums can conceal an overlap and a gap. Split groups may use parallel hotels only with disjoint traveler allocations.

Example: 1–6 October is 6 days/5 nights. Initial Yerevan stay is [1,6). Add Dilijan [3,5): produce Yerevan [1,3), Dilijan [3,5), Yerevan [5,6), giving 2+2+1 nights. Show the proposed dates before saving and preserve separate return segments. On tour-date changes, show affected hotel/service allocations and block issue until reconciled; do not erase priced items silently.

For each night, select an applicable rate by hotel, physical room category, occupancy, board basis, contract, market/agency eligibility, date, weekday and any minimum-stay condition. An explicitly applicable contracted promotion may outrank a seasonal rate, which outranks a base rate; ambiguous equal-priority matches must fail. Snapshot which rule won and why. A season crossing requires nightly pricing, not an average or first-night rate.

Evaluate stop-sale/blackout dates, group eligibility, minimum stay and quote-on-request restrictions before ordinary rate selection. A verified dated supplier offer can provide a permitted exception with evidence; a salesperson's generic manual price must not silently bypass a supplier prohibition. Distinguish price validity from actual booking availability.

`hotelCost = Σnight,roomAllocation (roomCount × roomRate + eligibleExtraBedCount × supplement + applicable supplements)`.

Do not add an extra-bed supplement where a TPL/category rate already includes it. Model cottages/apartments as whole rental units with capacities and bedroom descriptions. Early check-in, late checkout, mandatory dinners and minimum stays are explicit rules or cost lines.

### Travelers and occupancy

Separate adult, child and infant counts, paying travelers, complimentary travelers, tour leaders and operational staff. Child age is calculated for the supplier's defined service/stay date, not today's date; capture ages or dates of birth only as needed. Allow anonymous traveler slots during quotation.

Allocate occupants to rooms or well-defined identical room groups. Check maximum adults/children/total occupants, available beds, extra-bed eligibility, child-sharing rules and cot limits. SGL/DBL/TPL express an occupancy/product choice, not a universal occupancy policy. Capacity exceeding PAX can be intentional (single use of a double); under-allocation is an error, unused beds a clear warning. Extra beds must attach to an eligible parent room. Infants may be free but still need occupancy/seat treatment under supplier rules.

Changing traveler count must recalculate dependent quantities, reveal manual overrides, revalidate every scenario, and never silently replace the requested room arrangement.

### Generic services and vehicles

Every priced line has category, supplier/product/version, date or interval, source currency, rate, basis, selected/eligible participant counts, quantity, inclusion status and provenance. Supported bases: per person, per eligible child/adult band, per group/event, per capacity block, per vehicle/trip, per vehicle/day, per km, per guide/day or half-day, per room/night, per person/meal and fixed package.

Store dimensions separately. `participants × occurrences × perPersonRate`, `vehicles × trips × tripRate`, and `guides × serviceDays × dailyRate` are different formulas. For a capacity-block service, use `ceil(eligiblePAX/blockCapacity) × groupRate × occurrences`, only where the supplier sells repeatable blocks. Do not assume a per-group price has unlimited capacity.

Configure sedan, van, minibus and large bus as admin-managed types with actual usable passenger seats, luggage allowance, accessibility and child-seat constraints. A tour/route has rates per vehicle class and date. Account for guides/leaders occupying seats and driver seats already excluded from passenger capacity. Support multiple vehicles, vehicle changes by leg, deadhead mileage, waiting/overtime, parking/tolls and driver accommodation/meals. Validate against the selected configuration; do not hardcode the hidden sheet's overlapping PAX bands.

An itinerary service bundle has explicitly included components. Prevent double charging a ticket already included in a shared group tour, a meal included in full board, or driver costs included in transport. Optional activities remain outside the base price unless selected and visibly identified.

### FX, markup, margin and minimum profit

Use decimal arithmetic, serializing money/rates as decimal strings. Retain source-currency totals and conversions; avoid binary floating point for monetary authority.

Define `fx[sourceCurrency] = AMD per 1 sourceCurrency`, AMD=1. For output USD, `costUSD = Σ(amountSource × fx[source]) / fx[USD]`. A USD supplier cost converts back to the same USD amount with the same snapshot rate. Missing/non-positive FX blocks calculation. The admin supplies rates and effective dates; changing master FX never changes an issued version.

Recommended simple policy, before sales taxes and any revenue-based charges:

- Markup mode: `targetSell = cost × (1 + markupRate)`.
- Gross-margin mode: `targetSell = cost / (1 - marginRate)`, with `0 ≤ marginRate < 1`.
- Minimum profit: `floorSell = cost + minimumProfit`, in the configured policy currency converted using the frozen FX.
- `unroundedSell = max(targetSell, floorSell)`.
- Round the final selling total up to the configured increment (e.g. 1 USD), once. Then recompute actual profit and margin from the final authoritative price.

Imported workbook percentages use **MARKUP_ON_COST** explicitly. New default policy may be true gross margin, but the admin must choose before production activation. Do not silently reinterpret historical 14% values.

Minimum profit applies per scenario/package version, not once per hotel segment or per displayed comparison. An optional per-paying-traveler floor must be a separate policy with a clear label. No production amount is supplied by the user; require admin configuration rather than inventing one.

Include all nine original cost categories and explicit other costs. Fixed bank fees belong in cost. If a fee/commission is a percentage `f` of selling revenue, it cannot be treated as a fixed additive cost: markup/floor targets require dividing by `(1-f)`; true margin after such fees requires `sell ≥ cost/(1-f-margin)`, and the profit floor requires `(cost+floor)/(1-f)`. Reject non-positive denominators. Enable such policies only after the basis is confirmed. Supplier commission-inclusive rates require an explicit receivable/net-cost treatment; do not subtract commission automatically.

Taxes, commissions and supplier terms are business configuration, not inferred legal conclusions. Reuse any existing tax framework, define inclusive/exclusive amounts and avoid adding tax already included in a contracted rate.

Discounts and manual selling-price overrides must be rechecked against the floor and permission policy. Default: block under-floor issuance; an authorized manager exception requires a reason and applies to that exact snapshot. Report actual profit and actual margin, with zero-price denominator handling.

Group total is the default contractual price. Average per-person price is informational unless a specific per-person pricing model is selected. If per-person unit prices are contractual, calculate the group total from those rounded units and show the allocation/rounding adjustment so every document reconciles. Complimentary people create costs without necessarily increasing the paying denominator.

### Scenarios and immutable snapshots

Separate three concepts: reusable package template, client request, and quotation version. A version contains alternative scenarios; a scenario can contain several consecutive hotels. Alternative hotel choices must never be summed as if all were booked.

A shared itinerary/service definition can feed several scenarios, but every scenario must resolve its full line set once, including meals and staff costs. Scenario overrides are explicit additions/replacements/removals keyed by stable line IDs. Changing location may change transfers, staff overnights and meals; hotel alternatives are not necessarily hotel-only deltas. Final snapshots flatten all selected lines so historical reproduction needs no current catalog data.

Replace the mass-pricing grid with a batch comparison action over a template version, travel start date, selected PAX bands (initially 2/4/6, extensible) and explicit room/vehicle configurations. Each combination runs the same engine with its own participant/room/vehicle quantities, date checks and rate applicability. Show unavailable combinations as invalid with reasons. Persist a batch run snapshot; refreshing creates a new run rather than rewriting a previously distributed price grid.

Snapshot inputs, participant allocations, daily hotel rates, supplier/rate versions, original and overridden rates, quantities, FX direction and values, policy versions, costs, rounding steps, output prices, validation results, calculation-engine version, actor/time and canonical content hash. Store approval against this hash. Recompute/hash-check at issuance under a transaction; concurrent edits cannot slip in after approval.

Any cost, itinerary, PAX, date, terms, hotel or price change after approval creates a new candidate version and invalidates approval for that candidate. Keep the earlier approved/issued artifact intact. Historical documents use frozen agency name/address/contacts and wording so later CRM edits do not change them.

## 6. Data model and application integration

Logical entities below must be mapped to existing WAControl models first. These names are conceptual, not instructions to duplicate a CRM or replace the current schema.

| Entity | Required content |
|---|---|
| Existing Organization/User/Role/Agency/Contact | Reuse identity, ownership and tenancy relationships; extend minimally |
| TravelRequest | Stable UUID, human request number, existing agency/contact IDs, agency reference, owner, dates, traveler setup, notes, status |
| PackageTemplate / TemplateVersion | Stable template code, version, duration, ordered day definitions, default services, applicability, source provenance |
| Quote / QuoteVersion | Durable quote number, request ID, version sequence, source template version, terms, validity, status, immutable submitted payload |
| ItineraryDay / ServiceSelection | Local date/day offset, narrative, location/overnight city, selected product, participants, basis and overrides |
| Scenario / StaySegment / RoomAllocation | Scenario identity, interval, hotel/product, room counts, traveler slots, board, attached supplements |
| Supplier / Hotel / RoomProduct / VehicleType / ServiceProduct | Stable keys, city/country, type, capacities, language/basis and active status |
| RateVersion / RateRule / SupplierAgreement | Amount/currency, season/day restrictions, occupancy/board/market, rate status, evidence attachment and review metadata |
| FXRateVersion / PricingPolicyVersion | Effective rates, direction, markup/margin type, floor, rounding, override rights |
| CalculationSnapshot / CalculatedLine | Immutable structured inputs/results, all cost components, rule trace and hash |
| ReviewDecision / AuditEvent | Exact version/hash, actor, timestamp, action, reason, before/after or append-only diff |
| QuoteDocument | Snapshot ID, document/template version, object key, hash, generation state, issue timestamp and access policy |
| ImportBatch / ImportRowIssue | Source hash, sheet/cell/image references, proposed mappings, validation failures, approvals and idempotency key |
| ValidationAssignment / WorkflowEvent | Advisor and validator user IDs, assignment history, due date, status transition, exact quote version/hash, actor and reason |
| NotificationOutbox / NotificationDelivery | Committed event, recipient, channel, template/version, deduplication key, provider ID, attempts, delivery status and errors; reuse existing equivalents |

Use database decimal types suitable for agreed precision, not floating columns. Enforce foreign keys, non-negative quantities, valid intervals, unique human IDs scoped appropriately, unique quote-version numbers and stable external/source mappings. Use transactions or explicit constraints for cross-row occupancy/rate-overlap invariants. Archived rates and suppliers remain referencable by history.

Use the user's package-code convention: **`CLIENTSHORT-YYYY-MM-DD-NNNN`**, for example `ACME-2026-09-21-0001`. Here ACME is illustrative. Default the date to the request's creation date in the configured company timezone, not the travel date, and reset the sequence per client per creation day within the organization. These date/sequence choices are documented defaults because the user specified the components but not the reset rules.

The agency/client short code is an admin-maintained, normalized uppercase identifier, unique within the organization. Generate the package code once when the advisor creates the request, using a database transaction/sequence and a unique constraint; never `count()+1`. Four digits are minimum padding, not a maximum; 10000 must remain valid. Handle concurrent creation and retries idempotently. Require a client short code before generation. Keep the package code immutable when dates, client display names, assignments or quote versions change; retain the originally encoded short code and creation date. A change of client ownership should normally create a new request with a cross-reference, not silently relabel an existing package.

Display the same package code on request screens, validation tasks, audit history, both notification channels and PDFs. Keep internal request/quote UUIDs and any existing request/quote number conventions. Revisions show the same package code plus a separate `v01`, `v02`, etc.; scenarios have separate labels/IDs. Retain ARM/GEO/COM codes as reusable template codes, shown separately from the client-specific package code. Existing historical identifiers should remain intact; use this convention for new requests and maintain explicit aliases where migration requires them.

### Service boundaries and APIs

Place the engine in an isolated domain layer used by previews, saved snapshots, batch comparisons and PDF production. It takes fully resolved, typed inputs and returns totals, trace and structured validation errors. It performs no external I/O and reads no live current date or mutable master data during evaluation. Application services resolve rates, enforce permissions and persist snapshots.

Follow existing route conventions. Logical operations: search/create requests; create draft/version; edit itinerary/scenarios; resolve rates; calculate; submit review; approve/request changes; issue/generate document; accept/decline; compare versions; import/validate/publish rates. Every mutation checks server-side permissions and expected revision. Return conflict on stale writes, structured 422-style field errors for invalid drafts, and idempotent responses for repeated issue/generate requests. Do not trust client-supplied totals.

Use existing object storage and background jobs if present. PDF jobs read an immutable snapshot, publish atomically and retry safely without duplicating issued quotations. Preserve document bytes for exact historical retrieval; regenerating with a later renderer is a new artifact, not a silent replacement.

### Roles and data access

Travel advisor: initiate and own authorized requests/drafts, prepare scenarios, make allowed overrides, submit to validator, revise returned work and issue approved versions if permitted. Validator: review assigned packages, approve, reject or return with reasons; no self-approval. A validator may be an existing manager, but below-floor exceptions require the separate manager permission. Admin: master data, pricing/FX, short codes, assignments, notification configuration and access settings. Auditor/read-only: historical versions and trace without mutation. Reuse existing role mechanisms and tenant scoping, including attachment downloads and PDF jobs.

Audit master-data changes as well as quote changes. Record actor, timestamp, entity/version, operation and reason. Keep confidential cost fields out of client serializers and logs. Escape user-entered PDF content, restrict remote assets, use authorized file retrieval, and apply existing retention/backup policies.

## 7. PDF quotation specification

Use the existing brand and document system where available. Client-facing document order:

1. Agency/client contact, quotation number/version, package title/code, issue and expiry dates.
2. Travel dates, automatically derived days/nights, adults/children and relevant ages, room setup, arrival/departure and transfer details.
3. Date-by-date itinerary, destinations and overnight cities, with optional activities clearly distinguished.
4. One or multiple labelled scenario offers: hotel/city/category, stay dates/nights, room types/counts, board basis, inclusions and group selling total in the quote currency. Show average per-person price only with its basis.
5. Inclusions and exclusions generated from selected services plus reviewed contractual wording; explicit optional supplements.
6. Availability/confirmation conditions, payment/cancellation terms and quotation validity as approved by the business.

Use page numbers, repeated table headers, readable long descriptions and suitable Unicode fonts. Do not split a scenario price away from its label. Include a visible draft watermark for unapproved previews. Internal costing reports are separate authorized documents, never hidden pages in the customer PDF. PDF totals and displayed scenarios must reconcile exactly to the approved snapshot. Acceptance records which option was selected; offering multiple options is not charging for all of them.

## 8. Migration and reconciliation

Keep the source workbook read-only and store its hash. Import into staging first. Extract catalog cells, template text, expanded formulas for evidence and agreement images with anchors. Preserve original strings beside normalized names; use stable mappings rather than fuzzy matching silently. Never execute VBA during import.

Stage 34 hotel/product rows, the populated service catalogs, the 13 package templates, Georgia package bands and historical data separately. Do not activate placeholders, missing years, `TBC`, unknown vehicle classes or unresolved per-person/per-group bases. Formula-derived prices require recorded numeric interpretation; never evaluate arbitrary imported expressions in the application.

Review the agreement images before activating rates. Detect duplicates, mismatched hotel names, conflicting date ranges, missing categories, old contract years, commission-inclusive terms and suspicious band values. Require explicit source verification status. Do not infer a full season from a summary remark.

Maintain a reconciliation ledger: source cell/rule, legacy behavior, corrected behavior, numerical difference, reason and business acceptance. Reproduce selected sound calculations in a legacy fixture mode for comparison only. Known defects must have corrected tests rather than golden expectations based on erroneous cached totals.

Use an import batch/source hash plus entity mapping to make retries idempotent. Failed batches must be recoverable without deleting pre-existing records. Roll out behind the application's existing feature-flag mechanism if present. Test additive migrations on a representative database copy and document rollback/restore. Do not reset the existing production database or deploy unrelated changes.

## 9. Acceptance examples and tests

| Test | Input | Required result |
|---|---|---|
| Duration | 1–6 Oct 2026 | 6 days / 5 nights; same-day gives 1/0; 10+ nights supported |
| Hotel split | [1,6), add [3,5) | 2+2+1 nights, no traveler-night overlap/gap |
| Seasonal crossing | 2 rooms, 2 nights at 28,000 and 1 at 32,000 | 176,000 AMD |
| Room occupancy | 5 adults, 2 DBL | Missing lodging for 1; adding eligible bed resolves only with hotel permission |
| Cottage | Whole unit for 5, 90,000/night, 3 nights | 270,000 AMD, not twice this because it has two bedrooms |
| Unknown rate | Selected TPL=TBC | Invalid scenario; no partial numeric selling total |
| Unused unknown | 0 TPL, DBL valid | No TPL lookup error; DBL scenario can calculate |
| Guest activity | 4 eligible adults at 1,500 | 6,000 AMD |
| Group activity | Lavash 10,000 fixed/event, 4 PAX | 10,000 AMD once |
| Capacity blocks | 7 PAX, jeep capacity 3, 20,000/unit | 3 units, 60,000 AMD where supplier permits multiple units |
| Vehicle capacity | 6 guests + 1 guide, 6 passenger seats | Reject or select another vehicle configuration |
| Meals/staff costs | Every original category nonzero | Every scenario includes all relevant categories exactly once |
| Georgia bands | 4 PAX, Vista 4-night rate 216 USD PP | 864 USD supplier cost |
| FX | 365,000 AMD, 365 AMD/USD | 1,000 USD cost |
| Legacy comparison | Cascade 1 SGL + 1 TPL, 5 nights, 365 FX, 14% markup | Legacy rounded quote 969 USD, separately labelled fixture |
| Markup and floor | Cost 1,000 USD, 14% markup, floor 200 USD | 1,200 USD sell, 200 profit, 16.6667% actual gross margin |
| True margin | Cost 1,000, 14% margin, zero floor, ceil 1 USD | 1,163 USD sell and 163 profit |
| Multi-currency | 365,000 AMD + 864 USD, FX 365 | 1,864 USD cost without double conversion |
| Revenue fee | Cost 1,000, fee 5%, profit floor 200 | Unrounded floor sell 1,263.157894…; rounded sell must still meet floor |
| Missing rates/FX | Required value absent or FX≤0 | Specific blocker, never zero substitution |
| Scenario isolation | Change option B hotel/route | A unchanged; B recalculates all affected operating costs |
| Rate change | Master rate/FX updated after issue | Historical snapshot and PDF unchanged |
| Approval race | Edit after approval while issuing | Old hash cannot authorize new content; conflict/re-review |
| Authorization | Unauthorized user or tenant guesses ID | No data, costs, attachment or document access |
| Idempotency | Repeat issue/import/job request | One logical issue/import/document result |
| PDF | Multiple scenarios, long multilingual itinerary | Readable pages; exact totals; no internal rates/margins |

Add tests for child age boundaries, season/weekend boundaries, year changes, rounding increments, free PAX, zero/nonzero overrides, bundle duplication, shared-departure weekday availability, expired quotes, manual discount exceptions, copy-template isolation and concurrent ID generation. Integration tests must exercise real persistence and server authorization. Regression checks cover existing WAControl login, client records, navigation and relevant existing integrations. Do not claim tests ran if the environment prevented them.

Workflow acceptance: advisor creation assigns an immutable `CLIENTSHORT-YYYY-MM-DD-NNNN` code; concurrent requests produce unique sequential codes; date/short-name edits and quote revisions preserve it. Block issue before validation and block self-approval. Test return/revise/resubmit, rejection, reassignment, expired approval after edits, and issue of the exact approved snapshot. Each relevant event creates email and WhatsApp deliveries for the specified roles containing the same package code and version. Duplicate retries do not duplicate sends where provider idempotency permits; uncertain delivery is reconciled using provider IDs. A channel failure remains visible without reversing the workflow or duplicating issuance. No stale reminder may ask for action on an already decided version. No real recipients are contacted by automated tests.

## 10. Delivery sequence and unresolved policy decisions

1. Inspect WAControl and produce a repository-specific reuse map, integration contract, migration plan and baseline tests.
2. Implement schema extensions and pure calculation engine with the critical acceptance cases first.
3. Add supplier/rate staging and verification, templates, request workflow and scenario UI.
4. Add review/versioning/snapshots, PDF generation and document retrieval.
5. Reconcile against selected workbook cases, correct known defects, run full integration and regression checks, then prepare controlled rollout.

Business configuration still needed: default markup versus true margin, minimum-profit value/currency, floor exception authority, currency rounding, child/free-place policies, actual transport capacities and per-class prices, supplier rate validity/board/commission meaning, and approved client terms/branding. These should be explicit configuration tasks. They do not justify delaying repository inspection or generic implementation, but production quotation issuance must wait for required settings and verified rates.

The accompanying Kimi prompt directs coordinated agents to implement this inside WAControl, with one lead controlling shared interfaces, migrations, integration and final verification.
