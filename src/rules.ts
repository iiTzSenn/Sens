/**
 * The working rules Sens hands to the model. Single source of truth: the MCP
 * server sends these as its `instructions` (so any project using sens-mcp gets
 * them automatically), and `sens rules` prints/writes the same text for a repo's
 * CLAUDE.md / AGENTS.md. Concrete and imperative on purpose — each rule is tied
 * to the Sens tool that lets the model actually verify it instead of guessing.
 */
export const AGENT_RULES = `# Working rules — follow these whenever you write or change code in this project

Sens indexes this project so you can *verify* these rules instead of guessing. Use it; don't skip the checks.

## Before writing new code — search first, write second
- Before adding any function, component, class, type, constant or helper, call \`already_exists\` with 1-2 distinctive keywords AND \`find_symbol\` for the likely names. If an equivalent already exists, REUSE it. Never write a second version of something that exists.
- Orient with \`project_map\` and \`file_outline\` instead of reading whole files. Use \`file_dependencies\` to find related files.

## While writing — fewest lines that stay maintainable
- Prefer reusing and composing existing code over adding new code. The best change often deletes more than it adds.
- No duplication: if you would copy a block, extract it into one shared unit and call it from both places.
- Keep units small, focused, and named for what they do. Optimize for maintainable and scalable, not clever or short-for-its-own-sake.
- Match the surrounding code's style, naming and patterns.

## Before you finish — leave nothing orphaned
- Run \`dead_code\` on the area you touched. It reports symbols with NO static references — a signal, not a verdict. For each one, confirm it is truly unused before removing it:
  1. Grep the name as a string / property key (\`"name"\`, \`'name'\`, \`["name"]\`, \`.name\`) — reflective use.
  2. Grep for a dynamic \`import()\` / \`require()\` that targets its file.
  3. If the project auto-wires code (routes, DI, plugins, components, CLI commands), check those conventions.
  4. If it's an export meant for external consumers, keep it (mark it an entry point in \`sens.config.json\`).
  Then either delete it or wire it up. Never leave unused code behind.
- When you change or rename a symbol, call \`who_uses\` (with \`full:true\` before a project-wide rename) and update EVERY call site.

## The principle
Minimal, non-duplicated, fully-wired code that is maintainable and scalable. Reuse > add. Delete > keep.`;
