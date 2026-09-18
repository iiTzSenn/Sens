import chalk from "chalk";
import ora from "ora";
import boxen from "boxen";
import { VERSION } from "../index.js";

export const INDENT = "  ";

export const sym = {
  ok: "✓",
  err: "✗",
  warn: "⚠",
  file: "●",
  empty: "○",
  child: "›",
  arrow: "→",
  branch: "⎿",
} as const;

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
export const vlen = (s: string): number => s.replace(ANSI, "").length;

const termWidth = (): number => Math.min(process.stdout.columns || 80, 84);
export const rowWidth = (indents = 1): number =>
  termWidth() - indents * INDENT.length;

export function truncate(s: string, max = rowWidth(3)): string {
  return vlen(s) <= max ? s : s.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

export function align(left: string, right: string, width = rowWidth()): string {
  const gap = Math.max(1, width - vlen(left) - vlen(right));
  return left + " ".repeat(gap) + right;
}

const rule = (): string => c.meta("─".repeat(rowWidth()));

export function header(command: string): void {
  const left = `${c.title("sens")} ${c.meta(sym.child)} ${c.text(command)}`;
  console.log("\n" + INDENT + align(left, c.meta(`v${VERSION}`)));
  console.log(INDENT + rule());
}

export function section(title: string): void {
  console.log("\n" + INDENT + c.title(title));
}

export function blank(): void {
  console.log("");
}

export function print(body: string): void {
  console.log(body);
}

export function success(msg: string): void {
  console.log(`${INDENT}${c.ok(sym.ok)} ${msg}`);
}

export function error(msg: string, hint?: string): void {
  console.error(`${INDENT}${c.err(sym.err)} ${msg}`);
  if (hint) console.error(`${INDENT}${INDENT}${c.meta(sym.branch)} ${c.meta(hint)}`);
}

export function warn(msg: string): void {
  console.log(`${INDENT}${c.warn(sym.warn)} ${msg}`);
}

export function detail(msg: string): void {
  console.log(`${INDENT}${INDENT}${c.meta(sym.branch)} ${c.meta(msg)}`);
}

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

export interface Step {
  cmd?: string;
  hint: string;
}

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

  update(text: string): void;

  succeed(text?: string): void;
  fail(text?: string): void;
  stop(): void;
}

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
