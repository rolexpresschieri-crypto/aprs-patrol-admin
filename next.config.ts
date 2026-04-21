import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

const configDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Su Windows default `next-cache` (nel repo): Next.js **non** supporta distDir fuori progetto
 * (docs) → evita ENOTEMPTY / rmdir su `dev/types` e moduli mancanti.
 * Riduce lock rispetto a `.next` se combinato con .cursorignore / esclusione Defender.
 */
const WIN_DIST_DEFAULT = "next-cache";

function resolveDistDir(): string | undefined {
  const rawEnv = process.env.NEXT_DIST_DIR?.trim();

  if (rawEnv) {
    if (path.isAbsolute(rawEnv)) {
      const rel = path.relative(configDir, path.normalize(rawEnv));
      if (process.platform === "win32" && (path.isAbsolute(rel) || !rel)) {
        console.warn(
          "[next.config] NEXT_DIST_DIR assoluto fuori dal progetto: uso next-cache.",
        );
        return WIN_DIST_DEFAULT;
      }
      return rel || WIN_DIST_DEFAULT;
    }
    return rawEnv;
  }

  if (process.platform === "win32") {
    return WIN_DIST_DEFAULT;
  }

  return undefined;
}

const distDir = resolveDistDir();

const nextConfig: NextConfig = {
  turbopack: {
    root: configDir,
  },
  ...(distDir ? { distDir } : {}),
  async headers() {
    return [
      {
        source: "/",
        headers: [
          {
            key: "Cache-Control",
            value: "private, no-store, max-age=0, must-revalidate",
          },
        ],
      },
      {
        source: "/map-fullscreen",
        headers: [
          {
            key: "Cache-Control",
            value: "private, no-store, max-age=0, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
