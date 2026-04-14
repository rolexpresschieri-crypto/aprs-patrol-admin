/**
 * Windows: soft-clean cartelle legacy (vecchia cache AppData, .next, next-dev-dist, TEMP).
 * Cache attiva `next-cache`: cancellata solo con APRS_CLEAR_PRIMARY_CACHE=1 (Next fermo).
 */
const fs = require("fs");
const path = require("path");
const {
  getLegacyPathsForSoftClear,
  getPrimaryWindowsCacheDir,
} = require("./resolve-win-dist-dir.cjs");

function clearDir(label, dirPath, opts = {}) {
  const soft = Boolean(opts.soft);
  if (!fs.existsSync(dirPath)) {
    return { ok: true, skipped: true };
  }
  try {
    fs.rmSync(dirPath, {
      recursive: true,
      force: true,
      maxRetries: 25,
      retryDelay: 400,
    });
    console.log("Rimossa:", dirPath);
    return { ok: true };
  } catch (first) {
    const parent = path.dirname(dirPath);
    const junk = path.join(
      parent,
      `${path.basename(dirPath)}_stale_${Date.now()}`,
    );
    try {
      fs.renameSync(dirPath, junk);
      console.log("Nota:", label, "rinominata in", path.basename(junk));
      return { ok: true };
    } catch {
      const msg = first && first.message ? first.message : String(first);
      if (soft) {
        console.log("[cache] Saltata", label + ":", "bloccata. Ignorabile.");
        return { ok: true };
      }
      console.error("Impossibile rimuovere o rinominare", label + ":", msg);
      return { ok: false };
    }
  }
}

const root = process.cwd();
let anyFail = false;

if (process.platform === "win32") {
  if (process.env.APRS_CLEAR_PRIMARY_CACHE === "1") {
    const primary = getPrimaryWindowsCacheDir(root);
    const r = clearDir("next-cache (cache attiva)", primary, { soft: false });
    if (!r.ok) {
      anyFail = true;
    }
  }
  for (const p of getLegacyPathsForSoftClear(root)) {
    clearDir(path.basename(p), p, { soft: true });
  }
} else {
  const r = clearDir(".next nella repo", path.join(root, ".next"));
  if (!r.ok) {
    anyFail = true;
  }
}

process.exit(anyFail ? 1 : 0);
