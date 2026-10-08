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

module.exports = { mobileVersion };
