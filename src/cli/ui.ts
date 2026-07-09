// The single place every CLI command renders through. No command may call
// console.* directly — they go through these helpers so the header, symbols,
// spacing and color scheme stay identical across `map`, `find`, `who`, … as if
// they were one app.
//
// IMPORTANT: this styling is for the *terminal* only. The plain-text formatters
// in ../format.ts feed the MCP server (what the model reads); nothing here must
// leak into that path — no ANSI, no box characters in the model's view.

import chalk from "chalk";
import ora from "ora";
import boxen from "boxen";
import { VERSION } from "../index.js";

/** Two-space step used for every parent → child level of hierarchy. */
export const INDENT = "  ";

/** Meaningful glyphs, never plain dashes. */
export const sym = {
  ok: "✓",
  err: "✗",
  warn: "⚠",
  file: "●", // has exported surface
  empty: "○", // internal-only
  child: "›", // a nested item
  arrow: "→", // a flow / suggestion
  branch: "⎿", // meta continuation (counts, timings, "+N more")
} as const;

/** One brand accent (cyan). Green/red/yellow carry state; gray is meta. */
export const c = {
  brand: chalk.cyan,
  title: chalk.cyan.bold,
  text: chalk.white,
  meta: chalk.dim,
  ok: chalk.green,
  err: chalk.red,
  warn: chalk.yellow,
};

const ANSI = /\[[0-9;]*m/g;
/** Visible length, ignoring color escapes — for alignment math. */
export const vlen = (s: string): number => s.replace(ANSI, "").length;

const termWidth = (): number => Math.min(process.stdout.columns || 80, 84);
/** Printable width remaining after `indents` levels of indentation. */
export const rowWidth = (indents = 1): number =>
  termWidth() - indents * INDENT.length;

/** Truncate to fit, with an ellipsis, measuring visible characters. */
export function truncate(s: string, max = rowWidth(3)): string {
  return vlen(s) <= max ? s : s.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

/** Left text + right text pushed to opposite edges of `width`. */
export function align(left: string, right: string, width = rowWidth()): string {
  const gap = Math.max(1, width - vlen(left) - vlen(right));
  return left + " ".repeat(gap) + right;
}

const rule = (): string => c.meta("─".repeat(rowWidth()));

/** Consistent command banner: `sens › <command>` + version, then a thin rule. */
export function header(command: string): void {
  const left = `${c.title("sens")} ${c.meta(sym.child)} ${c.text(command)}`;
  console.log("\n" + INDENT + align(left, c.meta(`v${VERSION}`)));
  console.log(INDENT + rule());
}

/** A bold accent section title. */
export function section(title: string): void {
  console.log("\n" + INDENT + c.title(title));
}

export function blank(): void {
  console.log("");
}

/** Print an already-formatted body (from ../cli/render.ts) verbatim. */
export function print(body: string): void {
  console.log(body);
}

export function success(msg: string): void {
  console.log(`${INDENT}${c.ok(sym.ok)} ${msg}`);
}

/** ✗ + clear message, plus an optional gray suggestion line. No stack traces. */
export function error(msg: string, hint?: string): void {
  console.error(`${INDENT}${c.err(sym.err)} ${msg}`);
  if (hint) console.error(`${INDENT}${INDENT}${c.meta(sym.branch)} ${c.meta(hint)}`);
}

export function warn(msg: string): void {
  console.log(`${INDENT}${c.warn(sym.warn)} ${msg}`);
}

/** A dim, indented continuation line (paths, counts, timings). */
export function detail(msg: string): void {
  console.log(`${INDENT}${INDENT}${c.meta(sym.branch)} ${c.meta(msg)}`);
}

/** Rounded box — reserved for final summaries / confirmations / big errors. */
export function box(lines: string[], opts: { title?: string; tone?: "brand" | "error" } = {}): void {
  console.log(
    boxen(lines.join("\n"), {
      borderStyle: "round",
      borderColor: opts.tone === "error" ? "red" : "gray",
      padding: { top: 0, bottom: 0, left: 1, right: 1 },
      margin: { top: 0, bottom: 0, left: INDENT.length, right: 0 },
      title: opts.title
        ? (opts.tone === "error" ? c.err(opts.title) : c.title(opts.title))
        : undefined,
    }),
  );
}

/** One suggested next action: a `sens` command, or a bare gray tip (no cmd). */
export interface Step {
  cmd?: string;
  hint: string;
}

/**
 * A block of dynamic suggestions. With a title it reads as a "Próximos pasos"
 * section (after a successful result); with an empty title the lines sit tight
 * under the message (used when a query found nothing).
 */
export function nextSteps(steps: Step[], title = "Próximos pasos"): void {
  if (steps.length === 0) return;
  if (title) section(title);
  const labels = steps.map((s) => (s.cmd ? `sens ${s.cmd}` : ""));
  const w = Math.max(...labels.map((l) => l.length));
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const arrow = c.meta(sym.arrow);
    if (s.cmd) {
      console.log(`${INDENT}${arrow} ${c.brand(labels[i].padEnd(w))}   ${c.meta(s.hint)}`);
    } else {
      console.log(`${INDENT}${arrow} ${c.meta(s.hint)}`);
    }
  }
}

export interface Spinner {
  /** Change the in-progress text (phase transitions) without a new line. */
  update(text: string): void;
  /** Replace the spinner with ✓ on the same line. */
  succeed(text?: string): void;
  /** Replace the spinner with ✗ on the same line. */
  fail(text?: string): void;
  /** Clear the spinner, leaving no trace. */
  stop(): void;
}

/** Braille-dots spinner, always with live text. Degrades cleanly off a TTY. */
export function spinner(text: string): Spinner {
  const o = ora({ text, indent: INDENT.length, spinner: "dots", color: "cyan" }).start();
  return {
    update: (t) => {
      o.text = t;
    },
    succeed: (t) => o.stopAndPersist({ symbol: c.ok(sym.ok), text: t ?? o.text }),
    fail: (t) => o.stopAndPersist({ symbol: c.err(sym.err), text: t ?? o.text }),
    stop: () => o.stop(),
  };
}
