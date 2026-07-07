import type { LanguageParser } from "./parser.js";
import { buildTreeSitter } from "./treesitter/base.js";
import { cFamilyExtract } from "./treesitter/cfamily.js";

export const cppParser: LanguageParser = {
  name: "cpp",
  // `.h` is parsed as C++ (a superset of C) so class-in-header declarations are
  // captured; pure-C `.c` files are handled by the dedicated C parser.
  extensions: ["cpp", "cxx", "cc", "hpp", "hh", "hxx", "h"],
  build: (root, files) =>
    buildTreeSitter(root, files, "cpp", (r, emit, ctx) => cFamilyExtract(r, emit, ctx, { cpp: true })),
};
