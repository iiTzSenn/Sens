import table from "./file-icons.json";

const names: Record<string, string> = table.names;
const extensions: Record<string, string> = table.extensions;

// The Material Icon Theme icon for a file, as VS Code picks it: its whole name
// first (package.json, Dockerfile), then its longest extension (d.ts before
// ts), else the plain file. vite.config.ts serves them under /file-icons.
export function fileIcon(path: string) {
  const name = (path.split(/[/\\]/).pop() || path).toLowerCase();
  const icon = names[name] ?? longestExtension(name) ?? table.file;
  return `/file-icons/${icon}.svg`;
}

function longestExtension(name: string) {
  for (let dot = name.indexOf("."); dot !== -1; dot = name.indexOf(".", dot + 1)) {
    const icon = extensions[name.slice(dot + 1)];
    if (icon) return icon;
  }
  return undefined;
}
