// Runtime patches for whatsapp-web.js' injected Utils.js, applied at container
// start from docker-entrypoint.sh. Each patch is an exact-string rewrite:
// idempotent, warn-skip when the anchor is missing, non-fatal.
//
// 1. getChats(): tolerate individual chat models that fail to serialize on
//    newer WhatsApp Web versions. With Promise.all, a single bad model rejects
//    the whole page evaluation, surfacing as the minified "r: r" error
//    (upstream wwebjs#201845 / #201838).
// 2. sendMessage(): MediaData model internals (__x_id, and id from
//    mediaOptions.toJSON()) are enumerable, so spreading mediaOptions into the
//    outgoing message object overwrites the freshly-built `id: newMsgKey`.
//    WA Web's Msg init then receives no proper id and its memoize getter
//    throws "Data passed to getter must include an id property ... got
//    undefined" — breaking every media (PDF/image) send while text sends keep
//    working (upstream wwebjs#201921/#201922; fix PRs #201923/#201925).
//    Restoring the id after the spread repairs media sends.
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

function applyPatch(src, name, before, after, marker) {
  if (src.includes(marker)) {
    console.log(`[patch-wwebjs] ${name} already patched`);
    return src;
  }
  if (!src.includes(before)) {
    console.warn(`[patch-wwebjs] ${name}: pattern not found in Utils.js, skipping`);
    return src;
  }
  console.log(`[patch-wwebjs] patched ${name}`);
  return src.replace(before, after);
}

const GET_CHATS_BEFORE = "return await Promise.all(chatPromises);";
const GET_CHATS_AFTER =
  "return (await Promise.allSettled(chatPromises))" +
  ".filter((result) => result.status === 'fulfilled')" +
  ".map((result) => result.value);";

const MEDIA_ID_ANCHOR = "        // Bot's won't reply if canonicalUrl is set (linking)";
const MEDIA_ID_AFTER =
  "        // MediaData model internals (__x_id / serialized id) overwrite Msg's id when\n" +
  "        // mediaOptions is spread into the outgoing message (wwebjs#201921/#201923).\n" +
  "        delete message.__x_id;\n" +
  "        message.id = newMsgKey;\n" +
  "\n" +
  MEDIA_ID_ANCHOR;

try {
  let src = fs.readFileSync(target, "utf8");
  const patched =
    applyPatch(src, "getChats: Promise.all -> allSettled", GET_CHATS_BEFORE, GET_CHATS_AFTER, GET_CHATS_AFTER);
  const patched2 =
    applyPatch(patched, "sendMessage media id (wwebjs#201921)", MEDIA_ID_ANCHOR, MEDIA_ID_AFTER, "delete message.__x_id;");
  if (patched2 !== src) fs.writeFileSync(target, patched2);
} catch (e) {
  console.warn("[patch-wwebjs] failed (non-fatal):", e.message);
}
