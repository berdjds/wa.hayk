/**
 * One-off design-QA screenshot capture for the v0.13.0 overhaul.
 * Logs in as the seeded admin and captures travel screens at desktop
 * (1440x900) and mobile (390x844) into doc/temp/screenshots/v0.13.0/.
 * Run: npx tsx tests/qa/capture-screenshots.ts   (dev server must be on :3000)
 */
import puppeteer from "puppeteer";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
const OUT = path.join(process.cwd(), "doc/temp/screenshots/v0.13.0");
const EMAIL = process.env.ADMIN_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.ADMIN_PASSWORD ?? "admin123";

const PAGES: { name: string; url: string; waitFor?: string }[] = [
  { name: "requests", url: "/travel" },
  { name: "templates", url: "/travel/templates" },
  { name: "review", url: "/travel/review" },
  { name: "catalog", url: "/travel/catalog" },
  { name: "agencies", url: "/travel/agencies" },
  { name: "settings", url: "/travel/settings" },
  { name: "notifications", url: "/travel/notifications" },
];

async function waitSettled(ms = 900) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  // The bundled chrome 121 crashes on this macOS; reuse the 146 build that
  // whatsapp-web.js runs successfully.
  const executablePath =
    process.env.HOME +
    "/.cache/puppeteer/chrome/mac_arm-146.0.7680.31/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();

  // --- login page itself (unauthenticated) ---
  for (const [vpName, vp] of [
    ["desktop", { width: 1440, height: 900 }],
    ["mobile", { width: 390, height: 844 }],
  ] as const) {
    await page.setViewport(vp);
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
    await waitSettled(400);
    await page.screenshot({ path: path.join(OUT, `login-${vpName}.png`) });
  }

  // --- sign in (desktop viewport) ---
  await page.setViewport({ width: 1440, height: 900 });
  await page.type("#email", EMAIL);
  await page.type("#password", PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => null),
    page.click('button[type="submit"]'),
  ]);
  await page.goto(`${BASE}/travel`, { waitUntil: "networkidle0" });
  await waitSettled();

  // --- find a request id for detail pages (rows navigate via onClick) ---
  let requestHref: string | null = null;
  const hasRow = await page.$("tbody tr");
  if (hasRow) {
    await page.click("tbody tr");
    await waitSettled(1500);
    const path = new URL(page.url()).pathname;
    if (path.startsWith("/travel/requests/")) requestHref = path;
  }
  console.log("request detail:", requestHref);

  const pages = [...PAGES];
  if (requestHref) {
    pages.splice(1, 0, {
      name: "request-detail",
      url: requestHref,
    });
  }

  for (const [vpName, vp] of [
    ["desktop", { width: 1440, height: 900 }],
    ["mobile", { width: 390, height: 844 }],
  ] as const) {
    await page.setViewport(vp);
    for (const p of pages) {
      await page.goto(`${BASE}${p.url}`, { waitUntil: "networkidle0" });
      await waitSettled();
      await page.screenshot({ path: path.join(OUT, `${p.name}-${vpName}.png`) });
      console.log("captured", p.name, vpName);
    }

    // --- request detail tabs (desktop: all 5; mobile: itinerary + scenarios) ---
    if (requestHref) {
      const tabNames = ["itinerary", "scenarios", "review", "history"];
      for (const tab of vpName === "desktop" ? tabNames : ["itinerary", "scenarios"]) {
        await page.goto(`${BASE}${requestHref}`, { waitUntil: "networkidle0" });
        await waitSettled(600);
        // Radix Tabs activate on mousedown — use a trusted click, not el.click()
        const handles = await page.$$('[role="tab"]');
        let clicked = false;
        for (const h of handles) {
          const text = await h.evaluate((el) => el.textContent?.toLowerCase() ?? "");
          if (text.includes(tab)) {
            await h.click();
            clicked = true;
            break;
          }
        }
        await waitSettled();
        if (clicked) {
          await page.screenshot({
            path: path.join(OUT, `request-tab-${tab}-${vpName}.png`),
          });
          console.log("captured tab", tab, vpName);
        } else {
          console.log("tab not found:", tab);
        }
      }

      // catalog "rates"-style inner tab (second tab) on desktop only
      if (vpName === "desktop") {
        await page.goto(`${BASE}/travel/catalog`, { waitUntil: "networkidle0" });
        await waitSettled(600);
        const tabs = await page.$$('[role="tab"]');
        let second: string | null = null;
        if (tabs[1]) {
          second = await tabs[1].evaluate((el) => el.textContent);
          await tabs[1].click();
        }
        await waitSettled();
        if (second) {
          await page.screenshot({ path: path.join(OUT, `catalog-tab2-desktop.png`) });
          console.log("captured catalog tab:", second);
        }
      }
    }
  }

  // --- temporary draft with real itinerary/scenario content ---------------
  // Instantiate a template via the app API (session cookie from login), shoot
  // the timeline/allocation UIs with real data, then hard-delete the request.
  const inst = await page.evaluate(async () => {
    const res = await fetch(
      "/api/travel/templates/cmuap79gn00hn149orr3vec74/instantiate",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agencyId: "cmuarfkzy00022jbj9nekl8we",
          title: "Timeline QA (auto)",
          startDate: "2026-11-01",
          endDate: "2026-11-04",
          travelers: { adults: 2, children: 1, childAges: [5], paying: 2, complimentary: 0, leaders: 0, staff: 0 },
        }),
      }
    );
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  });
  console.log("instantiate:", inst.status, JSON.stringify(inst.json).slice(0, 200));
  const draftId: string | undefined =
    inst.json?.request?.id ?? inst.json?.id ?? inst.json?.requestId;
  if (draftId) {
    const draftHref = `/travel/requests/${draftId}`;
    for (const [vpName, vp] of [
      ["desktop", { width: 1440, height: 900 }],
      ["mobile", { width: 390, height: 844 }],
    ] as const) {
      await page.setViewport(vp);
      for (const tab of ["itinerary", "scenarios"]) {
        await page.goto(`${BASE}${draftHref}`, { waitUntil: "networkidle0" });
        await waitSettled(800);
        const handles = await page.$$('[role="tab"]');
        for (const h of handles) {
          const text = await h.evaluate((el) => el.textContent?.toLowerCase() ?? "");
          if (text.includes(tab)) {
            await h.click();
            break;
          }
        }
        await waitSettled();
        await page.screenshot({
          path: path.join(OUT, `draft-tab-${tab}-${vpName}.png`),
          fullPage: vpName === "desktop",
        });
        console.log("captured draft tab", tab, vpName);
      }
    }
    const del = await page.evaluate(async (id) => {
      const res = await fetch(`/api/travel/requests/${id}`, { method: "DELETE" });
      return res.status;
    }, draftId);
    console.log("cleanup delete:", del);
  }

  await browser.close();
  console.log("done ->", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
