// Styled, human-facing renderers for query results. The terminal twin of
// ../format.ts: same data, but with hierarchy, glyphs and color. Everything
// visual comes from ./ui.ts, so the look stays consistent across commands.
//
// These are used ONLY by the CLI. The MCP server keeps using ../format.ts so
// the model never sees ANSI or box characters.

import { INDENT, c, sym, align, truncate, rowWidth } from "./ui.js";
import type { SymbolInfo } from "../types.js";
import type {
  MapEntry,
  WhoUsesResult,
  FileDependencies,
  Neighborhood,
  DeadCodeReport,
  DeadCodeTier,
} from "../query/engine.js";

const I1 = INDENT;
const I2 = INDENT + INDENT;
const I3 = INDENT + INDENT + INDENT;

/** The declared name inside a symbol id (`file#name#line`). */
const symbolName = (id: string): string => id.split("#")[1] ?? id;

const loc = (s: { file: string; line: number }): string => `${s.file}:${s.line}`;

const bulletFor = (exported: boolean): string =>
  exported ? c.brand(sym.file) : c.meta(sym.empty);

const note = (msg: string): string => I1 + c.meta(msg);

/** Directory prefix of a POSIX path, or "./" for a root-level file. */
const dirOf = (file: string): string => {
  const slash = file.lastIndexOf("/");
  return slash === -1 ? "./" : file.slice(0, slash + 1);
};

// ── map ──────────────────────────────────────────────────────────────────
const MAX_CHILDREN = 12;

export function renderMap(entries: MapEntry[]): string {
  if (entries.length === 0) return note("(sin archivos)");
  const lines: string[] = [];
  let lastDir: string | null = null;
  for (const e of entries) {
    const dir = dirOf(e.file);
    if (dir !== lastDir) {
      if (lastDir !== null) lines.push("");
      lines.push(I1 + c.meta(dir));
      lastDir = dir;
    }
    const base = e.file.slice(dir === "./" ? 0 : dir.length);
    const left = `${bulletFor(e.exported.length > 0)} ${c.text(base)}`;
    lines.push(I2 + align(left, c.meta(mapMeta(e)), rowWidth(2)));
    for (const s of e.exported.slice(0, MAX_CHILDREN)) {
      lines.push(`${I3}${c.meta(sym.child)} ${truncate(s.signature, rowWidth(3) - 2)}`);
    }
    const rest = e.exported.length - MAX_CHILDREN;
    if (rest > 0) lines.push(`${I3}${c.meta(`${sym.branch} +${rest} más`)}`);
  }
  return lines.join("\n");
}

function mapMeta(e: MapEntry): string {
  const parts = [`${e.exported.length} export${e.exported.length === 1 ? "" : "s"}`];
  if (e.internalCount > 0) parts.push(`+${e.internalCount} internal`);
  return parts.join(" · ");
}

// ── find / outline / exists ────────────────────────────────────────────────
export function renderSymbols(syms: SymbolInfo[], emptyMsg: string): string {
  if (syms.length === 0) return note(emptyMsg);
  const lines: string[] = [];
  for (const s of syms) {
    const tag = s.exported ? ` ${c.meta("[exported]")}` : "";
    const left = `${bulletFor(s.exported)} ${c.text(s.name)} ${c.meta(s.kind)}`;
    lines.push(I1 + align(left, c.meta(loc(s)) + tag, rowWidth(1)));
    lines.push(`${I2}${c.meta(sym.child)} ${c.meta(truncate(s.signature, rowWidth(2) - 2))}`);
  }
  return lines.join("\n");
}

// ── who ────────────────────────────────────────────────────────────────────
const MAX_INLINE_REFS = 30;
const MAX_GROUPED_FILES = 10;

export function renderWhoUses(
  results: WhoUsesResult[],
  opts: { full?: boolean } = {},
): string {
  if (results.length === 0) return note("símbolo no encontrado");
  const lines: string[] = [];
  for (const r of results) {
    const n = r.references.length;
    const left = `${c.brand(sym.file)} ${c.text(r.symbol.name)}`;
    const right = `${c.meta(loc(r.symbol))} ${c.meta("·")} ${c.text(String(n))} ${c.meta(n === 1 ? "uso" : "usos")}`;
    lines.push(I1 + align(left, right, rowWidth(1)));

    if (opts.full || n <= MAX_INLINE_REFS) {
      for (const ref of r.references) {
        const where = ref.from ? `  ${c.meta("in " + symbolName(ref.from))}` : "";
        lines.push(`${I2}${c.meta(sym.child)} ${c.meta(loc(ref))}${where}`);
      }
      continue;
    }

    // Partial summary — group by file, busiest first, and say so loudly.
    const byFile = new Map<string, number>();
    for (const ref of r.references) byFile.set(ref.file, (byFile.get(ref.file) ?? 0) + 1);
    const sorted = [...byFile.entries()].sort((a, b) => b[1] - a[1]);
    lines.push(
      `${I2}${c.warn(sym.warn)} ${c.warn("resumen parcial")} ${c.meta(`— usado en ${byFile.size} archivo(s), más activos primero:`)}`,
    );
    for (const [file, count] of sorted.slice(0, MAX_GROUPED_FILES)) {
      lines.push(`${I2}${c.meta(sym.child)} ${c.meta(`${file}  (${count}x)`)}`);
    }
    const hidden = sorted.length - MAX_GROUPED_FILES;
    if (hidden > 0) lines.push(`${I2}${c.meta(`${sym.branch} +${hidden} archivo(s) más`)}`);
    lines.push(`${I2}${c.meta("usa --full para ver todos los sitios antes de renombrar/editar.")}`);
  }
  return lines.join("\n");
}

// ── dead-code ───────────────────────────────────────────────────────────────
const DEAD_TIERS: { tier: DeadCodeTier; label: string }[] = [
  { tier: "high", label: "alta confianza — interno, sin referencias" },
  { tier: "medium", label: "media — isla muerta interna" },
  { tier: "low", label: "baja — export/método; podría usarse fuera del índice" },
];

export function renderDeadCode(report: DeadCodeReport): string {
  const { candidates, files } = report;
  if (candidates.length === 0 && files.length === 0)
    return `${I1}${c.ok(sym.ok)} ${c.text("sin candidatos de código muerto")}`;

  const deadFiles = new Set(files);
  const total = `${candidates.length} candidato(s)${files.length ? ` + ${files.length} archivo(s)` : ""}`;
  const lines: string[] = [
    `${I1}${c.warn(sym.warn)} ${c.text(total)} ${c.meta("— inalcanzables; candidatos, no veredicto")}`,
  ];

  if (files.length > 0) {
    lines.push("", I1 + c.meta("archivos muertos completos — nadie los importa"));
    for (const f of files) {
      lines.push(I2 + `${c.meta(sym.empty)} ${c.text(f)} ${c.meta("borra el archivo")}`);
    }
  }

  const loose = candidates.filter((cd) => !deadFiles.has(cd.symbol.file));
  for (const { tier, label } of DEAD_TIERS) {
    const group = loose.filter((cd) => cd.tier === tier);
    if (group.length === 0) continue;
    lines.push("", I1 + c.meta(label));
    for (const { symbol: s, reflectiveHit } of group) {
      const tag = s.exported ? ` ${c.meta("[exported]")}` : "";
      const left = `${c.meta(sym.empty)} ${c.text(s.name)} ${c.meta(s.kind)}`;
      lines.push(I2 + align(left, c.meta(`${s.file}:${s.line}`) + tag, rowWidth(2)));
      if (reflectiveHit) lines.push(I3 + c.warn(`${sym.warn} aparece en ${reflectiveHit} (¿uso reflexivo?)`));
    }
  }
  return lines.join("\n");
}

// ── explain ─────────────────────────────────────────────────────────────────
export function renderExplain(results: Neighborhood[]): string {
  if (results.length === 0) return note("símbolo no encontrado");
  const lines: string[] = [];
  const block = (glyph: string, title: string, syms: SymbolInfo[]): void => {
    lines.push(`${I2}${c.meta(`${title} (${syms.length})`)}`);
    if (syms.length === 0) lines.push(`${I3}${c.meta("(ninguno)")}`);
    for (const s of syms) {
      lines.push(`${I3}${c.meta(glyph)} ${c.text(s.name)}  ${c.meta(loc(s))}`);
    }
  };
  for (const r of results) {
    const left = `${c.brand(sym.file)} ${c.text(r.symbol.name)}`;
    lines.push(I1 + align(left, c.meta(loc(r.symbol)), rowWidth(1)));
    block(sym.branch, "llamado por", r.callers);
    block(sym.arrow, "llama a", r.callees);
  }
  return lines.join("\n");
}

// ── path ────────────────────────────────────────────────────────────────────
export function renderPath(
  path: SymbolInfo[] | null,
  from: string,
  to: string,
): string {
  if (!path || path.length === 0)
    return note(`sin ruta de ${from} a ${to}`);
  return path
    .map((s, i) => {
      const prefix = i === 0 ? `${c.brand(sym.file)} ` : `${I1}${c.meta(sym.arrow)} `;
      return `${I1}${prefix}${c.text(s.name)}  ${c.meta(`(${loc(s)})`)}`;
    })
    .join("\n");
}

// ── deps ────────────────────────────────────────────────────────────────────
export function renderFileDependencies(deps: FileDependencies): string {
  const lines: string[] = [`${I1}${c.brand(sym.file)} ${c.text(deps.file)}`];
  const block = (glyph: string, title: string, files: string[]): void => {
    if (files.length === 0) {
      lines.push(`${I2}${c.meta(`${title}: (ninguno)`)}`);
      return;
    }
    lines.push(`${I2}${c.meta(`${title} (${files.length})`)}`);
    for (const f of files) lines.push(`${I3}${c.meta(glyph)} ${c.text(f)}`);
  };
  block(sym.arrow, "importa", deps.imports);
  block(sym.branch, "importado por", deps.importedBy);
  return lines.join("\n");
}
