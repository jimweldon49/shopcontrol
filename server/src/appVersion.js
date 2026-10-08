const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// Version of the employee app's files, so open phones can tell a deploy happened
// and reload (client/mobile/update.js). Built from file sizes and modified times,
// so copying new files onto the server changes it without a restart.
const CLIENT = path.join(__dirname, "..", "..", "client");
const SHARED = ["shared.js", "qcChecklists.js"].map((f) => path.join(CLIENT, f));

let cached = null, cachedAt = 0;
function mobileVersion() {
  if (cached && Date.now() - cachedAt < 10000) return cached;
  const dir = path.join(CLIENT, "mobile");
  const files = [...fs.readdirSync(dir).sort().map((f) => path.join(dir, f)), ...SHARED];
  const hash = crypto.createHash("sha1");
  for (const f of files) {
    try { const s = fs.statSync(f); if (s.isFile()) hash.update(`${path.basename(f)}:${s.size}:${s.mtimeMs}\n`); } catch (_) {}
  }
  cached = hash.digest("hex").slice(0, 12);
  cachedAt = Date.now();
  return cached;
}

// Cloudflare overrides our Cache-Control on .js/.css and lets browsers keep them for
// hours, so a phone could get a new page with an old script (new buttons that do
// nothing). Pages are sent with each local script/stylesheet stamped ?v=<its own
// size and modified time>, so any changed file gets a new address.
const ASSET = /(<(?:script|link)\b[^>]*?\s(?:src|href)=")([^":?#]+\.(?:js|css))(")/g;
const pages = new Map(); // file -> { html, at }
function fileStamp(f) {
  try { const s = fs.statSync(f); return crypto.createHash("sha1").update(`${s.size}:${s.mtimeMs}`).digest("hex").slice(0, 10); }
  catch (_) { return null; }
}
function versionedPage(file) {
  const hit = pages.get(file);
  if (hit && Date.now() - hit.at < 10000) return hit.html;
  const dir = path.dirname(file);
  const html = fs.readFileSync(file, "utf8").replace(ASSET, (m, pre, src, post) => {
    const stamp = fileStamp(src.startsWith("/") ? path.join(CLIENT, src) : path.resolve(dir, src));
    return stamp ? `${pre}${src}?v=${stamp}${post}` : m;
  });
  pages.set(file, { html, at: Date.now() });
  return html;
}

module.exports = { mobileVersion, versionedPage, CLIENT };
