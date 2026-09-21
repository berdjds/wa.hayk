import { afterAll, beforeAll, describe, expect, it } from "vitest";
import puppeteer from "puppeteer";
import {
  renderHtmlForPreview,
  renderQuotationPdf,
  sha256Buffer,
  shutdownTravelPdfRenderer,
} from "@/lib/travel/pdf/render";
import { makeFixture } from "./fixture";

// Chromium may not exist in every environment running this suite (CI without
// a browser download, minimal containers). Probe known candidates once; if
// every launch fails, the real-render test reports the reason and passes as
// a no-op instead of failing the whole suite. When a working browser is
// found outside PUPPETEER_EXECUTABLE_PATH, we export it so render.ts's
// launcher picks the same binary — this mirrors how Docker injects the
// system Chromium path.
// puppeteer.executablePath() THROWS when the bundled browser was never
// downloaded (CI uses PUPPETEER_SKIP_CHROMIUM_DOWNLOAD) — probe safely.
function bundledChromePath(): string | undefined {
  try {
    return puppeteer.executablePath();
  } catch {
    return undefined;
  }
}

const CANDIDATE_BROWSERS = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  bundledChromePath(),
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
].filter((p): p is string => !!p);

let browserAvailable = false;
let browserError = "";
let savedExecutablePathEnv: string | undefined;

beforeAll(async () => {
  savedExecutablePathEnv = process.env.PUPPETEER_EXECUTABLE_PATH;
  for (const executablePath of CANDIDATE_BROWSERS) {
    try {
      const probe = await puppeteer.launch({
        headless: true,
        executablePath,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      });
      await probe.close();
      browserAvailable = true;
      process.env.PUPPETEER_EXECUTABLE_PATH = executablePath;
      console.warn(`[Travel PDF test] Using browser at ${executablePath}`);
      break;
    } catch (err) {
      browserError = err instanceof Error ? err.message : String(err);
      console.warn(`[Travel PDF test] ${executablePath} failed: ${browserError.split("\n")[0]}`);
    }
  }
  if (!browserAvailable) {
    console.warn("[Travel PDF test] No working Chromium found; real render will be skipped.");
  }
});

afterAll(async () => {
  await shutdownTravelPdfRenderer();
  if (savedExecutablePathEnv === undefined) delete process.env.PUPPETEER_EXECUTABLE_PATH;
  else process.env.PUPPETEER_EXECUTABLE_PATH = savedExecutablePathEnv;
});

describe("renderQuotationPdf (real Chromium smoke test)", () => {
  it("renders a valid PDF buffer for the fixture", async () => {
    if (!browserAvailable) {
      console.warn(`[Travel PDF test] SKIPPED real render — no Chromium: ${browserError}`);
      return;
    }
    const buf = await renderQuotationPdf(makeFixture({ kind: "CLIENT", draft: true }));
    expect(buf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(10 * 1024);

    const internal = await renderQuotationPdf(makeFixture({ kind: "INTERNAL" }));
    expect(internal.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(internal.length).toBeGreaterThan(10 * 1024);
  });
});

describe("render helpers (no browser needed)", () => {
  it("renderHtmlForPreview returns the same HTML as the template builders", () => {
    const html = renderHtmlForPreview(makeFixture());
    expect(html).toContain("ACME-2026-09-21-0001");
    expect(html).toContain("Option A");
  });

  it("sha256Buffer hashes deterministically", () => {
    const a = sha256Buffer(Buffer.from("hello"));
    const b = sha256Buffer(Buffer.from("hello"));
    expect(a).toBe(b);
    expect(a).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });
});
