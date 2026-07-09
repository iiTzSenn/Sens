/**
 * The working rules Sens hands to the model, as composable modules.
 *
 * Each module is a small, titled block tied to something the model can *verify*
 * with a Sens query. They compose into one rules document: the default-on modules
 * form `AGENT_RULES` (sent as the MCP server's instructions and embedded in the
 * skill), and a project can enable/disable modules or add its own via
 * `sens.config.json` — the `SessionStart` hook then injects whatever is active at
 * the start of every session. `sens rules` prints the active set.
 */

/** One composable rule. */
export interface RuleModule {
  /** Stable id used to enable/disable it in config. */
  id: string;
  /** Heading shown in the rendered rules. */
  title: string;
  /** Markdown body under the heading. */
  body: string;
  /** Whether it is on out of the box (custom modules default to on). */
  default: boolean;
}

const HEADER =
  "# Working rules — follow these whenever you write or change code in this project\n\n" +
  "Sens indexes this project so you can *verify* these rules instead of guessing. Use it; don't skip the checks.";

const PRINCIPLE =
  "## The principle\n" +
  "Minimal, non-duplicated, fully-wired code that is maintainable and scalable. Reuse > add. Delete > keep.";

/** Built-in rule modules, in render order. */
export const BUILTIN_RULES: RuleModule[] = [
  {
    id: "search-first",
    title: "Before writing new code — search first, write second",
    default: true,
    body:
      "- Before adding any function, component, class, type, constant or helper, call `already_exists` with 1-2 distinctive keywords AND `find_symbol` for the likely names. If an equivalent already exists, REUSE it. Never write a second version of something that exists.\n" +
      "- Orient with `project_map` and `file_outline` instead of reading whole files. Use `file_dependencies` to find related files, and `explain_symbol` to see what calls a symbol and what it calls before you touch it — gather just the relevant code instead of reading everything.",
  },
  {
    id: "minimal",
    title: "While writing — fewest lines that stay maintainable",
    default: true,
    body:
      "- Prefer reusing and composing existing code over adding new code. The best change often deletes more than it adds.\n" +
      "- No duplication: if you would copy a block, extract it into one shared unit and call it from both places.\n" +
      "- Keep units small, focused, and named for what they do. Optimize for maintainable and scalable, not clever or short-for-its-own-sake.\n" +
      "- Match the surrounding code's style, naming and patterns.",
  },
  {
    id: "no-orphans",
    title: "Before you finish — leave nothing orphaned",
    default: true,
    body:
      "- Run `dead_code` on the area you touched. It reports code unreachable from any entry point (auto-detected from package.json) — dead islands, whole dead files, and per-symbol candidates — ranked by confidence. A signal, not a verdict:\n" +
      "  - HIGH (internal, unreferenced): safe to remove after a quick sanity check.\n" +
      "  - MEDIUM (internal dead island): read the reason, then remove the whole cluster together.\n" +
      "  - LOW (exported API or method): could be consumed outside the index or via dynamic dispatch — verify before touching.\n" +
      "  It already greps non-source files (JSON/config/templates) and flags any `⚠ reflective` hit; for those, and for anything you're unsure about, still confirm it's truly unused:\n" +
      "  1. Check the flagged reflective file, and grep the name as a string / property key elsewhere.\n" +
      "  2. Grep for a dynamic `import()` / `require()` that targets its file.\n" +
      "  3. If the project auto-wires code (routes, DI, plugins, components, CLI commands), check those conventions.\n" +
      "  4. If it's an export meant for external consumers, keep it (mark it an entry point in `sens.config.json`).\n" +
      "  Then either delete it or wire it up. Never leave unused code behind.\n" +
      "- When you change or rename a symbol, call `who_uses` (with `full:true` before a project-wide rename) and update EVERY call site.",
  },
  {
    id: "optimization",
    title: "Optimize what matters — measure, don't guess",
    default: true,
    body:
      "- Write the clear version first; optimize only a real, observed cost — never on a hunch.\n" +
      "- Avoid obvious waste: repeated work in a loop, N+1 queries/calls, re-reading or re-parsing the same data, work that could be hoisted or memoized.\n" +
      "- Prefer a better algorithm or data structure over micro-tuning, and keep the readable shape unless a measurement says otherwise.",
  },
  {
    id: "error-handling",
    title: "Handle failure explicitly",
    default: false,
    body:
      "- Don't swallow errors silently; surface or log them with enough context to act on.\n" +
      "- Validate inputs at boundaries and handle the empty / error / edge case, not only the happy path.\n" +
      "- Never leave a partial state on failure — clean up or roll back.",
  },
  {
    id: "testing",
    title: "Cover new behavior with tests",
    default: false,
    body:
      "- Add or update tests for the behavior you changed, matching the project's existing test layout and style.\n" +
      "- Test the edge and failure cases you just handled, not only the happy path.\n" +
      "- Run the suite before finishing.",
  },
];

/** Render a set of rule modules into one document (header + modules + principle). */
export function composeRules(modules: RuleModule[]): string {
  const parts = [HEADER, ...modules.map((m) => `## ${m.title}\n${m.body}`), PRINCIPLE];
  return parts.join("\n\n");
}

/**
 * The default rules document — the default-on modules, composed. Config-independent
 * so the MCP server instructions and the shipped skill always carry a sensible set;
 * per-project enable/disable only affects the `SessionStart` hook and `sens rules`.
 */
export const AGENT_RULES = composeRules(BUILTIN_RULES.filter((m) => m.default));
