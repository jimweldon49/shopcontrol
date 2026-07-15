const fs = require("fs");
const path = require("path");
const { importEmsFiles } = require("./routes/import");

const EMS_EXTENSIONS = new Set([
  ".env", ".ad1", ".ad2", ".ad3", ".veh", ".lin", ".ttl", ".stl", ".dbt",
  ".ven", ".pfh", ".pfl", ".pfm", ".pfo", ".pfp", ".pft"
]);

let timer = null;
let running = false;
const recentlyProcessed = new Set();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function ensureDir(dir) {
  await fs.promises.mkdir(dir, { recursive: true });
}

function isEmsFile(fileName) {
  return EMS_EXTENSIONS.has(path.extname(fileName).toLowerCase());
}

function prefixOf(fileName) {
  return path.basename(fileName, path.extname(fileName));
}

async function fileStable(filePath, delayMs) {
  try {
    const first = await fs.promises.stat(filePath);
    await sleep(delayMs);
    const second = await fs.promises.stat(filePath);
    return first.size === second.size && first.mtimeMs === second.mtimeMs;
  } catch (_) {
    return false;
  }
}

async function listGroups(watchDir) {
  const entries = await fs.promises.readdir(watchDir, { withFileTypes: true });
  const groups = new Map();

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!isEmsFile(entry.name)) continue;

    const prefix = prefixOf(entry.name);
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix).push(path.join(watchDir, entry.name));
  }

  return groups;
}

async function archiveFiles(files, archiveRoot, prefix) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archiveDir = path.join(archiveRoot, `${prefix}-${stamp}`);
  await ensureDir(archiveDir);

  for (const filePath of files) {
    const dest = path.join(archiveDir, path.basename(filePath));
    try {
      await fs.promises.rename(filePath, dest);
    } catch (err) {
      // Cross-device fallback.
      await fs.promises.copyFile(filePath, dest);
      await fs.promises.unlink(filePath);
    }
  }

  return archiveDir;
}

async function moveToError(files, errorRoot, prefix, error) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const errorDir = path.join(errorRoot, `${prefix}-${stamp}`);
  await ensureDir(errorDir);

  await fs.promises.writeFile(
    path.join(errorDir, "import-error.txt"),
    error && error.stack ? error.stack : String(error || "Unknown error"),
    "utf8"
  );

  for (const filePath of files) {
    const dest = path.join(errorDir, path.basename(filePath));
    try {
      await fs.promises.rename(filePath, dest);
    } catch (_) {
      try {
        await fs.promises.copyFile(filePath, dest);
        await fs.promises.unlink(filePath);
      } catch (copyErr) {
        console.error("Could not move EMS error file:", filePath, copyErr.message);
      }
    }
  }

  return errorDir;
}

async function runOnce() {
  if (running) return;
  running = true;

  const watchDir = process.env.EMS_WATCH_DIR;
  const archiveRoot = process.env.EMS_ARCHIVE_DIR || (watchDir ? path.join(watchDir, "_processed") : "");
  const errorRoot = process.env.EMS_ERROR_DIR || (watchDir ? path.join(watchDir, "_error") : "");
  const stableMs = Number(process.env.EMS_FILE_STABLE_MS || 5000);
  const requireEnv = String(process.env.EMS_REQUIRE_ENV || "true").toLowerCase() === "true";

  try {
    if (!watchDir) return;
    await ensureDir(archiveRoot);
    await ensureDir(errorRoot);

    const groups = await listGroups(watchDir);

    for (const [prefix, files] of groups.entries()) {
      if (recentlyProcessed.has(prefix)) continue;

      const hasEnv = files.some(file => path.extname(file).toLowerCase() === ".env");
      if (requireEnv && !hasEnv) continue;

      const stability = await Promise.all(files.map(file => fileStable(file, stableMs)));
      if (!stability.every(Boolean)) continue;

      recentlyProcessed.add(prefix);
      setTimeout(() => recentlyProcessed.delete(prefix), 10 * 60 * 1000);

      const uploadFiles = await Promise.all(files.map(async filePath => ({
        originalname: path.basename(filePath),
        buffer: await fs.promises.readFile(filePath),
      })));

      try {
        const summary = await importEmsFiles(uploadFiles, {
          id: null,
          username: "ems-auto-import",
          fullName: "EMS Auto Import",
          role: "system",
          canDelete: false,
        });

        const archiveDir = await archiveFiles(files, archiveRoot, prefix);
        await fs.promises.writeFile(
          path.join(archiveDir, "import-summary.json"),
          JSON.stringify(summary, null, 2),
          "utf8"
        );

        console.log(`EMS auto import complete for ${prefix}:`, summary.result && summary.result.ro_number);
      } catch (err) {
        console.error(`EMS auto import failed for ${prefix}:`, err);
        await moveToError(files, errorRoot, prefix, err);
      }
    }
  } catch (err) {
    console.error("EMS watcher scan failed:", err);
  } finally {
    running = false;
  }
}

function startEmsWatcher() {
  const enabled = String(process.env.EMS_WATCH_ENABLED || "false").toLowerCase() === "true";
  const watchDir = process.env.EMS_WATCH_DIR;
  if (!enabled || !watchDir) {
    console.log("EMS auto import watcher disabled.");
    return;
  }

  const intervalMs = Number(process.env.EMS_WATCH_INTERVAL_MS || 30000);

  console.log(`EMS auto import watcher enabled: ${watchDir}`);
  runOnce();
  timer = setInterval(runOnce, intervalMs);
}

function stopEmsWatcher() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { startEmsWatcher, stopEmsWatcher, runOnce };
