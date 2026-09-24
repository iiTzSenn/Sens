// Writes src/shared/syntax/languages.json: which Shiki grammar each file name,
// extension, code fence tag and shebang gets. GitHub Linguist knows which files
// are which language; Shiki carries the grammars VS Code colors them with. Run
// it after upgrading shiki or linguist-languages.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { bundledLanguages, bundledLanguagesInfo } from "shiki/langs";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
const require = createRequire(import.meta.url);
const { version } = JSON.parse(readFileSync(require.resolve("shiki/package.json"), "utf8"));
// linguist-languages exports no package.json: it sits beside its index.js.
const linguistHome = path.dirname(require.resolve("linguist-languages"));
const linguistVersion = JSON.parse(readFileSync(path.join(linguistHome, "package.json"), "utf8")).version;
const linguist = Object.values(require("linguist-languages"));

// Where Linguist's name, aliases and TextMate scope do not lead to the grammar
// VS Code would use.
const CHOSEN = {
  "C++": "cpp",
  "Objective-C++": "objective-cpp",
  "JSON with Comments": "jsonc",
  "Git Config": "ini",
  "Ignore List": null,
  "Text": null,
  "Markdown": "markdown",
  "Vim Script": "viml",
  "Shell": "shellscript",
  "ShellSession": "shellsession",
  "Batchfile": "bat",
  "Makefile": "make",
  "HTML+ERB": "erb",
  "Jupyter Notebook": "json",
  "SVG": "xml",
  "Gradle": "groovy",
  "Gradle Kotlin DSL": "kotlin",
  "Cuda": "cpp",
  "Metal": "cpp",
  "HIP": "cpp",
  "Cython": "python",
  "Visual Basic .NET": "vb",
  "VBScript": "vb",
  "Mustache": "handlebars",
  "Nunjucks": "jinja",
  "Processing": "java",
};

// Extensions several grammars claim, settled as VS Code opens them; null
// leaves the ones too ambiguous to guess uncolored.
const CLAIMED = {
  cake: "csharp",
  cls: "latex",
  cp: "cpp",
  cs: "csharp",
  csl: "xml",
  d: "d",
  ddl: "sql",
  es: "javascript",
  fcgi: null,
  frag: "glsl",
  fs: "fsharp",
  gs: "javascript",
  h: "cpp",
  hh: "cpp",
  inc: null,
  jsx: "jsx",
  log: "log",
  m: "objective-c",
  mm: "objective-cpp",
  mojo: "mojo",
  php: "php",
  pl: "perl",
  pm: "perl",
  pp: "puppet",
  prc: "sql",
  pro: null,
  rs: "rust",
  sch: null,
  shader: "shaderlab",
  spec: null,
  sql: "sql",
  t: "perl",
  trigger: null,
  ts: "typescript",
  tsx: "tsx",
  typ: "typst",
  v: "verilog",
  vhost: "apache",
  workflow: null,
};

const known = new Map();
for (const info of bundledLanguagesInfo) {
  for (const name of [info.id, ...(info.aliases ?? [])]) known.set(name.toLowerCase(), info.id);
}
const scopes = new Map();
for (const info of bundledLanguagesInfo) {
  const grammars = (await bundledLanguages[info.id]()).default;
  const own = grammars.find((grammar) => grammar.name === info.id) ?? grammars.at(-1);
  scopes.set(own.scopeName, info.id);
}

for (const grammar of Object.values(CHOSEN)) {
  if (grammar && !known.has(grammar)) throw new Error(`shiki has no ${grammar} grammar`);
}

function grammarOf(language) {
  if (language.name in CHOSEN) return CHOSEN[language.name];
  const names = [language.name, language.name.replace(/\s+/g, "-"), ...(language.aliases ?? [])];
  for (const name of names) if (known.has(name.toLowerCase())) return known.get(name.toLowerCase());
  return scopes.get(language.tmScope) ?? null;
}

const grammars = new Map(linguist.map((language) => [language.name, grammarOf(language)]));
// A language with no grammar of its own borrows its group's (Linguist's "HTML+ERB" is HTML).
for (const language of linguist) {
  if (!grammars.get(language.name) && language.group && !(language.name in CHOSEN)) {
    grammars.set(language.name, grammars.get(language.group) ?? null);
  }
}

// An extension first listed by a language is its own; otherwise the first
// claim, by Linguist's order, wins, unless CLAIMED settles it.
const extensions = {};
const primary = {};
const names = {};
const aliases = {};
const interpreters = {};
const conflicts = [];
for (const language of linguist) {
  const grammar = grammars.get(language.name);
  if (!grammar) continue;
  (language.extensions ?? []).forEach((dotted, at) => {
    const extension = dotted.slice(1).toLowerCase();
    const mine = at === 0;
    if (extension in extensions && extensions[extension] !== grammar) {
      conflicts.push(`${extension}: ${extensions[extension]} / ${grammar}`);
      if (primary[extension] || !mine) return;
    }
    extensions[extension] = grammar;
    primary[extension] = primary[extension] || mine;
  });
  for (const name of language.filenames ?? []) names[name.toLowerCase()] ??= grammar;
  for (const alias of [language.name, ...(language.aliases ?? [])]) aliases[alias.toLowerCase()] ??= grammar;
  for (const interpreter of language.interpreters ?? []) interpreters[interpreter] ??= grammar;
}
for (const [extension, grammar] of Object.entries(CLAIMED)) {
  if (grammar && !known.has(grammar)) throw new Error(`shiki has no ${grammar} grammar for .${extension}`);
  if (grammar) extensions[extension] = known.get(grammar);
  else delete extensions[extension];
}
for (const [name, id] of known) aliases[name] = id;

const sorted = (table) => Object.fromEntries(Object.entries(table).sort(([one], [two]) => one.localeCompare(two)));
const table = {
  version,
  linguist: linguistVersion,
  names: sorted(names),
  extensions: sorted(extensions),
  aliases: sorted(aliases),
  interpreters: sorted(interpreters),
};

const target = path.join(here, "..", "src", "shared", "syntax", "languages.json");
writeFileSync(target, `${JSON.stringify(table, null, 1)}\n`);
const used = new Set([...Object.values(table.names), ...Object.values(table.extensions)]);
console.log(
  `shiki ${version}, linguist ${linguistVersion}: ${Object.keys(table.names).length} names, ${Object.keys(table.extensions).length} extensions, ` +
    `${Object.keys(table.aliases).length} fence tags, ${used.size} of ${bundledLanguagesInfo.length} grammars`,
);
if (process.argv.includes("--conflicts")) console.log([...new Set(conflicts)].sort().join("\n"));
