import path from "node:path";

/** Project-root-relative path in POSIX form (stable across OSes). */
export function rel(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join("/");
}

export function sensDir(root: string): string {
  return path.join(root, ".sens");
}

export function indexPath(root: string): string {
  return path.join(root, ".sens", "index.json");
}
