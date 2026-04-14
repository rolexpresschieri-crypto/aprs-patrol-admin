/**
 * distDir Windows di default: **dentro il repo** (`next-cache`).
 * Next.js richiede che distDir non esca dalla root progetto (evita ENOTEMPTY / rmdir su Win).
 */
const path = require("path");
const os = require("os");

const WIN_DIST_DEFAULT = "next-cache";
const LEGACY_APPDATA_CACHE = "aprs-patrol-admin-next";

function getWinDistRelativeFromProject(projectRoot) {
  const raw = process.env.NEXT_DIST_DIR?.trim();
  if (raw) {
    if (path.isAbsolute(raw)) {
      const rel = path.relative(projectRoot, path.normalize(raw));
      if (!rel || path.isAbsolute(rel)) {
        return WIN_DIST_DEFAULT;
      }
      return rel;
    }
    return raw;
  }
  if (process.platform === "win32") {
    return WIN_DIST_DEFAULT;
  }
  return ".next";
}

function getLegacyPathsForSoftClear(projectRoot) {
  const localApp =
    process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return [
    path.join(os.homedir(), ".cache", "aprs-patrol-admin"),
    path.join(projectRoot, "next-dev-dist"),
    path.join(projectRoot, ".next"),
    path.join(os.tmpdir(), LEGACY_APPDATA_CACHE),
    path.join(localApp, LEGACY_APPDATA_CACHE),
  ];
}

function getPrimaryWindowsCacheDir(projectRoot) {
  return path.join(projectRoot, getWinDistRelativeFromProject(projectRoot));
}

module.exports = {
  WIN_DIST_DEFAULT,
  LEGACY_APPDATA_CACHE,
  getWinDistRelativeFromProject,
  getLegacyPathsForSoftClear,
  getPrimaryWindowsCacheDir,
};
