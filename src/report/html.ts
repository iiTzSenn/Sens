import { statSync } from "node:fs";
import path from "node:path";
import type { ProjectIndex } from "../types.js";
import type { QueryEngine } from "../query/engine.js";

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function readAllChars(index: ProjectIndex): number {
  let total = 0;
  for (const f of index.files) {
    try {
      total += statSync(path.join(index.root, f.path)).size;
    } catch {
      /* file may have been removed since indexing */
    }
  }
  return total;
}

/** Render a self-contained HTML report (no external assets). */
export function renderReport(index: ProjectIndex, engine: QueryEngine): string {
  const projectName = path.basename(index.root) || "project";
  const map = engine.map();
  const dead = engine.deadCode();
  const exportedCount = index.symbols.filter((s) => s.exported).length;

  const readTokens = Math.round(readAllChars(index) / 4);
  const mapChars = map.reduce(
    (n, e) =>
      n +
      e.file.length +
      e.exported.reduce((m, s) => m + s.signature.length + 4, 0),
    0,
  );
  const mapTokens = Math.max(1, Math.round(mapChars / 4));
  const savedPct =
    readTokens > 0 ? Math.max(0, Math.round((1 - mapTokens / readTokens) * 100)) : 0;

  const deadRows = dead.length
    ? dead
        .map(
          (s) =>
            `<tr><td class="mono">${esc(s.file)}:${s.line}</td><td><span class="kind">${esc(s.kind)}</span></td><td class="mono">${esc(s.name)}</td><td>${s.exported ? '<span class="tag">exported</span>' : "—"}</td></tr>`,
        )
        .join("")
    : `<tr><td colspan="4" class="muted">No dead-code candidates found 🎉</td></tr>`;

  const mapBlocks = map
    .map(
      (e) =>
        `<div class="file"><div class="fname mono">${esc(e.file)}</div>` +
        e.exported
          .map((s) => `<div class="sig mono">${esc(s.signature)}</div>`)
          .join("") +
        (e.internalCount > 0
          ? `<div class="muted">+${e.internalCount} internal</div>`
          : "") +
        `</div>`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sens — ${esc(projectName)}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    color: #1a1c22; background: #f6f7f9;
  }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; }
  header { padding: 40px 32px 24px; }
  h1 { margin: 0; font-size: 26px; letter-spacing: -0.02em; }
  h1 .dot { color: #4f7cff; }
  .sub { color: #6b7280; margin-top: 6px; }
  main { padding: 0 32px 56px; max-width: 980px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 14px; margin: 8px 0 26px; }
  .card { background: #fff; border: 1px solid #e6e8ec; border-radius: 14px; padding: 18px 20px; }
  .card .n { font-size: 28px; font-weight: 650; letter-spacing: -0.02em; }
  .card .l { color: #6b7280; font-size: 13px; margin-top: 2px; }
  .card.accent { background: linear-gradient(135deg, #4f7cff, #7a5cff); color: #fff; border: none; }
  .card.accent .l { color: rgba(255,255,255,.85); }
  h2 { font-size: 15px; text-transform: uppercase; letter-spacing: .08em; color: #6b7280; margin: 34px 0 12px; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e6e8ec; border-radius: 14px; overflow: hidden; }
  th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid #eef0f3; }
  th { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: #9099a5; }
  tr:last-child td { border-bottom: none; }
  .kind { background: #eef1f6; border-radius: 6px; padding: 2px 8px; font-size: 12px; }
  .tag { background: #fde68a55; color: #92600a; border-radius: 6px; padding: 2px 8px; font-size: 12px; }
  .muted { color: #9099a5; }
  .files { display: grid; gap: 10px; }
  .file { background: #fff; border: 1px solid #e6e8ec; border-radius: 12px; padding: 12px 16px; }
  .fname { color: #4f7cff; margin-bottom: 6px; }
  .sig { color: #333842; padding-left: 10px; }
  footer { color: #9099a5; font-size: 12px; padding: 0 32px 40px; }
  @media (prefers-color-scheme: dark) {
    body { color: #e6e8ec; background: #0f1116; }
    .card, table, .file { background: #171a21; border-color: #262b34; }
    th { color: #7b8494; } td { border-color: #21252e; }
    .kind { background: #21262f; } .sig { color: #c7ccd4; }
    .fname { color: #7aa2ff; } h1 { color: #f3f5f8; }
  }
</style>
</head>
<body>
<header>
  <h1>Sens<span class="dot">.</span> <span class="muted">${esc(projectName)}</span></h1>
  <div class="sub">Project index report — query your codebase instead of reading it all.</div>
</header>
<main>
  <div class="cards">
    <div class="card"><div class="n">${index.files.length}</div><div class="l">files</div></div>
    <div class="card"><div class="n">${index.symbols.length}</div><div class="l">symbols</div></div>
    <div class="card"><div class="n">${exportedCount}</div><div class="l">exported</div></div>
    <div class="card"><div class="n">${dead.length}</div><div class="l">dead-code candidates</div></div>
    <div class="card accent"><div class="n">~${savedPct}%</div><div class="l">fewer tokens to orient*</div></div>
  </div>

  <h2>Dead-code candidates</h2>
  <table>
    <thead><tr><th>Location</th><th>Kind</th><th>Name</th><th></th></tr></thead>
    <tbody>${deadRows}</tbody>
  </table>

  <h2>Project map</h2>
  <div class="files">${mapBlocks}</div>
</main>
<footer>
  *Estimated: orienting via the project map (~${mapTokens.toLocaleString()} tokens) vs. reading the source tree (~${readTokens.toLocaleString()} tokens).
  Dead-code entries are candidates — verify before deleting.
</footer>
</body>
</html>`;
}
