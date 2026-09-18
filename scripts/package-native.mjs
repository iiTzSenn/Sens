import { mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "package.json");
const pkg = JSON.parse(readFileSync(manifestPath, "utf8"));

const PLATFORMS = {
  "win32-x64": { os: "win32", cpu: "x64", target: "x86_64-pc-windows-msvc" },
  "win32-arm64": { os: "win32", cpu: "arm64", target: "aarch64-pc-windows-msvc" },
  "darwin-x64": { os: "darwin", cpu: "x64", target: "x86_64-apple-darwin" },
  "darwin-arm64": { os: "darwin", cpu: "arm64", target: "aarch64-apple-darwin" },
  "linux-x64": { os: "linux", cpu: "x64", target: "x86_64-unknown-linux-gnu" },
  "linux-arm64": { os: "linux", cpu: "arm64", target: "aarch64-unknown-linux-gnu" },
};

function syncManifest() {
  const optional = {};
  for (const name of Object.keys(PLATFORMS)) optional["@sens-mcp/" + name] = pkg.version;
  pkg.optionalDependencies = optional;
  writeFileSync(manifestPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`  package.json: ${Object.keys(optional).length} optionalDependencies @ ${pkg.version}`);
}

if (process.argv.includes("--manifest-only")) {
  syncManifest();
  process.exit(0);
}

const platform = process.argv[2] ?? `${process.platform}-${process.arch}`;
const spec = PLATFORMS[platform];
if (!spec) {
  console.error(`plataforma desconocida: ${platform}`);
  console.error(`conocidas: ${Object.keys(PLATFORMS).join(", ")}`);
  process.exit(1);
}

const binaryName = spec.os === "win32" ? "sens-hook.exe" : "sens-hook";
const built = process.argv[3] && !process.argv[3].startsWith("--")
  ? process.argv[3]
  : path.join(root, "rust", "sens-hook", "target", "release", binaryName);

if (!existsSync(built)) {
  console.error(`no existe el binario: ${built}`);
  console.error("compílalo con: cargo build --release --manifest-path rust/sens-hook/Cargo.toml");
  process.exit(1);
}

const outDir = path.join(root, "npm", platform);
mkdirSync(outDir, { recursive: true });

writeFileSync(
  path.join(outDir, "package.json"),
  JSON.stringify(
    {
      name: `@sens-mcp/${platform}`,
      version: pkg.version,
      description: `Native sens hook for ${platform}.`,
      license: pkg.license,
      os: [spec.os],
      cpu: [spec.cpu],
      files: [binaryName],
    },
    null,
    2,
  ) + "\n",
);

const target = path.join(outDir, binaryName);
copyFileSync(built, target);
if (spec.os !== "win32") chmodSync(target, 0o755);

writeFileSync(
  path.join(outDir, "README.md"),
  `# @sens-mcp/${platform}\n\nPlatform binary for [sens-mcp](https://www.npmjs.com/package/sens-mcp).\nInstalled automatically as an optional dependency; do not depend on it directly.\n`,
);

console.log(`  npm/${platform}/  (${binaryName}, ${spec.target})`);

if (process.argv.includes("--sync-manifest")) syncManifest();
