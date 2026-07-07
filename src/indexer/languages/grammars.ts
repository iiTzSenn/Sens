// The tree-sitter grammar WASM basenames Sens ships (matches the `grammar`
// argument each parser passes to buildTreeSitter). Kept dependency-free so the
// build script (tsup.config.ts) can import it to copy the WASM into `dist/`.
export const GRAMMAR_NAMES = [
  "python",
  "go",
  "rust",
  "java",
  "c_sharp",
  "c",
  "cpp",
  "php",
  "ruby",
  "kotlin",
] as const;
