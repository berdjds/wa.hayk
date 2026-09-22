/** Focused v0.13.1 visual check: catalog hotels + services tabs with drag handles. */
import puppeteer from "puppeteer";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
const OUT = path.join(process.cwd(), "doc/temp/screenshots/v0.13.1");
const EMAIL = process.env.ADMIN_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.ADMIN_PASSWORD ?? "admin123";

async function wait(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    headless: true,
    executablePath:
      process.env.HOME +
      "/.cache/puppeteer/chrome/mac_arm-146.0.7680.31/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("#email", { timeout: 60000 });
  // Deterministic sign-in: post credentials through the NextAuth callback from
  // the page context (the UI form races Fast Refresh rebuilds in dev).
  await page.evaluate(async (email, password) => {
    const { csrfToken } = await (await fetch("/api/auth/csrf")).json();
    await fetch("/api/auth/callback/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken, email, password, json: "true" }),
    });
  }, EMAIL, PASSWORD);
  const authed = await page.evaluate(async () => {
    const s = await (await fetch("/api/auth/session")).json();
    return Boolean(s?.user?.id);
  });
  if (!authed) throw new Error("sign-in failed (no session after credentials post)");

  for (const vp of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    await page.setViewport({ width: vp.width, height: vp.height });
    await page.goto(`${BASE}/travel/catalog`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await wait(1200);
    await page.screenshot({ path: path.join(OUT, `catalog-hotels-${vp.name}.png`) });
    console.log("captured hotels", vp.name);

    // Services tab via trusted click (Radix activates on mousedown)
    const tabs = await page.$$('[role="tab"]');
    for (const t of tabs) {
      const text = await t.evaluate((el) => el.textContent ?? "");
      if (text.trim() === "Services") {
        await t.click();
        break;
      }
    }
    await wait(1000);
    await page.screenshot({ path: path.join(OUT, `catalog-services-${vp.name}.png`) });
    console.log("captured services", vp.name);
  }

  // Search-active state: drag disabled hint (desktop)
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/travel/catalog`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('input[placeholder="Search hotels..."]', { timeout: 30000 });
  await wait(1500);
  await page.type('input[placeholder="Search hotels..."]', "ani");
  await wait(800);
  await page.screenshot({ path: path.join(OUT, "catalog-hotels-search-desktop.png") });
  console.log("captured search-disabled hint");

  await browser.close();
  console.log("done ->", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
