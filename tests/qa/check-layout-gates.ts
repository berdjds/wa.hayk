/** Gate 34/49 check: page-level horizontal scroll + wrapped clickable text. */
import puppeteer from "puppeteer";

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.ADMIN_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.ADMIN_PASSWORD ?? "admin123";
const PAGES = ["/travel", "/travel/templates", "/travel/review", "/travel/catalog", "/travel/agencies", "/travel/settings", "/travel/notifications", "/login"];
const WIDTHS = [320, 375, 414, 768, 1280, 1920];

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: process.env.HOME + "/.cache/puppeteer/chrome/mac_arm-146.0.7680.31/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
  await page.waitForSelector("#email", { timeout: 30000 });
  await page.type("#email", EMAIL);
  await page.type("#password", PASSWORD);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => null), page.click('button[type="submit"]')]);

  // find a request detail page
  await page.goto(`${BASE}/travel`, { waitUntil: "networkidle0" });
  if (await page.$("tbody tr")) {
    await page.click("tbody tr");
    await new Promise((r) => setTimeout(r, 1500));
    const p = new URL(page.url()).pathname;
    if (p.startsWith("/travel/requests/")) PAGES.push(p);
  }

  let failures = 0;
  for (const w of WIDTHS) {
    await page.setViewport({ width: w, height: 900 });
    for (const url of PAGES) {
      await page.goto(`${BASE}${url}`, { waitUntil: "networkidle0" });
      await new Promise((r) => setTimeout(r, 500));
      const res = await page.evaluate(() => {
        const de = document.documentElement;
        const pageOverflow = de.scrollWidth > de.clientWidth + 1;
        const wrapped: string[] = [];
        const affordances = document.querySelectorAll(
          'button, a, [role="tab"], [role="link"], nav a'
        );
        for (const el of Array.from(affordances)) {
          const text = (el.textContent ?? "").trim();
          if (!text) continue;
          // Icon-bearing affordances produce multi-top rects even on one line;
          // table-cell links wrap by column design, not by affordance failure.
          if (el.querySelector("svg, img") || el.closest("table")) continue;
          const range = document.createRange();
          range.selectNodeContents(el);
          const tops = new Set(
            Array.from(range.getClientRects())
              .filter((r) => r.height > 0)
              .map((r) => Math.round(r.top))
          );
          if (tops.size > 1) {
            wrapped.push(`${el.tagName} "${text.slice(0, 40)}" lines=${tops.size}`);
          }
          range.detach();
        }
        return { pageOverflow, wrapped: wrapped.slice(0, 5) };
      });
      if (res.pageOverflow) {
        failures++;
        console.log(`FAIL h-scroll @${w} ${url}`);
      }
      if (res.wrapped.length) {
        console.log(`WARN wrapped @${w} ${url}:`, res.wrapped);
      }
    }
  }
  console.log(failures === 0 ? "gate 34: pass (no page-level horizontal scroll)" : `gate 34: ${failures} failures`);
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
