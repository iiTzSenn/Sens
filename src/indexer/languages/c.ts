import type { LanguageParser } from "./parser.js";
import { buildTreeSitter } from "./treesitter/base.js";
import { cFamilyExtract } from "./treesitter/cfamily.js";

export const cParser: LanguageParser = {
  name: "c",
  extensions: ["c"],
  build: (root, files) =>
    buildTreeSitter(root, files, "c", (r, emit, ctx) => cFamilyExtract(r, emit, ctx, { cpp: false })),
};
