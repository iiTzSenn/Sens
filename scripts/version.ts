import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = path.join(root, "rust", "sens-app");
const read = (file: string) => readFileSync(path.join(app, file), "utf8");

export function versions(): Record<string, string> {
  return {
    "rust/sens-app/Cargo.toml": packageVersion(read("Cargo.toml")),
    "rust/sens-app/Cargo.lock": read("Cargo.lock").match(/^name = "sens-app"\r?\nversion = "([^"]+)"/m)?.[1] ?? "",
    "rust/sens-app/tauri.conf.json": JSON.parse(read("tauri.conf.json")).version ?? "",
  };
}

function packageVersion(manifest: string) {
  let section = "";
  for (const line of manifest.split(/\r?\n/)) {
    const heading = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (heading) section = heading[1];
    const version = line.match(/^\s*version\s*=\s*"([^"]+)"/);
    if (section === "package" && version) return version[1];
  }
  return "";
}

export function disagreement(tag = ""): string[] {
  const found = versions();
  const named = Object.values(found);
  const faults = named.every((one) => one && one === named[0]) ? [] : Object.entries(found).map(([file, one]) => `${file}: ${one || "sin versión"}`);
  if (tag && !faults.length && tag !== `v${named[0]}`) faults.push(`la etiqueta ${tag} no es v${named[0]}`);
  return faults;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const tag = process.argv[2] ?? "";
  const faults = disagreement(tag);
  if (faults.length) {
    console.error("la versión de Sens no es la misma en todas partes:");
    for (const fault of faults) console.error(`  ${fault}`);
    process.exit(1);
  }
  console.log(`versión ${versions()["rust/sens-app/Cargo.toml"]}${tag ? ` · ${tag}` : ""}`);
}
