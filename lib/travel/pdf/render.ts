/**
 * PDF rendering for travel quotations via a dedicated headless Chromium.
 *
 * The browser instance is separate from the WhatsApp puppeteer client and is
 * cached on globalThis (not module scope) because the custom server and the
 * Next.js API routes load this module through different bundlers — the same
 * dual-instance pitfall documented for lib/whatsapp.ts.
 */
import crypto from "node:crypto";
import puppeteer, { type Browser } from "puppeteer";
import { buildHtmlForKind } from "./templates";
import type { QuotationPdfInput } from "./types";

const LOG = "[Travel PDF]";

type GlobalWithPdfBrowser = typeof globalThis & {
  __travelPdfBrowser?: Promise<Browser>;
};

function launchBrowser(): Promise<Browser> {
  return puppeteer.launch({
    headless: true,
    // System Chromium path is provided in Docker; locally puppeteer's own
    // bundled Chromium is used when the env var is absent. TRAVEL_PDF_EXECUTABLE_PATH
    // overrides independently when the bundled Chromium is broken but the WhatsApp
    // client must keep using its own executable (e.g. macOS bundled-Chromium crashes).
    executablePath:
      process.env.TRAVEL_PDF_EXECUTABLE_PATH ||
      process.env.PUPPETEER_EXECUTABLE_PATH ||
      undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
}

async function getBrowser(): Promise<Browser> {
  const g = globalThis as GlobalWithPdfBrowser;
  if (g.__travelPdfBrowser) {
    const browser = await g.__travelPdfBrowser.catch(() => null);
    if (browser && browser.connected) return browser;
    // Previous launch failed or the browser died — drop the stale promise so
    // this caller (and later ones) retry with a fresh launch.
    g.__travelPdfBrowser = undefined;
  }
  const promise = launchBrowser();
  g.__travelPdfBrowser = promise;
  promise.catch(() => {
    if (g.__travelPdfBrowser === promise) g.__travelPdfBrowser = undefined;
  });
  await promise;
  console.log(`${LOG} Browser launched`);
  return promise;
}

/** Close the cached browser, if any. Used by tests and clean shutdown. */
export async function shutdownTravelPdfRenderer(): Promise<void> {
  const g = globalThis as GlobalWithPdfBrowser;
  const promise = g.__travelPdfBrowser;
  g.__travelPdfBrowser = undefined;
  if (!promise) return;
  const browser = await promise.catch(() => null);
  if (browser && browser.connected) {
    await browser.close();
    console.log(`${LOG} Browser closed`);
  }
}

/** HTML for a given input without launching a browser (tests / previews). */
export function renderHtmlForPreview(input: QuotationPdfInput): string {
  return buildHtmlForKind(input);
}

export async function renderQuotationPdf(input: QuotationPdfInput): Promise<Buffer> {
  const html = buildHtmlForKind(input);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "15mm", right: "14mm", bottom: "16mm", left: "14mm" },
      // Chromium ignores CSS @page margin boxes, so real page numbers come
      // from the header/footer templates (pageNumber/totalPages classes).
      displayHeaderFooter: true,
      headerTemplate: `<span></span>`,
      footerTemplate: `
        <div style="width: 100%; font-size: 8px; color: #777; padding: 0 14mm; text-align: right;
                    font-family: 'DejaVu Sans', 'Noto Sans', Arial, sans-serif;">
          ${escapeForFooter(input.packageCode)} ${escapeForFooter(input.versionLabel)} —
          Page <span class="pageNumber"></span> / <span class="totalPages"></span>
        </div>`,
    });
    console.log(
      `${LOG} Rendered ${input.packageCode} ${input.versionLabel} (${input.kind}${input.draft ? ", draft" : ""}) — ${pdf.length} bytes`,
    );
    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => {});
  }
}

/** Footer templates are HTML too — keep injected codes safe. */
function escapeForFooter(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function sha256Buffer(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}
