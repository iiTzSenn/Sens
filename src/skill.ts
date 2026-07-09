/**
 * The Sens usage guidance, in two shapes from one source:
 *  - `SKILL_MD` — the Claude Code skill (YAML frontmatter + guide), loaded on demand.
 *  - `sensInstructions(rules)` — the same guide + a rules document, written into any
 *    other agent's instructions file (AGENTS.md, copilot-instructions.md, .cursorrules)
 *    by `sens init --agent`.
 *
 * Single source of truth: the command table lives here once; the working rules come
 * from `rules.ts`. The skill ships the default rules; per-agent instructions get the
 * project's *active* rules (config-resolved).
 */
import { AGENT_RULES } from "./rules.js";

/** Directory/skill name under `.claude/skills/`. */
export const SKILL_NAME = "sens";

const DESCRIPTION =
  "This project is indexed by sens. Query the code with the sens CLI instead of reading or grepping files — find where a symbol is defined and every place it is used, get a file's outline or the project map, trace a function's callers and callees, check whether something already exists before writing it, and list dead code. Prefer sens before Grep, before reading whole files, and before adding new code.";

/** The command table shared by the skill and every agent's instructions file. */
const GUIDE = `# sens — query the code index instead of reading the whole repo

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
\`dead_code\`, …) are these same commands — run each via its \`sens\` verb from the table.`;

/** The full guidance body: the usage table plus a rules document. */
export function sensInstructions(rulesDoc: string): string {
  return `${GUIDE}\n\n---\n\n${rulesDoc}`;
}

/** The Claude Code skill (frontmatter + guide + the default rules), ready to write. */
export const SKILL_MD = `---
name: ${SKILL_NAME}
description: ${DESCRIPTION}
---

${sensInstructions(AGENT_RULES)}
`;
