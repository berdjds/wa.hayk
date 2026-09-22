import { describe, expect, it } from "vitest";
import { normalizeDayServices } from "@/lib/travel/contracts";
import { groupMoney } from "@/lib/travel/engine/money";
import {
  buildClientQuotationHtml,
  buildInternalCostingHtml,
} from "@/lib/travel/pdf/templates";
import {
  FIXTURE_BRANDING,
  FIXTURE_ITINERARY_DAYS,
  FIXTURE_NIGHTLY_RATE,
  FIXTURE_SELL_A,
  FIXTURE_SELL_B,
  FIXTURE_SOURCEREF,
  makeFixture,
} from "./fixture";

describe("client quotation HTML", () => {
  const input = makeFixture();
  const html = buildClientQuotationHtml(input);

  it("carries document identity: package code, version label, title, dates", () => {
    expect(html).toContain("ACME-2026-09-21-0001");
    expect(html).toContain("v02");
    expect(html).toContain("Armenia Autumn Group Tour");
    expect(html).toContain("2026-10-01");
    expect(html).toContain("2026-10-06");
    expect(html).toContain("Valid until: 2026-10-15");
  });

  it("labels scenarios as alternatives with their own sell totals", () => {
    expect(html).toContain("Option A");
    expect(html).toContain("Option B");
    expect(html).toContain("Yerevan City Stay");
    expect(html).toContain("Yerevan–Dilijan Loop");
    expect(html).toContain(`${groupMoney(FIXTURE_SELL_A)} AMD`);
    expect(html).toContain(`${groupMoney(FIXTURE_SELL_B)} AMD`);
  });

  it("never sums scenario totals into a grand total", () => {
    // 1679000.00 + 1842500.00 — scenarios are alternatives, not additive.
    expect(html).not.toContain("3521500.00");
    expect(html).not.toContain("Grand total");
  });

  it("never leaks costing internals (profit, margin, costQuote, sources, rates, trace)", () => {
    expect(html).not.toContain("profit");
    expect(html).not.toContain("margin");
    expect(html).not.toContain("costQuote");
    expect(html).not.toContain("sourceRef");
    expect(html).not.toContain(FIXTURE_SOURCEREF);
    expect(html).not.toContain(FIXTURE_NIGHTLY_RATE);
    expect(html).not.toContain("MARKUP_ON_COST");
    expect(html).not.toContain("trace");
    expect(html).not.toContain("207300.00"); // profit amount
    expect(html).not.toContain("1471700.00"); // costQuote amount
  });

  it("labels the per-person price with its paying denominator", () => {
    expect(html).toContain("per paying traveler");
    expect(html).toContain("76,318.18 AMD");
    expect(html).toContain("22 paying travelers");
  });

  it("derives inclusions and a standard exclusions block", () => {
    expect(html).toContain("Airport transfers (round trip)");
    expect(html).toContain("Welcome dinner — included via bundle/board");
    expect(html).toContain("International flights");
    expect(html).toContain("Personal expenses");
    expect(html).toContain("Visas");
  });

  it("omits the flights exclusion when flight details are provided", () => {
    const withFlights = buildClientQuotationHtml(
      makeFixture({ request: { ...makeFixture().request, flightDetails: "QR 285 DOH–EVN, 01 Oct" } }),
    );
    expect(withFlights).toContain("QR 285 DOH–EVN");
    expect(withFlights).not.toContain("International flights (unless explicitly listed");
  });

  it("shows the draft watermark only in draft mode", () => {
    expect(buildClientQuotationHtml(makeFixture({ draft: true }))).toContain("DRAFT — NOT APPROVED");
    expect(html).not.toContain("DRAFT — NOT APPROVED");
  });

  it("escapes injected markup in user/content strings", () => {
    const evil = makeFixture({
      agency: { ...makeFixture().agency, name: 'ACME <script>alert("x")</script> Travel' },
    });
    const out = buildClientQuotationHtml(evil);
    expect(out).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(out).not.toContain('<script>alert("x")</script>');
  });

  it("passes Armenian / Unicode text through intact", () => {
    expect(html).toContain("Երևան");
    expect(html).toContain("Դիլիջան");
    expect(html).toContain("նախաճաշ");
    expect(html).toContain('meta charset="UTF-8"');
  });

  it("footer carries the short snapshot hash", () => {
    expect(html).toContain("snapshot abcdef012345");
  });
});

describe("client quotation branding and cover", () => {
  const branded = buildClientQuotationHtml(makeFixture({ branding: FIXTURE_BRANDING }));
  const unbranded = buildClientQuotationHtml(makeFixture());

  it("cover shows the company name, contact block and quotation number", () => {
    expect(branded).toContain("Nare Travel &amp; Tours");
    expect(branded).toContain("+374 10 530053");
    expect(branded).toContain("info@naretravel.am");
    expect(branded).toContain("www.naretravel.am");
    expect(branded).toContain("15 Abovyan St, Yerevan, Armenia");
    expect(branded).toContain("#ACME-2026-09-21-0001");
    // The client agency name moves out of the cover headline when a company
    // name is configured (it is only the fallback).
    expect(branded).not.toContain("ACME Travel LLC");
  });

  it("renders the display title, destination subtitle and stat pills", () => {
    expect(branded).toContain("Armenia Autumn Group Tour");
    expect(branded).toContain("Yerevan / Երևան · Dilijan / Դիլիջան");
    expect(branded).toContain("Total pax: 23"); // 18 adults + 4 children + 1 infant
    expect(branded).toContain("Adults: 18");
    expect(branded).toContain("Children: 4");
    expect(branded).toContain("Infants: 1");
    expect(branded).toContain("Nights: 5");
    expect(branded).toContain("Days: 6");
    expect(branded).toContain('class="pill"');
  });

  it("applies the configured brand color to bars, pills and the title", () => {
    expect(branded).toContain("#0d4f8b");
    expect(branded).not.toContain("#16305b");
    expect(unbranded).toContain("#16305b"); // default navy fallback
  });

  it("rejects a malformed brand color and falls back to the default", () => {
    const evil = buildClientQuotationHtml(
      makeFixture({ branding: { ...FIXTURE_BRANDING, brandColor: 'red;"><script>alert(1)</script>' } }),
    );
    expect(evil).toContain("#16305b");
    expect(evil).not.toContain('red;"');
  });

  it("falls back to the agency name and contacts when branding is unset", () => {
    expect(unbranded).toContain("ACME Travel LLC");
    expect(unbranded).toContain("Ani Sargsyan · ani@acme-travel.am · +374 10 000000");
  });

  it("escapes injected markup in branding fields", () => {
    const evil = buildClientQuotationHtml(
      makeFixture({
        branding: { ...FIXTURE_BRANDING, companyName: 'Nare <script>alert("x")</script>' },
      }),
    );
    expect(evil).toContain("Nare &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(evil).not.toContain('<script>alert("x")</script>');
  });
});

describe("client quotation package offer structure", () => {
  const html = buildClientQuotationHtml(
    makeFixture({ branding: FIXTURE_BRANDING, itineraryDays: FIXTURE_ITINERARY_DAYS }),
  );

  it("uses branded section bars", () => {
    expect(html).toContain('class="section-bar"');
    expect(html).toContain("Travel Summary");
    expect(html).toContain("Package Options");
    expect(html).toContain("Inclusions");
    expect(html).toContain("Exclusions");
    expect(html).toContain("Terms &amp; Conditions");
    expect(html).toContain("Important Notes");
  });

  it("renders day banner bars with the overnight city on the right", () => {
    expect(html).toContain('class="day-bar"');
    expect(html).toContain("Day 1 — 2026-10-01");
    expect(html).toContain('class="overnight">Overnight: Yerevan / Երևան');
  });

  it("comparison table lists every scenario with hotels, rooms and totals", () => {
    expect(html).toContain("Package Options");
    expect(html).toContain("Per paying traveler");
    expect(html).toContain("<strong>Option A</strong> — Yerevan City Stay");
    expect(html).toContain("<strong>Option B</strong> — Yerevan–Dilijan Loop");
    expect(html).toContain("Grand Hotel Yerevan / Գրանդ Հյուրանոց · Dilijan Forest Resort");
    expect(html).toContain("8×STANDARD, 2×TRIPLE");
    expect(html).toContain("10×STANDARD, 2×TRIPLE"); // max concurrent rooms across stays
    expect(html).toContain(`<strong>${groupMoney(FIXTURE_SELL_A)} AMD</strong>`);
    expect(html).toContain(`<strong>${groupMoney(FIXTURE_SELL_B)} AMD</strong>`);
  });

  it("keeps the per-scenario detail blocks after the comparison table", () => {
    const options = html.indexOf("Package Options");
    const detail = html.indexOf('class="scenario-block"');
    expect(options).toBeGreaterThan(-1);
    expect(detail).toBeGreaterThan(options);
  });

  it("renders inclusions and exclusions side by side", () => {
    expect(html).toContain('class="borderless two-col"');
  });

  it("renders terms as a numbered list", () => {
    expect(html).toContain("<ol>");
    expect(html).toContain('<li class="keep-wrap">Rates are subject to availability at the time of booking.</li>');
    expect(html).toContain('<li class="keep-wrap">A 30% deposit is required to confirm services.</li>');
  });

  it("carries the important-notes box with the offer-only disclaimers", () => {
    expect(html).toContain('class="notes-box"');
    expect(html).toContain("This is an offer only; no services have been booked at this stage.");
    expect(html).toContain("Availability and rates are subject to change until confirmation.");
    expect(html).toContain("Valid until 2026-10-15.");
  });

  it("closes with the thank-you banner and a contact line", () => {
    expect(html).toContain('class="thanks-banner"');
    expect(html).toContain("Thank you for choosing Nare Travel &amp; Tours!");
    expect(html).toContain("+374 10 530053 · info@naretravel.am · www.naretravel.am");
  });

  it("thank-you banner falls back to 'us' without a company name", () => {
    expect(buildClientQuotationHtml(makeFixture())).toContain("Thank you for choosing us!");
  });

  it("client HTML still contains no costing vocabulary (incl. the CSS)", () => {
    expect(html).not.toContain("margin");
    expect(html).not.toContain("Margin");
    expect(html).not.toContain("profit");
    expect(html).not.toContain("costQuote");
    expect(html).not.toContain("trace");
  });
});

describe("client quotation day-by-day itinerary", () => {
  const html = buildClientQuotationHtml(makeFixture({ itineraryDays: FIXTURE_ITINERARY_DAYS }));

  it("renders a day heading, narrative, overnight city and service labels", () => {
    expect(html).toContain("Day-by-Day Itinerary");
    expect(html).toContain("Day 1 — 2026-10-01");
    expect(html).toContain("Day 2 — 2026-10-02");
    expect(html).toContain("Day 3 — 2026-10-03");
    expect(html).toContain("Arrival in Yerevan, transfer to the hotel and welcome dinner.");
    expect(html).toContain("Overnight: Yerevan / Երևան");
    expect(html).toContain("<li>Airport transfer</li>");
    expect(html).toContain("<li>Welcome dinner</li>");
    expect(html).toContain("<li>Yerevan city tour</li>");
  });

  it("sits above the per-scenario stay tables", () => {
    const daySection = html.indexOf("Day-by-Day Itinerary");
    const stayTable = html.indexOf("Check-in");
    expect(daySection).toBeGreaterThan(-1);
    expect(stayTable).toBeGreaterThan(-1);
    expect(daySection).toBeLessThan(stayTable);
  });

  it("never leaks the catalog serviceProductId", () => {
    expect(html).not.toContain("svc-welcome-dinner");
    expect(html).not.toContain("svc-city-tour");
    expect(html).not.toContain("serviceProductId");
  });

  it("skips empty narrative/overnight without stray markup", () => {
    // Day 3 has neither narrative nor overnightCity.
    const day3 = html.slice(html.indexOf("Day 3 — 2026-10-03"));
    expect(day3).not.toContain("Overnight:");
  });

  it("escapes markup in narratives and service labels", () => {
    const evil = buildClientQuotationHtml(
      makeFixture({
        itineraryDays: [
          {
            dayOffset: 0,
            date: "2026-10-01",
            narrative: 'Meet at the <b>lobby</b> <script>alert("x")</script>',
            overnightCity: null,
            services: [{ serviceProductId: null, label: "<img src=x onerror=alert(1)>" }],
          },
        ],
      }),
    );
    expect(evil).toContain("&lt;script&gt;");
    expect(evil).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(evil).not.toContain('<script>alert("x")</script>');
  });

  it("absent or empty itineraryDays renders exactly the previous output", () => {
    const baseline = buildClientQuotationHtml(makeFixture());
    expect(baseline).not.toContain("Day-by-Day Itinerary");
    expect(buildClientQuotationHtml(makeFixture({ itineraryDays: [] }))).toBe(baseline);
    expect(buildClientQuotationHtml(makeFixture({ itineraryDays: undefined }))).toBe(baseline);
  });
});

describe("normalizeDayServices", () => {
  it("maps legacy plain-string items to { serviceProductId: null, label }", () => {
    expect(normalizeDayServices(JSON.stringify(["City tour", "Museum"]))).toEqual([
      { serviceProductId: null, label: "City tour" },
      { serviceProductId: null, label: "Museum" },
    ]);
  });

  it("passes structured items through and drops malformed entries", () => {
    expect(
      normalizeDayServices(
        JSON.stringify([
          { serviceProductId: "svc-1", label: "City tour" },
          { label: "Free text" },
          { serviceProductId: "", label: "Empty id" },
          42,
          { noLabel: true },
          "",
        ]),
      ),
    ).toEqual([
      { serviceProductId: "svc-1", label: "City tour" },
      { serviceProductId: null, label: "Free text" },
      { serviceProductId: null, label: "Empty id" },
    ]);
  });

  it("returns [] for missing or unparseable JSON", () => {
    expect(normalizeDayServices(null)).toEqual([]);
    expect(normalizeDayServices(undefined)).toEqual([]);
    expect(normalizeDayServices("not json")).toEqual([]);
    expect(normalizeDayServices('{"not":"an array"}')).toEqual([]);
  });
});

describe("internal costing HTML", () => {
  const input = makeFixture({ kind: "INTERNAL" });
  const html = buildInternalCostingHtml(input);

  it("is marked as internal", () => {
    expect(html).toContain("INTERNAL — NOT FOR CLIENT DISTRIBUTION");
  });

  it("contains category totals, costQuote, policy and profit/margin", () => {
    expect(html).toContain("costQuote");
    expect(html).toContain("1,471,700.00 AMD");
    expect(html).toContain("ACCOMMODATION");
    expect(html).toContain("1,187,500.00");
    expect(html).toContain("Profit");
    expect(html).toContain("207,300.00 AMD");
    expect(html).toContain("Margin");
    expect(html).toContain("0.1235");
    expect(html).toContain("MARKUP_ON_COST");
    expect(html).toContain("1,678,938.00 AMD"); // policyTarget
    expect(html).toContain("126.00 AMD"); // roundingAdjustment
  });

  it("contains the FX table and quote currency marker", () => {
    expect(html).toContain("AMD per 1 unit");
    expect(html).toContain("385 AMD");
    expect(html).toContain("(quote currency)");
  });

  it("contains the nightly rate trace with source references", () => {
    expect(html).toContain(FIXTURE_SOURCEREF);
    expect(html).toContain(`${groupMoney(FIXTURE_NIGHTLY_RATE)} AMD`);
    expect(html).toContain("Nightly rate trace");
  });

  it("renders the calculation trace consolidated, grouped and without internal ids", () => {
    expect(html).toContain("Calculation trace");
    expect(html).toContain(
      "Dilijan Forest Resort — STANDARD, 2026-10-03 → 2026-10-04 (2 nights): 10 rooms × 31,000 AMD/night = 620,000 AMD (RateVersion clx-autumn-2026)",
    );
    expect(html).toContain("policy MARKUP_ON_COST 0.14: target = 1,529,300 × 1.14 = 1,743,402");
    expect(html).toContain("sell: unrounded 1,742,488 → sell 1,842,500 (rounding adjustment 12); profit 313,200");
  });

  it("contains issues and override notes", () => {
    expect(html).toContain("UNUSED_BEDS");
    expect(html).toContain("2 bed(s) allocated but unused");
    expect(html).toContain("Group discount negotiated");
    expect(html).toContain("3000.00"); // original rate before override
  });

  it("keeps the client-facing sell totals as well", () => {
    expect(html).toContain(`${groupMoney(FIXTURE_SELL_A)} AMD`);
    expect(html).toContain(`${groupMoney(FIXTURE_SELL_B)} AMD`);
    expect(html).toContain("Option A");
    expect(html).toContain("Option B");
  });

  it("watermarks drafts", () => {
    expect(buildInternalCostingHtml(makeFixture({ kind: "INTERNAL", draft: true }))).toContain(
      "DRAFT — NOT APPROVED",
    );
  });
});
