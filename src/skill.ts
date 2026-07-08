/**
 * The Sens skill: an on-demand replacement for the always-loaded MCP tool
 * schemas. A skill's body only enters the model's context when relevant, so the
 * usage guidance costs nothing on turns that don't touch code.
 *
 * Single source of truth: the workflow rules come from `AGENT_RULES` (the same
 * text the MCP server and `sens rules` use); this module only adds the table that
 * maps each operation to its `sens` CLI command. `sens skill` prints/writes it and
 * `sens init` installs it into a project's `.claude/skills/`.
 */
import { AGENT_RULES } from "./rules.js";

/** Directory/skill name under `.claude/skills/`. */
export const SKILL_NAME = "sens";

/** The full SKILL.md (YAML frontmatter + body), ready to write to disk. */
export const SKILL_MD = `---
name: sens
description: This project is indexed by sens. Query the code with the sens CLI instead of reading or grepping files — find where a symbol is defined and every place it is used, get a file's outline or the project map, trace a function's callers and callees, check whether something already exists before writing it, and list dead code. Prefer sens before Grep, before reading whole files, and before adding new code.
---

# sens — query the code index instead of reading the whole repo

This project is indexed by **sens**. For any structural question about the code, run
the \`sens\` CLI: it answers in one command and a fraction of the tokens that grepping
or reading whole files would cost. Reach for it *before* Grep, *before* reading a file
end-to-end, and *before* writing new code.

If \`sens\` is not on PATH, run \`node <install-path>/dist/cli.js\` with the same arguments.

| You are about to… | Run instead | You get |
|---|---|---|
| grep for where something is defined | \`sens find <name>\` | file:line + signature |
| grep for who uses something | \`sens who <name>\` (add \`--full\` before a rename) | every call site |
| read a whole file to see its shape | \`sens outline <file>\` | signatures, no bodies |
| explore the folder tree | \`sens map [subdir]\` | files + their exported symbols |
| understand how a function fits | \`sens explain <name>\` | its callers and callees |
| ask "how does X reach Y" | \`sens path <from> <to>\` | the shortest call chain |
| find files related to one file | \`sens deps <file>\` | its imports and importers |
| write a new function/type/helper | \`sens exists <keywords>\` | existing symbols to reuse |
| clean up after a change | \`sens dead-code [subdir]\` | unused-symbol candidates |

The operations named in the rules below (\`find_symbol\`, \`who_uses\`, \`already_exists\`,
\`dead_code\`, …) are these same commands — run each via its \`sens\` verb from the table.

---

${AGENT_RULES}
`;
