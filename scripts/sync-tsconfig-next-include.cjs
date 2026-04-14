/**
 * Su Windows allinea tsconfig + next-env.d.ts al distDir (`next-cache` nel repo).
 * Eseguito da `npm run dev` / `prebuild`.
 */
const fs = require("fs");
const path = require("path");
const { getWinDistRelativeFromProject } = require("./resolve-win-dist-dir.cjs");

function toPosix(p) {
  return p.split(path.sep).join("/");
}

const defaultInclude = [
  "next-env.d.ts",
  "**/*.ts",
  "**/*.tsx",
  ".next/types/**/*.ts",
  ".next/dev/types/**/*.ts",
  "**/*.mts",
];

function main() {
  const root = process.cwd();
  const tsconfigPath = path.join(root, "tsconfig.json");
  const envPath = path.join(root, "next-env.d.ts");
  const ts = JSON.parse(fs.readFileSync(tsconfigPath, "utf8"));

  if (process.platform !== "win32") {
    ts.include = [...defaultInclude];
    fs.writeFileSync(tsconfigPath, JSON.stringify(ts, null, 2) + "\n", "utf8");
    return;
  }

  const rel = getWinDistRelativeFromProject(root);
  const posix = toPosix(rel);
  ts.include = [
    ...defaultInclude.slice(0, 5),
    `${posix}/types/**/*.ts`,
    `${posix}/dev/types/**/*.ts`,
    defaultInclude[5],
  ];
  fs.writeFileSync(tsconfigPath, JSON.stringify(ts, null, 2) + "\n", "utf8");
  console.log("[sync-tsconfig] include →", `${posix}/… (cartella nel progetto)`);

  if (fs.existsSync(envPath)) {
    let env = fs.readFileSync(envPath, "utf8");
    const importLine = `import "./${posix}/dev/types/routes.d.ts";`;
    if (/import\s+["'][^"']*routes\.d\.ts["'];?/m.test(env)) {
      env = env.replace(
        /import\s+["'][^"']*routes\.d\.ts["'];?/m,
        importLine,
      );
      fs.writeFileSync(envPath, env, "utf8");
    }
  }
}

main();
