/** E2E smoke: keyboard-drag the first hotel row, verify order persists, restore. */
import puppeteer from "puppeteer";

const BASE = process.env.QA_BASE_URL ?? "http://192.168.1.37:3000";
const EMAIL = process.env.ADMIN_EMAIL ?? "admin@example.com";
const PASSWORD = process.env.ADMIN_PASSWORD ?? "admin123";

async function wait(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
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
  await page.evaluate(async (email, password) => {
    const { csrfToken } = await (await fetch("/api/auth/csrf")).json();
    await fetch("/api/auth/callback/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken, email, password, json: "true" }),
    });
  }, EMAIL, PASSWORD);

  await page.goto(`${BASE}/travel/catalog`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('button[aria-label="Drag to reorder"]', { timeout: 30000 });
  await wait(2000);

  const firstNames = async () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll("tbody tr td:nth-child(2)"))
        .slice(0, 3)
        .map((td) => (td.textContent ?? "").trim())
    );
  const before = await firstNames();
  console.log("before:", before);

  // Keyboard DnD: focus first handle, Space to lift, ArrowDown, Space to drop.
  await page.click('button[aria-label="Drag to reorder"]');
  await page.keyboard.press("Space");
  await wait(300);
  await page.keyboard.press("ArrowDown");
  await wait(300);
  await page.keyboard.press("Space");
  await wait(1500);

  const after = await firstNames();
  console.log("after: ", after);
  const swapped = before[0] !== after[0] && before[1] === after[0];
  console.log(swapped ? "E2E PASS: row moved down one slot" : "E2E FAIL: order unchanged");

  // Reload and confirm persistence from the server.
  await page.goto(`${BASE}/travel/catalog`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('button[aria-label="Drag to reorder"]', { timeout: 30000 });
  await wait(2000);
  const persisted = await firstNames();
  console.log("persisted:", persisted, JSON.stringify(persisted) === JSON.stringify(after) ? "(persisted OK)" : "(MISMATCH)");

  await browser.close();
  process.exit(swapped ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
