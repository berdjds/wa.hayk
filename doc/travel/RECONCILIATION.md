# Workbook reconciliation ledger

Source: `Tour Calculator v12.xlsm` (SHA-256 `02cf436b…4483f8`), statically extracted into
`Workbook-Evidence.json` / `Formula-inventory.json`. The xlsm itself was not available in this
repository during implementation, so agreement-image (67 embedded images) rate verification is
**pending supplier/admin review** — affected rows are staged as NEEDS_REVIEW, never activated
silently. Legacy = observed workbook behavior; Corrected = module behavior.

| # | Source | Legacy behavior | Corrected behavior | Status |
|---|--------|-----------------|--------------------|--------|
| 1 | Mass Calculation (527 formulas with literal `#REF!`, 1,829 cached `#REF!` cells, 18 broken defined names) | Broken cached totals could be mistaken for prices | Never imported as prices; templates/rates rebuilt from catalog literals | Corrected |
| 2 | Tour Calculator K72:K74 | "Margin %" actually markup on rounded cost: `ROUNDUP(cost/fx)` then `ROUNDUP(rounded×14%)` | Explicit policy types; imported 14% = MARKUP_ON_COST, labelled legacy; single round-up stage; actual profit/margin recomputed | Corrected; legacy Cascade fixture (969 USD) kept as labelled test fixture |
| 3 | K5 hotel rows | Text errors ("Check the room price") ignored by SUM → understated totals; blank×qty = 0 | Typed issues: MISSING_RATE blocks selected lines; unused room types don't block; "0" is a legitimate rate | Corrected |
| 4 | I96:Z104 comparison | Omits guest meals, staff accommodation/meals, tour-leader costs | All 9 categories + OTHER flow into every scenario exactly once | Corrected (engine tests) |
| 5 | K81/K88:K91 | Text duration dropdown, `LEFT(K81,1)` breaks >9 nights, no real dates | Local calendar dates; nights=end−start, days=nights+1; 10+ nights and year boundaries supported | Corrected |
| 6 | G5:J46 room-nights | Manual room-night entry, no occupancy enforcement (L88 informational) | Occupancy validation per room (adults/children/total, extra-bed eligibility, TPL no-double-charge, whole-unit cottages) | Corrected |
| 7 | Hotel splits | Not supported | `[checkIn, checkOut)` segments; inserting 3–5 Oct into 1–6 Oct → 2+2+1 with preview; per-night coverage (gap/overlap/out-of-tour) validation | Corrected |
| 8 | Mass E5:G5 Lavash | Flat 10,000 across PAX bands while tickets scale per person | Explicit bases: GROUP (once) vs PER_PERSON; CAPACITY_BLOCK for jeeps (ceil(7/3)=3 units) | Corrected |
| 9 | Georgia O136/P136 | 2-PAX per-person rate misused for 4/6 PAX | Per-band USD rates (4 PAX Vista 4N = 216×4 = 864 USD); engine test locks it | Corrected |
| 10 | Combined J147:L154 | Same hotel room factor for all PAX bands | Batch pricing allocates rooms per band (ceil(pax/2) DBL default, configurable) | Corrected |
| 11 | Transport pricing | No vehicle-class matrix; transport constant across PAX bands | VehicleType catalog (sedan/van/minibus/bus seats configurable); per-leg vehicle selection; capacity validated (6 guests + 1 guide > 6 seats blocks) | Partially corrected — per-class rate matrix still needs admin data |
| 12 | Shared tours C69:C72 | Weekday notes as free text | Parsed weekday departures ([3,5,7] etc.) stored on products | Stored; weekday enforcement during resolution pending |
| 13 | Template codes ARMGG-S26-0506A, duplicate "Jermuk Edition" titles | Ambiguous/typo identifiers | Preserved verbatim with provenance notes; admin may alias later | Preserved, needs business review |
| 14 | Cozy House F36 vs email LY89 | Catalog sells extra bed the supplier says doesn't exist | extraBedAllowed=false; rate staged NEEDS_REVIEW with conflict note | Needs supplier verification |
| 15 | Grand Hotel Yerevan L22 vs GW40 | Flat May–Oct season; email says Oct 2026 closed, May 2026 quote-on-request | stopSales 2026-10-01→2026-11-01 on its rates; QOR noted; resolution enforces stop-sale before rate selection | Stored, unverified correspondence |
| 16 | Dilijan LA2/LA62 identity (Best Western label vs Paradise Hotel footer) | Conflicting hotel identity | Both catalog rows kept separate; conflict noted | Needs business resolution |
| 17 | Teghenis IS2/IS59 | Cottages exclude breakfast; weekend = Fri/Sat (vs 8*8 Fri–Sun) | Whole-unit cottage pricing (no per-bedroom multiplication); per-contract weekend calendars stored as rate metadata | Corrected pricing; meal inclusion flagged in notes |
| 18 | Jermuk MW69 | No one-night / no group bookings Jul–Aug | Restrictions recorded on rate notes | Needs supplier verification |
| 19 | Radisson IG2 | Extra bed 10,000 + third-person breakfast 9,000 separate | Extra-bed supplement modelled separately from board | Model corrected; rate split NEEDS_REVIEW |
| 20 | Hidden sheet 4+1 Ani Central Inn | Fixed per-person profit, dimensionally suspicious commission formula (adds PAX to money), 380 FX | Kept as historical evidence only; fee/commission uses solved `cost/(1−f−m)` style formulas with denominator validation | Corrected (not promoted to policy) |
| 21 | VBA ResetForm | Clears quantities only; no persistence/PDF/review logic | Not ported; module implements real persistence, snapshots, review, PDF | Superseded |
| 22 | Formula-derived prices (F8 `5000+10000`, E15, E34) | Expressions, not supplier links | Stored as numeric results with source evidence; expressions never evaluated in-app | Corrected |
| 23 | Ani Central Inn FM2 conflicting year wording; 8*8 KO2 "2025" heading; Paris DQ2 close-outs | Ambiguous seasons/years | Rates staged with notes; overlapping boundary semantics not guessed | Needs supplier verification |
| 24 | D215 > C215 (Georgia 4★ band inversion 331 > 327) | Suspicious band pricing | Both stored; flagged | Needs supplier confirmation |

## Legacy fixture (comparison only)

Cascade 1 SGL (24,000) + 1 TPL (38,000) × 5 nights = 310,000 AMD; FX 365; legacy 14% markup with
two-step rounding → 969 USD. Locked in `tests/engine` as a labelled legacy fixture; the engine's
single-stage rounding coincides at 310,000 (969) and intentionally diverges elsewhere
(documented in the test).
