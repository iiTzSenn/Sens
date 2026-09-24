// Writes src/shared/file-icons.json: which Material Icon Theme icon each file
// name and extension gets, from the version installed. Run it after upgrading
// material-icon-theme; vite.config.ts ships the SVGs the table names.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
const require = createRequire(import.meta.url);
const theme = path.dirname(require.resolve("material-icon-theme/package.json"));
const { version } = JSON.parse(readFileSync(path.join(theme, "package.json"), "utf8"));
const manifest = JSON.parse(readFileSync(path.join(theme, "dist", "material-icons.json"), "utf8"));

// Names and extensions match whatever their case, as in VS Code; the first
// spelling of a name wins.
function lowered(table) {
  const out = {};
  for (const key of Object.keys(table).sort()) {
    const lower = key.toLowerCase();
    if (!(lower in out) && manifest.iconDefinitions[table[key]]) out[lower] = table[key];
  }
  return out;
}

const table = {
  version,
  file: manifest.file,
  names: lowered(manifest.fileNames),
  extensions: lowered(manifest.fileExtensions),
};

const target = path.join(here, "..", "src", "shared", "file-icons.json");
writeFileSync(target, `${JSON.stringify(table, null, 1)}\n`);
const icons = new Set([table.file, ...Object.values(table.names), ...Object.values(table.extensions)]);
console.log(`material-icon-theme ${version}: ${Object.keys(table.names).length} names, ${Object.keys(table.extensions).length} extensions, ${icons.size} icons`);
