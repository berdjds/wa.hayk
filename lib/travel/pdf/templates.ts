/**
 * Pure HTML builders for the travel quotation PDF.
 *
 * Security: every user/content string is escaped through escapeHtml — the
 * HTML is rendered by a headless browser with full script execution, so an
 * unescaped agency name or hotel label would be an XSS/injection vector
 * inside our own renderer.
 *
 * The CLIENT document must never leak costing internals. That includes the
 * CSS: the shared stylesheet deliberately avoids the `margin` property
 * (padding is used for all spacing) so that substring checks for "margin"
 * cannot false-positive on layout rules.
 */
import type {
  EngineInput,
  EngineIssue,
  ScenarioEngineInput,
  ScenarioResult,
  ServiceLineInput,
  TravelerSetup,
} from "@/lib/travel/contracts";
import type { QuotationPdfInput } from "./types";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Money is authoritative as a decimal string — render it exactly as given. */
function money(amount: string, currency: string): string {
  return `${escapeHtml(amount)} ${escapeHtml(currency)}`;
}

function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** Scenarios are alternatives, so they are labelled Option A / B / C … */
function optionLetter(index: number): string {
  return index < 26 ? `Option ${String.fromCharCode(65 + index)}` : `Option ${index + 1}`;
}

const BASE_CSS = `
  /* Font stack carries DejaVu/Noto fallbacks because Armenian text may
     appear in destinations and hotel names. */
  html { -webkit-print-color-adjust: exact; }
  body {
    font-family: "DejaVu Sans", "Noto Sans", "Noto Sans Armenian", "Segoe UI", Arial, sans-serif;
    font-size: 11px;
    color: #1a1a1a;
    line-height: 1.45;
    padding: 0 2mm;
  }
  h1 { font-size: 19px; padding-bottom: 2mm; }
  h2 { font-size: 14px; padding-top: 5mm; padding-bottom: 1.5mm; border-bottom: 1px solid #999; }
  h3 { font-size: 12px; padding-top: 3mm; padding-bottom: 1mm; }
  p { padding-bottom: 1.5mm; }
  table { border-collapse: collapse; width: 100%; padding-top: 1mm; padding-bottom: 2mm; }
  th, td { border: 1px solid #b5b5b5; padding: 1.2mm 1.8mm; text-align: left; vertical-align: top; }
  th { background: #efefef; }
  /* Repeat header rows when a table spans pages. */
  thead { display: table-header-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  .scenario-block { break-inside: avoid; page-break-inside: avoid; padding-top: 2mm; }
  .header-bar { border-bottom: 2px solid #1a1a1a; padding-bottom: 2mm; }
  .header-meta { text-align: right; }
  .muted { color: #555; }
  .price-box {
    border: 2px solid #1a1a1a;
    padding: 2.5mm 3mm;
    display: inline-block;
    background: #f7f7f7;
  }
  .price-total { font-size: 15px; font-weight: bold; }
  .internal-banner {
    border: 2px solid #b00020;
    color: #b00020;
    font-weight: bold;
    text-align: center;
    padding: 2mm;
    letter-spacing: 1px;
  }
  .internal-section { border: 1px dashed #b00020; padding: 2mm 2.5mm; }
  .issue-blocker { color: #b00020; }
  .issue-warning { color: #8a6d00; }
  .doc-footer {
    border-top: 1px solid #999;
    padding-top: 1.5mm;
    font-size: 9px;
    color: #555;
  }
  .watermark {
    /* position: fixed repeats the element on every printed page in Chromium. */
    position: fixed;
    top: 42%;
    left: 5%;
    width: 90%;
    text-align: center;
    transform: rotate(-28deg);
    font-size: 58px;
    font-weight: bold;
    color: rgba(176, 0, 32, 0.13);
    z-index: 1000;
    pointer-events: none;
  }
  ul { padding-left: 5mm; padding-bottom: 1.5mm; }
  li { padding-bottom: 0.6mm; }
  .keep-wrap { overflow-wrap: break-word; word-wrap: break-word; }
`;

function watermarkHtml(draft: boolean): string {
  return draft ? `<div class="watermark">DRAFT — NOT APPROVED</div>` : "";
}

function travelerSummary(t: TravelerSetup): string {
  const parts = [
    `${t.adults} adult${t.adults === 1 ? "" : "s"}`,
    `${t.children} child${t.children === 1 ? "" : "ren"}`,
    `${t.infants} infant${t.infants === 1 ? "" : "s"}`,
  ];
  return escapeHtml(parts.join(", "));
}

function headerHtml(input: QuotationPdfInput, docTitle: string): string {
  const a = input.agency;
  const contacts = [
    a.contactName,
    a.contactEmail,
    a.contactPhone,
  ]
    .filter((v): v is string => !!v)
    .map((v) => escapeHtml(v))
    .join(" · ");
  const issued = input.issuedAt ?? new Date().toISOString();
  return `
    <div class="header-bar">
      <table>
        <tr>
          <td style="border: none; width: 55%;">
            <h1>${escapeHtml(a.name)}</h1>
            ${contacts ? `<p class="muted">${contacts}</p>` : ""}
          </td>
          <td style="border: none;" class="header-meta">
            <h2 style="border: none; padding-top: 0;">${escapeHtml(docTitle)}</h2>
            <p><strong>${escapeHtml(input.packageCode)}</strong> ${escapeHtml(input.versionLabel)}</p>
            <p class="muted">Issued: ${escapeHtml(issued)}</p>
            ${input.validUntil ? `<p class="muted">Valid until: ${escapeHtml(input.validUntil)}</p>` : ""}
          </td>
        </tr>
      </table>
      <h2 style="border: none;">${escapeHtml(input.request.title)}</h2>
    </div>`;
}

function travelSummaryHtml(input: QuotationPdfInput): string {
  const r = input.request;
  const nights = daysBetween(r.startDate, r.endDate);
  const days = nights + 1;
  const destinations =
    r.destinations && r.destinations.length > 0
      ? r.destinations.map(escapeHtml).join(", ")
      : "—";
  return `
    <h2>Travel Summary</h2>
    <table>
      <tbody>
        <tr><th>Travel dates</th><td>${escapeHtml(r.startDate)} → ${escapeHtml(r.endDate)}</td>
            <th>Duration</th><td>${days} days / ${nights} nights</td></tr>
        <tr><th>Destinations</th><td>${destinations}</td>
            <th>Travelers</th><td>${travelerSummary(r.travelers)}</td></tr>
        <tr><th>Paying travelers</th><td>${r.travelers.paying}</td>
            <th>Agency reference</th><td>${r.agencyRef ? escapeHtml(r.agencyRef) : "—"}</td></tr>
        ${
          r.flightDetails
            ? `<tr><th>Flight details</th><td colspan="3" class="keep-wrap">${escapeHtml(r.flightDetails)}</td></tr>`
            : ""
        }
      </tbody>
    </table>`;
}

function roomSetupHtml(sc: ScenarioEngineInput): string {
  const rows: string[] = [];
  for (const stay of sc.stays) {
    for (const ra of stay.roomAllocations) {
      if (ra.rooms <= 0) continue;
      rows.push(`<tr>
        <td>${escapeHtml(stay.hotelName)}</td>
        <td>${escapeHtml(ra.roomType)}</td>
        <td>${ra.rooms}</td>
        <td>${ra.adults} ad / ${ra.children} ch / ${ra.infants} inf</td>
        <td>${ra.extraBeds}</td>
      </tr>`);
    }
  }
  if (rows.length === 0) return "";
  return `
    <h3>Room Setup</h3>
    <table>
      <thead><tr><th>Hotel</th><th>Room type</th><th>Rooms</th><th>Occupancy per allocation</th><th>Extra beds</th></tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table>`;
}

function itineraryHtml(sc: ScenarioEngineInput): string {
  if (sc.stays.length === 0) return "";
  const rows = sc.stays
    .map((stay) => {
      const nights = daysBetween(stay.checkIn, stay.checkOut);
      return `<tr>
        <td>${escapeHtml(stay.checkIn)}</td>
        <td>${escapeHtml(stay.checkOut)}</td>
        <td>${nights}</td>
        <td>${escapeHtml(stay.hotelName)}</td>
        <td>${escapeHtml(stay.city ?? "—")}</td>
        <td>${escapeHtml(stay.board ?? "—")}</td>
      </tr>`;
    })
    .join("");
  return `
    <h3>Itinerary</h3>
    <table>
      <thead><tr><th>Check-in</th><th>Check-out</th><th>Nights</th><th>Hotel</th><th>City</th><th>Board</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/**
 * Version-level day-by-day itinerary, rendered above the per-scenario stay
 * tables. Days arrive frozen and pre-normalized (see QuotationPdfInput), so
 * this only formats — legacy string items never reach the renderer.
 */
function dayByDayHtml(input: QuotationPdfInput): string {
  const days = input.itineraryDays;
  if (!days || days.length === 0) return "";
  const blocks = days
    .map((day) => {
      const services =
        day.services.length > 0
          ? `<ul>${day.services.map((s) => `<li>${escapeHtml(s.label)}</li>`).join("")}</ul>`
          : "";
      return `
        <h3>Day ${day.dayOffset + 1} — ${escapeHtml(day.date)}</h3>
        ${day.narrative ? `<p class="keep-wrap">${escapeHtml(day.narrative)}</p>` : ""}
        ${day.overnightCity ? `<p class="muted">Overnight: ${escapeHtml(day.overnightCity)}</p>` : ""}
        ${services}`;
    })
    .join("");
  return `<h2>Day-by-Day Itinerary</h2>${blocks}`;
}

/** Client-facing price box: selling totals only, never any cost detail. */
function clientPriceHtml(res: ScenarioResult, travelers: TravelerSetup, quoteCurrency: string): string {
  const perPerson =
    res.perPayingPerson !== null
      ? `<p class="muted">Informational price per paying traveler: ${money(res.perPayingPerson, quoteCurrency)}
           (basis: ${travelers.paying} paying travelers)</p>`
      : "";
  return `
    <div class="price-box">
      <p class="price-total">Group total: ${money(res.sell, quoteCurrency)}</p>
      ${perPerson}
    </div>`;
}

function scenarioInputByRef(inputs: EngineInput, ref: string): ScenarioEngineInput | undefined {
  return inputs.scenarios.find((s) => s.ref === ref);
}

function clientScenarioHtml(
  input: QuotationPdfInput,
  res: ScenarioResult,
  index: number,
): string {
  const sc = scenarioInputByRef(input.inputs, res.ref);
  const quoteCurrency = input.inputs.fx.quoteCurrency;
  const travelers = sc?.travelers ?? input.request.travelers;
  return `
    <section class="scenario-block">
      <h2>${escapeHtml(optionLetter(index))} — ${escapeHtml(res.label)}</h2>
      ${sc ? roomSetupHtml(sc) : ""}
      ${sc ? itineraryHtml(sc) : ""}
      ${clientPriceHtml(res, travelers, quoteCurrency)}
    </section>`;
}

function inclusionsHtml(input: QuotationPdfInput): string {
  const charged: string[] = [];
  const bundled: string[] = [];
  for (const sc of input.inputs.scenarios) {
    for (const svc of sc.services) {
      const target = svc.includedElsewhere ? bundled : charged;
      if (!target.includes(svc.label)) target.push(svc.label);
    }
  }
  const items: string[] = [];
  if (input.request.flightDetails) {
    items.push(`Flights as specified: ${escapeHtml(input.request.flightDetails)}`);
  }
  for (const label of charged) items.push(escapeHtml(label));
  for (const label of bundled) items.push(`${escapeHtml(label)} — included via bundle/board`);
  if (items.length === 0) items.push("Services as per itinerary above");
  return `
    <h2>Inclusions</h2>
    <ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
}

function exclusionsHtml(input: QuotationPdfInput): string {
  const items = [
    ...(input.request.flightDetails ? [] : ["International flights (unless explicitly listed under inclusions)"]),
    "Personal expenses (laundry, minibar, phone calls, souvenirs)",
    "Visas and travel insurance",
  ];
  return `
    <h2>Exclusions</h2>
    <ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`;
}

function termsHtml(input: QuotationPdfInput): string {
  if (!input.terms) return "";
  const paragraphs = input.terms
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p class="keep-wrap">${escapeHtml(p)}</p>`)
    .join("");
  return `<h2>Terms &amp; Conditions</h2>${paragraphs}`;
}

function footerHtml(input: QuotationPdfInput): string {
  const hashPrefix = escapeHtml(input.snapshotHash.slice(0, 12));
  return `
    <div class="doc-footer">
      ${escapeHtml(input.packageCode)} · ${escapeHtml(input.versionLabel)} · snapshot ${hashPrefix}
    </div>`;
}

function htmlDocument(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<style>${BASE_CSS}</style>
</head>
<body>
${body}
</body>
</html>`;
}

export function buildClientQuotationHtml(input: QuotationPdfInput): string {
  const scenarios = input.snapshot.scenarios
    .map((res, i) => clientScenarioHtml(input, res, i))
    .join("");
  const body = `
    ${watermarkHtml(input.draft)}
    ${headerHtml(input, "Quotation")}
    ${travelSummaryHtml(input)}
    ${dayByDayHtml(input)}
    ${scenarios}
    ${inclusionsHtml(input)}
    ${exclusionsHtml(input)}
    ${termsHtml(input)}
    ${footerHtml(input)}`;
  return htmlDocument(`${input.packageCode} ${input.versionLabel} — Quotation`, body);
}

// ---------------------------------------------------------------------------
// INTERNAL costing document: everything the client doc has, plus full cost
// detail. This is the only place supplier rates, margins and traces appear.
// ---------------------------------------------------------------------------

function internalBannerHtml(): string {
  return `<div class="internal-banner">INTERNAL — NOT FOR CLIENT DISTRIBUTION</div>`;
}

function categoryTotalsHtml(res: ScenarioResult): string {
  const currencies = new Set<string>();
  for (const perCurrency of Object.values(res.totals.byCategory)) {
    for (const c of Object.keys(perCurrency)) currencies.add(c);
  }
  const currencyList = Array.from(currencies).sort();
  const header = `<thead><tr><th>Category</th>${currencyList.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>`;
  const rows = Object.entries(res.totals.byCategory)
    .map(([category, perCurrency]) => {
      const cells = currencyList
        .map((c) => `<td>${perCurrency[c] !== undefined ? escapeHtml(perCurrency[c]) : "—"}</td>`)
        .join("");
      return `<tr><td>${escapeHtml(category)}</td>${cells}</tr>`;
    })
    .join("");
  return `
    <h3>Category totals (source currency)</h3>
    <table>${header}<tbody>${rows}</tbody></table>`;
}

function costByCurrencyHtml(res: ScenarioResult, quoteCurrency: string): string {
  const rows = Object.entries(res.totals.costByCurrency)
    .map(([c, amount]) => `<tr><td>${escapeHtml(c)}</td><td>${escapeHtml(amount)} ${escapeHtml(quoteCurrency)}</td></tr>`)
    .join("");
  return `
    <h3>Cost converted to quote currency</h3>
    <table>
      <thead><tr><th>Source currency</th><th>Total in ${escapeHtml(quoteCurrency)}</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><th>costQuote</th><th><strong>${escapeHtml(res.totals.costQuote)} ${escapeHtml(quoteCurrency)}</strong></th></tr></tfoot>
    </table>`;
}

function policyHtml(input: QuotationPdfInput, res: ScenarioResult): string {
  const p = input.inputs.policy;
  const q = input.inputs.fx.quoteCurrency;
  const rows: string[] = [
    `<tr><th>Policy</th><td>${escapeHtml(p.type)}${p.rate ? ` @ ${escapeHtml(p.rate)}` : ""}${p.feeFraction ? ` + fee ${escapeHtml(p.feeFraction)}` : ""}</td></tr>`,
    `<tr><th>Policy target</th><td>${res.policyTarget !== null ? money(res.policyTarget, q) : "—"}</td></tr>`,
    `<tr><th>Policy floor</th><td>${res.policyFloor !== null ? money(res.policyFloor, q) : "—"}</td></tr>`,
    `<tr><th>Unrounded sell</th><td>${money(res.unroundedSell, q)}</td></tr>`,
    `<tr><th>Rounding (up to ${escapeHtml(p.roundingIncrement)} ${escapeHtml(q)})</th><td>${money(res.roundingAdjustment, q)}</td></tr>`,
    `<tr><th>Final sell</th><td><strong>${money(res.sell, q)}</strong></td></tr>`,
    `<tr><th>Profit</th><td>${money(res.profit, q)}</td></tr>`,
    `<tr><th>Margin</th><td>${res.margin !== null ? escapeHtml(res.margin) : "—"}</td></tr>`,
  ];
  if (p.minProfit) {
    rows.push(
      `<tr><th>Min profit floor</th><td>${money(p.minProfit, p.minProfitCurrency ?? q)}${p.belowFloorExceptionGranted ? " (below-floor exception granted)" : ""}</td></tr>`,
    );
  }
  return `
    <h3>Policy &amp; profit</h3>
    <table><tbody>${rows.join("")}</tbody></table>`;
}

function fxTableHtml(input: QuotationPdfInput): string {
  const fx = input.inputs.fx;
  const rows = Object.entries(fx.rates)
    .map(
      ([c, rate]) =>
        `<tr><td>${escapeHtml(c)}${c === fx.quoteCurrency ? " (quote currency)" : ""}</td><td>${escapeHtml(rate)} AMD</td></tr>`,
    )
    .join("");
  return `
    <h3>FX rates (AMD per 1 unit)</h3>
    <table>
      <thead><tr><th>Currency</th><th>Rate</th></tr></thead>
      <tbody><tr><td>AMD (base)${fx.quoteCurrency === "AMD" ? " (quote currency)" : ""}</td><td>1 AMD</td></tr>${rows}</tbody>
    </table>`;
}

function nightlyTraceHtml(res: ScenarioResult, sc: ScenarioEngineInput | undefined): string {
  if (res.nightly.length === 0) return "";
  const stayName = (ref: string) => sc?.stays.find((s) => s.ref === ref)?.hotelName ?? ref;
  const rows = res.nightly
    .map(
      (n) => `<tr>
        <td>${escapeHtml(n.date)}</td>
        <td>${escapeHtml(stayName(n.stayRef))}</td>
        <td>${escapeHtml(n.roomType)}</td>
        <td>${n.rooms}</td>
        <td>${money(n.rate, n.currency)}</td>
        <td>${n.extraBeds}</td>
        <td>${money(n.extraBedCharge, n.currency)}</td>
        <td>${n.sourceRef ? escapeHtml(n.sourceRef) : "—"}</td>
      </tr>`,
    )
    .join("");
  return `
    <h3>Nightly rate trace</h3>
    <table>
      <thead><tr><th>Date</th><th>Stay</th><th>Room type</th><th>Rooms</th><th>Rate</th><th>Extra beds</th><th>Extra bed charge</th><th>Source</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function issuesHtml(issues: EngineIssue[]): string {
  if (issues.length === 0) return "";
  const rows = issues
    .map(
      (i) => `<tr>
        <td class="${i.severity === "BLOCKER" ? "issue-blocker" : "issue-warning"}">${escapeHtml(i.severity)}</td>
        <td>${escapeHtml(i.code)}</td>
        <td>${escapeHtml([i.scenarioRef, i.lineRef, i.field].filter(Boolean).join(" / ") || "—")}</td>
        <td class="keep-wrap">${escapeHtml(i.message)}</td>
      </tr>`,
    )
    .join("");
  return `
    <h3>Issues</h3>
    <table>
      <thead><tr><th>Severity</th><th>Code</th><th>Location</th><th>Message</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function overrideNotesHtml(input: QuotationPdfInput): string {
  const notes: string[] = [];
  for (const sc of input.inputs.scenarios) {
    for (const svc of sc.services) {
      if (!svc.override) continue;
      notes.push(
        `<li><strong>${escapeHtml(svc.label)}</strong> (${escapeHtml(sc.label)}): rate overridden from ` +
          `${svc.override.originalRate !== null ? escapeHtml(svc.override.originalRate) : "n/a"} ${escapeHtml(svc.currency)} — ` +
          `reason: ${escapeHtml(svc.override.reason)} (actor: ${escapeHtml(svc.override.actorId)})</li>`,
      );
    }
  }
  if (notes.length === 0) return "";
  return `<h3>Override notes</h3><ul>${notes.join("")}</ul>`;
}

function calculationTraceHtml(res: ScenarioResult): string {
  if (res.trace.length === 0) return "";
  return `
    <h3>Calculation trace</h3>
    <ul>${res.trace.map((t) => `<li class="keep-wrap">${escapeHtml(t)}</li>`).join("")}</ul>`;
}

function internalScenarioHtml(
  input: QuotationPdfInput,
  res: ScenarioResult,
  index: number,
): string {
  const sc = scenarioInputByRef(input.inputs, res.ref);
  return `
    ${clientScenarioHtml(input, res, index)}
    <section class="scenario-block internal-section">
      <h3>Internal costing — ${escapeHtml(optionLetter(index))} (${escapeHtml(res.label)})</h3>
      ${res.valid ? "" : `<p class="issue-blocker"><strong>Scenario INVALID — validation blockers present.</strong></p>`}
      ${categoryTotalsHtml(res)}
      ${costByCurrencyHtml(res, input.inputs.fx.quoteCurrency)}
      ${policyHtml(input, res)}
      ${nightlyTraceHtml(res, sc)}
      ${issuesHtml(res.issues)}
      ${calculationTraceHtml(res)}
    </section>`;
}

export function buildInternalCostingHtml(input: QuotationPdfInput): string {
  const scenarios = input.snapshot.scenarios
    .map((res, i) => internalScenarioHtml(input, res, i))
    .join("");
  const staffServices: ServiceLineInput[] = input.inputs.scenarios.flatMap((sc) =>
    sc.services.filter((s) => s.isStaffCost),
  );
  const staffSection =
    staffServices.length > 0
      ? `<h3>Staff cost lines</h3><ul>${staffServices
          .map(
            (s) =>
              `<li>${escapeHtml(s.label)} — ${escapeHtml(s.category)}, basis ${escapeHtml(s.basis)}, ` +
              `rate ${s.unitRate !== null ? escapeHtml(s.unitRate) : "MISSING"} ${escapeHtml(s.currency)}</li>`,
          )
          .join("")}</ul>`
      : "";
  const body = `
    ${watermarkHtml(input.draft)}
    ${internalBannerHtml()}
    ${headerHtml(input, "Internal Costing Sheet")}
    ${travelSummaryHtml(input)}
    ${scenarios}
    <section class="scenario-block internal-section">
      <h2>Package-level internal data</h2>
      ${fxTableHtml(input)}
      ${staffSection}
      ${overrideNotesHtml(input)}
      ${issuesHtml(input.snapshot.issues.filter((i) => !i.scenarioRef))}
    </section>
    ${inclusionsHtml(input)}
    ${exclusionsHtml(input)}
    ${termsHtml(input)}
    ${footerHtml(input)}`;
  return htmlDocument(
    `${input.packageCode} ${input.versionLabel} — Internal Costing`,
    body,
  );
}

export function buildHtmlForKind(input: QuotationPdfInput): string {
  return input.kind === "INTERNAL"
    ? buildInternalCostingHtml(input)
    : buildClientQuotationHtml(input);
}
