// Patches whatsapp-web.js' injected getChats() to tolerate individual chat
// models that fail to serialize on newer WhatsApp Web versions. With
// Promise.all, a single bad model rejects the whole page evaluation, which
// surfaces as the minified "r: r" error (upstream wwebjs#201845 / #201838).
// Runs at container start from docker-entrypoint.sh; idempotent and non-fatal.
const fs = require("fs");
const path = require("path");

const target = path.join(
  __dirname,
  "..",
  "node_modules",
  "whatsapp-web.js",
  "src",
  "util",
  "Injected",
  "Utils.js"
);

const BEFORE = "return await Promise.all(chatPromises);";
const AFTER =
  "return (await Promise.allSettled(chatPromises))" +
  ".filter((result) => result.status === 'fulfilled')" +
  ".map((result) => result.value);";

try {
  const src = fs.readFileSync(target, "utf8");
  if (src.includes(AFTER)) {
    console.log("[patch-wwebjs] getChats already patched");
  } else if (src.includes(BEFORE)) {
    fs.writeFileSync(target, src.replace(BEFORE, AFTER));
    console.log("[patch-wwebjs] patched getChats: Promise.all -> allSettled");
  } else {
    console.warn("[patch-wwebjs] pattern not found in Utils.js, skipping");
  }
} catch (e) {
  console.warn("[patch-wwebjs] failed (non-fatal):", e.message);
}
