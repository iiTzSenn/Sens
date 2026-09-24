import table from "./file-icons.json";

const names: Record<string, string> = table.names;
const extensions: Record<string, string> = table.extensions;

// The Material Icon Theme icon for a file, as VS Code picks it, else the plain
// file. vite.config.ts serves them under /file-icons.
export function fileIcon(path: string) {
  return `/file-icons/${byName(path, names, extensions) ?? table.file}.svg`;
}

// What a table says for a file, as VS Code looks it up: its whole name first
// (package.json, Dockerfile), then its longest extension (d.ts before ts).
export function byName<Value>(path: string, names: Record<string, Value>, extensions: Record<string, Value>) {
  const name = (path.split(/[/\\]/).pop() || path).toLowerCase();
  if (Object.hasOwn(names, name)) return names[name];
  for (let dot = name.indexOf("."); dot !== -1; dot = name.indexOf(".", dot + 1)) {
    const extension = name.slice(dot + 1);
    if (Object.hasOwn(extensions, extension)) return extensions[extension];
  }
  return undefined;
}
