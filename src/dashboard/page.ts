// The dashboard is a single self-contained page served by the local server.
// The client JS uses plain string concatenation (no template literals) so this
// whole document can live inside one TS template literal safely.

import { i18nClientScript } from "./i18n.js";

export function renderDashboardPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sens dashboard</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjgiIGhlaWdodD0iMTI4IiB2aWV3Qm94PSIwIDAgNDggNDgiIHJvbGU9ImltZyIgYXJpYS1sYWJlbD0ic2VucyI+PGRlZnM+PGxpbmVhckdyYWRpZW50IGlkPSJnIiB4MT0iMCIgeTE9IjAiIHgyPSIxIiB5Mj0iMSI+PHN0b3Agb2Zmc2V0PSIwIiBzdG9wLWNvbG9yPSIjN2FhMmZmIi8+PHN0b3Agb2Zmc2V0PSIuNTUiIHN0b3AtY29sb3I9IiM0ZjdjZmYiLz48c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiM1NTY2ZmYiLz48L2xpbmVhckdyYWRpZW50PjwvZGVmcz48cmVjdCB3aWR0aD0iNDgiIGhlaWdodD0iNDgiIHJ4PSIxMiIgZmlsbD0idXJsKCNnKSIvPjxnIHRyYW5zZm9ybT0idHJhbnNsYXRlKDI0IDI0KSBzY2FsZSgxLjIpIHRyYW5zbGF0ZSgtMjQgLTI0KSI+PGcgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjEuOSIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBvcGFjaXR5PSIuNTUiPjxsaW5lIHgxPSIyMyIgeTE9IjIzIiB4Mj0iMTIiIHkyPSIxNCIvPjxsaW5lIHgxPSIyMyIgeTE9IjIzIiB4Mj0iMzYiIHkyPSIxMiIvPjxsaW5lIHgxPSIyMyIgeTE9IjIzIiB4Mj0iMzciIHkyPSIzMiIvPjxsaW5lIHgxPSIyMyIgeTE9IjIzIiB4Mj0iMTQiIHkyPSIzNiIvPjxsaW5lIHgxPSIzNiIgeTE9IjEyIiB4Mj0iMzciIHkyPSIzMiIvPjwvZz48ZyBmaWxsPSIjZmZmIj48Y2lyY2xlIGN4PSIyMyIgY3k9IjIzIiByPSI1Ii8+PGNpcmNsZSBjeD0iMTIiIGN5PSIxNCIgcj0iMi43Ii8+PGNpcmNsZSBjeD0iMzYiIGN5PSIxMiIgcj0iMy40Ii8+PGNpcmNsZSBjeD0iMzciIGN5PSIzMiIgcj0iMyIvPjxjaXJjbGUgY3g9IjE0IiBjeT0iMzYiIHI9IjIuNSIvPjwvZz48L2c+PC9zdmc+">
<style>
  * { box-sizing: border-box; }
  /* All theme colors live in CSS variables so light and dark stay in sync from one
     source of truth. Defaults below are the light theme; the dark values are applied
     either automatically (prefers-color-scheme) or explicitly via [data-theme]. */
  :root {
    color-scheme: light dark;
    --accent: #4f7cff; --accent-hover: #3d6bf0;
    --bg: #f6f7f9;
    --fg: #1a1c22;
    --muted: #8a92a0;
    --border: #e6e8ec;
    --border-strong: #d3d7de;
    --topbar-bg: rgba(255,255,255,.88);
    --surface: #ffffff;
    --card: #f6f7f9;
    --btn-bg: #ffffff;
    --btn-fg: #1a1c22;
    --btn-hover: #f1f3f6;
    --ghost-fg: #3a4250;
    --graph-bg: #ffffff;
    --overlay-bg: rgba(255,255,255,.85);
    --overlay-fg: #6b7280;
    --row-hover: #f1f3f6;
    --crumb-fg: #5b6472;
    --crumb-cur: #1a1c22;
    --sep: #c2c8d0;
    --tag-bg: #eef1f6;
    --tag-fg: #5b6472;
    --sig-border: #f0f2f5;
    --scroll-thumb: #d3d7de;
    --scroll-thumb-hover: #b9bfc9;
    --toast-bg: #ffffff;
    --toast-fg: #157042;
    --toast-shadow: rgba(20,30,60,.20);
    --toast-ring: rgba(34,163,92,.22);
    --toast-ic: #22a35c;
    --status-off: #c2c8d0;
    --ok: #22c55e; --ok-glow: rgba(34,197,94,.7);
    --stale: #ef4444; --stale-glow: rgba(239,68,68,.65);
  }
  /* Shared dark palette — applied when the OS asks for dark (unless the user forced
     light) and when the user explicitly picks dark via the toggle. */
  :root[data-theme="dark"], :root:not([data-theme]) {}
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #0f1116;
      --fg: #e6e8ec;
      --muted: #8a92a0;
      --border: #262b34;
      --border-strong: #2c3340;
      --topbar-bg: rgba(23,26,33,.82);
      --surface: #171a21;
      --card: #1c2029;
      --btn-bg: #1c2029;
      --btn-fg: #e6e8ec;
      --btn-hover: #232833;
      --ghost-fg: #cdd3dc;
      --graph-bg: #0f1116;
      --overlay-bg: rgba(23,26,33,.85);
      --overlay-fg: #9aa3b0;
      --row-hover: #232833;
      --crumb-fg: #9aa3b0;
      --crumb-cur: #e6e8ec;
      --sep: #3a4250;
      --tag-bg: #232833;
      --tag-fg: #9aa3b0;
      --sig-border: #21252e;
      --scroll-thumb: #2c3340;
      --scroll-thumb-hover: #3a4250;
      --toast-bg: #1c2029;
      --toast-fg: #4bd48a;
      --toast-shadow: rgba(0,0,0,.5);
      --toast-ring: rgba(75,212,138,.28);
      --toast-ic: #2ea866;
      --status-off: #3a4250;
      --ok: #34d47f; --ok-glow: rgba(52,212,127,.7);
      --stale: #f87171; --stale-glow: rgba(248,113,113,.7);
    }
  }
  :root[data-theme="dark"] {
    --bg: #0f1116;
    --fg: #e6e8ec;
    --muted: #8a92a0;
    --border: #262b34;
    --border-strong: #2c3340;
    --topbar-bg: rgba(23,26,33,.82);
    --surface: #171a21;
    --card: #1c2029;
    --btn-bg: #1c2029;
    --btn-fg: #e6e8ec;
    --btn-hover: #232833;
    --ghost-fg: #cdd3dc;
    --graph-bg: #0f1116;
    --overlay-bg: rgba(23,26,33,.85);
    --overlay-fg: #9aa3b0;
    --row-hover: #232833;
    --crumb-fg: #9aa3b0;
    --crumb-cur: #e6e8ec;
    --sep: #3a4250;
    --tag-bg: #232833;
    --tag-fg: #9aa3b0;
    --sig-border: #21252e;
    --scroll-thumb: #2c3340;
    --scroll-thumb-hover: #3a4250;
    --toast-bg: #1c2029;
    --toast-fg: #4bd48a;
    --toast-shadow: rgba(0,0,0,.5);
    --toast-ring: rgba(75,212,138,.28);
    --toast-ic: #2ea866;
    --status-off: #3a4250;
    --ok: #34d47f; --ok-glow: rgba(52,212,127,.7);
    --stale: #f87171; --stale-glow: rgba(248,113,113,.7);
  }

  body { margin: 0; font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: var(--fg); background: var(--bg); }
  .app { display: flex; flex-direction: column; height: 100vh; }
  .topbar { display: flex; align-items: center; justify-content: space-between; padding: 11px 18px; border-bottom: 1px solid var(--border); background: var(--topbar-bg); backdrop-filter: saturate(1.4) blur(10px); }
  .brand { display: flex; align-items: center; gap: 11px; font-size: 17px; font-weight: 600; letter-spacing: -0.02em; }
  .brand .mark { width: 33px; height: 33px; border-radius: 9px; display: grid; place-items: center; color: #fff; background: linear-gradient(140deg, #6f9bff, #4f7cff); box-shadow: 0 3px 8px rgba(79,124,255,.38), inset 0 1px 0 rgba(255,255,255,.35); }
  .brand .mark svg { width: 24px; height: 24px; display: block; }
  .brand .dot { color: var(--accent); }
  .muted { color: var(--muted); font-weight: 400; }
  .actions { display: flex; align-items: center; gap: 8px; }
  button { font: inherit; border: 1px solid var(--border-strong); background: var(--btn-bg); color: var(--btn-fg); padding: 7px 13px; border-radius: 8px; cursor: pointer; }
  button:hover { background: var(--btn-hover); }

  .btn { font: inherit; font-size: 13px; font-weight: 500; display: inline-flex; align-items: center; gap: 7px; padding: 8px 13px; border-radius: 9px; border: 1px solid transparent; cursor: pointer; white-space: nowrap; transition: background .15s ease, border-color .15s ease, box-shadow .15s ease, transform .08s ease; }
  .btn svg { width: 15px; height: 15px; flex: none; }
  .btn:active { transform: translateY(.5px); }
  .btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .btn-primary { background: var(--accent); color: #fff; box-shadow: 0 1px 2px rgba(20,30,60,.20), inset 0 1px 0 rgba(255,255,255,.20); }
  .btn-primary:hover { background: var(--accent-hover); }
  .btn-ghost { background: var(--btn-bg); color: var(--ghost-fg); border-color: var(--border); box-shadow: 0 1px 1.5px rgba(20,30,60,.05); }
  .btn-ghost:hover { background: var(--btn-hover); border-color: var(--border-strong); }
  .btn.loading { pointer-events: none; opacity: .75; }
  .btn.loading svg { animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .btn-icon { width: 34px; height: 34px; padding: 0; gap: 0; justify-content: center; }
  .btn-icon svg { width: 17px; height: 17px; }
  /* theme toggle: the incoming sun/moon spins in with a springy overshoot on click */
  #btnTheme svg { transform-origin: center; }
  #btnTheme svg.theme-spin { animation: theme-swap .5s cubic-bezier(.34,1.5,.5,1); }
  @keyframes theme-swap { 0% { transform: rotate(-140deg) scale(.2); opacity: 0; } 55% { opacity: 1; } 100% { transform: rotate(0) scale(1); opacity: 1; } }
  /* language button: the globe does a half turn (180°) with a little mid-spin bulge.
     No transform transition here — otherwise the .25s revert from 180°→0° reads, on a
     point-symmetric globe, as the spin continuing all the way round to a full turn. */
  #btnLang svg { transform-origin: center; transition: none; }
  #btnLang svg.globe-spin { animation: globe-spin .55s cubic-bezier(.4,0,.2,1); }
  @keyframes globe-spin { 0% { transform: rotate(0) scale(1); } 50% { transform: rotate(90deg) scale(1.16); } 100% { transform: rotate(180deg) scale(1); } }
  /* soft, quick cross-fade of the whole UI during a light/dark switch — the class is
     only present for the ~300ms of the toggle, so hovers and load stay instant. */
  :root.theming, :root.theming * { transition: background-color .3s ease, border-color .3s ease, color .3s ease, fill .3s ease, box-shadow .3s ease !important; }
  @media (prefers-reduced-motion: reduce) {
    #btnTheme svg.theme-spin, #btnLang svg.globe-spin { animation: none; }
    :root.theming, :root.theming * { transition: none !important; }
    .btn-icon svg, .cmenu-btn svg, .zoomctl button { transition: none !important; }
    .btn-icon:hover svg, .cmenu-btn:hover svg, .zoomctl button:hover,
    #btnReindex:hover svg, #btnCanvasMenu[aria-expanded="true"] svg { transform: none !important; }
    .menu:not([hidden]) { animation: none !important; }
  }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }

  .status { width: 11px; height: 11px; border-radius: 50%; background: var(--status-off); position: relative; margin-right: 4px; }
  .status.ok { background: var(--ok); box-shadow: 0 0 7px var(--ok-glow); }
  .status.stale { background: var(--stale); box-shadow: 0 0 7px var(--stale-glow); }

  .conn { position: relative; display: inline-flex; }
  .conn > .btn { -webkit-mask-image: radial-gradient(circle 9px at calc(100% - 3px) 3px, transparent 98%, #000 100%); mask-image: radial-gradient(circle 9px at calc(100% - 3px) 3px, transparent 98%, #000 100%); }
  .conn .status { position: absolute; top: -3px; right: -3px; margin: 0; z-index: 2; }

  /* Shared popover menu (language, export, layout) — one style, three uses. */
  .menuwrap { position: relative; display: inline-flex; }
  .menu { position: absolute; top: calc(100% + 6px); inset-inline-end: 0; min-width: 190px; max-height: 340px; overflow-y: auto; background: var(--surface); border: 1px solid var(--border); border-radius: 11px; padding: 5px; box-shadow: 0 12px 34px var(--toast-shadow); z-index: 60; scrollbar-width: thin; scrollbar-color: var(--scroll-thumb) transparent; }
  .menu[hidden] { display: none; }
  .menu::-webkit-scrollbar { width: 9px; }
  .menu::-webkit-scrollbar-thumb { background-color: var(--scroll-thumb); border-radius: 8px; border: 2.5px solid var(--surface); }
  .menuitem { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 7px 10px; border-radius: 7px; cursor: pointer; font-size: 13px; color: var(--fg); white-space: nowrap; }
  .menuitem:hover { background: var(--row-hover); }
  .menuitem.active { color: var(--accent); font-weight: 600; }
  .menuitem .chk { flex: none; width: 14px; height: 14px; opacity: 0; }
  .menuitem.active .chk { opacity: 1; }
  .menuext { color: var(--muted); font-size: 11px; font-weight: 400; }
  /* three-dot (⋮) control anchored inside the graph canvas, top-right */
  .cmenu { position: absolute; inset-inline-end: 14px; top: 12px; z-index: 25; }
  .cmenu-btn { width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; border-radius: 9px; border: 1px solid var(--border); background: var(--overlay-bg); color: var(--ghost-fg); cursor: pointer; backdrop-filter: saturate(1.3) blur(8px); box-shadow: 0 1px 3px rgba(20,30,60,.10); }
  .cmenu-btn:hover { background: var(--btn-hover); border-color: var(--border-strong); }
  .cmenu-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .cmenu-btn svg { width: 20px; height: 20px; flex: none; }
  .cmenu .menu { min-width: 214px; }
  .menu-head { font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); padding: 9px 10px 4px; user-select: none; }
  .menuitem + .menu-head { border-top: 1px solid var(--border); margin-top: 5px; }
  /* smooth, springy feedback on the toolbar / canvas icons */
  .btn-icon svg, .cmenu-btn svg { transition: transform .25s cubic-bezier(.34,1.45,.5,1); }
  .btn-icon:hover svg, .cmenu-btn:hover svg { transform: scale(1.16); }
  .btn-icon:active svg, .cmenu-btn:active svg { transform: scale(.92); }
  #btnCanvasMenu[aria-expanded="true"] svg { transform: rotate(90deg); }
  #btnReindex:hover svg { transform: rotate(-40deg); }
  .zoomctl button { transition: background .15s ease, transform .18s cubic-bezier(.34,1.4,.5,1); }
  .zoomctl button:hover { transform: scale(1.1); }
  .zoomctl button:active { transform: scale(.94); }
  .menu:not([hidden]) { animation: menu-pop .16s cubic-bezier(.2,.9,.3,1.1); transform-origin: top right; }
  @keyframes menu-pop { from { opacity: 0; transform: translateY(-6px) scale(.97); } to { opacity: 1; transform: none; } }

  .toast { position: fixed; top: 14px; right: 18px; z-index: 50; display: flex; align-items: center; gap: 9px; padding: 10px 15px 10px 11px; border-radius: 12px; background: var(--toast-bg); color: var(--toast-fg); font-size: 13px; font-weight: 600; box-shadow: 0 10px 34px var(--toast-shadow), 0 0 0 1px var(--toast-ring); opacity: 0; transform: translateY(-14px) scale(.96); pointer-events: none; transition: opacity .26s ease, transform .3s cubic-bezier(.2,.9,.3,1.4); }
  .toast.show { opacity: 1; transform: translateY(0) scale(1); }
  .toast .ic { width: 21px; height: 21px; border-radius: 50%; background: var(--toast-ic); color: #fff; display: grid; place-items: center; flex: none; }
  .toast .ic svg { width: 13px; height: 13px; }
  .body { display: flex; flex: 1; min-height: 0; }
  .graphwrap { flex: 1; position: relative; overflow: hidden; touch-action: none; background: var(--graph-bg); }
  canvas { display: block; }
  .legend { position: absolute; inset-inline-start: 14px; bottom: 12px; display: flex; gap: 14px; font-size: 12px; color: var(--overlay-fg); background: var(--overlay-bg); padding: 6px 10px; border-radius: 8px; border: 1px solid var(--border); }
  .legend .d { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 5px; vertical-align: 0; }
  .d.blue { background: #4f7cff; } .d.gray { background: #aab2bf; } .d.dead { background: #e0533d; }
  .d.ext { background: transparent; border: 1.5px dashed #a06fc0; }
  .zoomctl { position: absolute; inset-inline-end: 14px; bottom: 12px; display: flex; flex-direction: column; gap: 6px; }
  .zoomctl button { width: 34px; height: 34px; padding: 0; display: flex; align-items: center; justify-content: center; font-size: 17px; line-height: 1; border-radius: 8px; }
  .hint { position: absolute; left: 50%; transform: translateX(-50%); top: 12px; font-size: 11.5px; color: var(--muted); background: var(--overlay-bg); padding: 5px 9px; border-radius: 7px; border: 1px solid var(--border); pointer-events: none; opacity: 0; transition: opacity .4s; white-space: nowrap; }
  .hint.show { opacity: 1; }
  .crumbs { position: absolute; inset-inline-start: 14px; top: 12px; display: flex; align-items: center; gap: 1px; flex-wrap: wrap; max-width: 62%; font-size: 12px; background: var(--overlay-bg); padding: 4px 6px; border-radius: 8px; border: 1px solid var(--border); }
  .crumbs .cr { color: var(--crumb-fg); cursor: pointer; padding: 2px 7px; border-radius: 6px; transition: background .12s ease, color .12s ease; }
  .crumbs .cr:hover { background: var(--row-hover); color: var(--crumb-cur); }
  .crumbs .cr.cur { color: var(--crumb-cur); font-weight: 600; cursor: default; }
  .crumbs .cr.cur:hover { background: transparent; }
  .crumbs .sep { color: var(--sep); }
  .d.sq { border-radius: 3px; }
  .side { width: 400px; flex: none; border-inline-start: 1px solid var(--border); background: var(--surface); overflow-y: auto; overflow-x: hidden; padding: 16px; scrollbar-width: thin; scrollbar-color: var(--scroll-thumb) transparent; }
  .side::-webkit-scrollbar { width: 9px; }
  .side::-webkit-scrollbar-track { background: transparent; }
  .side::-webkit-scrollbar-thumb { background-color: var(--scroll-thumb); border-radius: 8px; border: 2.5px solid var(--surface); }
  .side::-webkit-scrollbar-thumb:hover { background-color: var(--scroll-thumb-hover); }
  .cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
  .card { background: var(--card); border-radius: 10px; padding: 12px; }
  .card .n { font-size: 22px; font-weight: 600; }
  .card .l { font-size: 12px; color: var(--muted); }
  input { width: 100%; margin: 16px 0 6px; padding: 9px 11px; border: 1px solid var(--border-strong); border-radius: 8px; font: inherit; box-sizing: border-box; background: var(--btn-bg); color: var(--fg); }
  input::placeholder { color: var(--muted); }
  h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 20px 0 8px; }
  .row { display: flex; justify-content: space-between; gap: 8px; padding: 7px 8px; border-radius: 7px; cursor: pointer; min-width: 0; }
  .row:hover { background: var(--row-hover); }
  .row .mono { min-width: 0; overflow-wrap: anywhere; }
  .loc { color: var(--muted); font-size: 12px; flex: none; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; overflow-wrap: anywhere; }
  .ptitle { color: var(--accent); margin-bottom: 8px; word-break: break-all; }
  .sig { padding: 4px 0; border-bottom: 1px solid var(--sig-border); overflow-wrap: anywhere; }
  .tag { background: var(--tag-bg); color: var(--tag-fg); border-radius: 5px; padding: 1px 6px; font-size: 11px; margin-inline-start: 6px; }
</style>
</head>
<body>
<div class="app">
  <header class="topbar">
    <div class="brand">
      <span class="mark"><svg viewBox="0 0 48 48" aria-hidden="true"><g transform="translate(24 24) scale(1.2) translate(-24 -24)"><g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" opacity=".55"><line x1="23" y1="23" x2="12" y2="14"/><line x1="23" y1="23" x2="36" y2="12"/><line x1="23" y1="23" x2="37" y2="32"/><line x1="23" y1="23" x2="14" y2="36"/><line x1="36" y1="12" x2="37" y2="32"/></g><g fill="currentColor"><circle cx="23" cy="23" r="5"/><circle cx="12" cy="14" r="2.7"/><circle cx="36" cy="12" r="3.4"/><circle cx="37" cy="32" r="3"/><circle cx="14" cy="36" r="2.5"/></g></g></svg></span>
      <span>Sens<span class="dot">.</span> <span id="proj" class="muted"></span></span>
    </div>
    <div class="actions">
      <div class="menuwrap">
        <button id="btnLang" class="btn btn-ghost btn-icon" data-i18n-title="langLabel" data-i18n-aria="langLabel" title="Language" aria-label="Language" aria-haspopup="true" aria-expanded="false">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18"/></svg>
        </button>
        <div id="langMenu" class="menu" role="menu" hidden></div>
      </div>
      <button id="btnTheme" class="btn btn-ghost btn-icon" title="Toggle theme" aria-label="Toggle theme"></button>
      <div class="conn">
        <button id="btnConnect" class="btn btn-primary btn-icon" data-i18n-title="connect" data-i18n-aria="connect" title="Connect to Claude Code" aria-label="Connect to Claude Code">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"/></svg>
        </button>
        <span id="status" class="status off" title="Not connected"></span>
      </div>
      <div class="conn">
        <button id="btnReindex" class="btn btn-ghost btn-icon" data-i18n-title="reindex" data-i18n-aria="reindex" title="Rebuild index" aria-label="Rebuild index">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>
        </button>
        <span id="freshBadge" class="status" data-i18n-title="freshChecking" title="Checking index freshness…"></span>
      </div>
    </div>
  </header>
  <div id="toast" class="toast">
    <span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>
    <span class="msg" data-i18n="connected">Connected to Claude Code</span>
  </div>
  <div class="body">
    <div class="graphwrap">
      <canvas id="graph"></canvas>
      <div id="canvasMenuWrap" class="cmenu">
        <button id="btnCanvasMenu" class="cmenu-btn" data-i18n-title="menuOptions" data-i18n-aria="menuOptions" title="Options" aria-label="Options" aria-haspopup="true" aria-expanded="false">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="4.5" r="2.65"/><circle cx="12" cy="12" r="2.65"/><circle cx="12" cy="19.5" r="2.65"/></svg>
        </button>
        <div id="canvasMenu" class="menu cmenu-panel" role="menu" hidden></div>
      </div>
      <div id="crumbs" class="crumbs"></div>
      <div id="hint" class="hint" data-i18n="hint">Double-click a folder to open it · breadcrumb to go back · scroll to zoom · click a node for details</div>
      <div class="legend">
        <span><i class="d sq gray"></i><span data-i18n="legendFolder">folder</span></span>
        <span><i class="d gray"></i><span data-i18n="legendFile">file</span></span>
        <span><i class="d blue"></i><span data-i18n="legendExports">exports</span></span>
        <span><i class="d dead"></i><span data-i18n="legendDead">dead code</span></span>
        <span><i class="d ext"></i><span data-i18n="legendExternal">external</span></span>
      </div>
      <div class="zoomctl">
        <button id="zin" data-i18n-title="zoomIn" title="Zoom in">+</button>
        <button id="zout" data-i18n-title="zoomOut" title="Zoom out">−</button>
        <button id="zfit" data-i18n-title="zoomFit" title="Fit to view">⤢</button>
      </div>
    </div>
    <aside class="side">
      <div class="cards">
        <div class="card"><div class="n" id="s-files">0</div><div class="l" data-i18n="cardFiles">files</div></div>
        <div class="card"><div class="n" id="s-symbols">0</div><div class="l" data-i18n="cardSymbols">symbols</div></div>
        <div class="card"><div class="n" id="s-exported">0</div><div class="l" data-i18n="cardExported">exported</div></div>
        <div class="card"><div class="n" id="s-dead">0</div><div class="l" data-i18n="cardDead">dead-code</div></div>
      </div>
      <input id="search" placeholder="Search symbols…" data-i18n-ph="searchPh" autocomplete="off">
      <div id="results"></div>
      <h3 data-i18n="headSelected">Selected file</h3>
      <div id="panel"></div>
      <h3 data-i18n="headDead">Dead-code candidates</h3>
      <div id="dead"></div>
    </aside>
  </div>
</div>
<script>
(function(){
  // ---- i18n: LANGS + I18N dictionary are injected here from src/dashboard/i18n.ts ----
  ${i18nClientScript()}
  var LANG_KEY = 'sens-lang';
  function detectLang(){
    var nav = (navigator.language || 'en').toLowerCase();
    if(I18N[nav]) return nav;
    var b = nav.split('-')[0];
    return I18N[b] ? b : 'en';
  }
  function storedLang(){ try { return localStorage.getItem(LANG_KEY); } catch(e){ return null; } }
  function curLang(){ var s = storedLang(); return s && I18N[s] ? s : detectLang(); }
  var lang = curLang();
  function isRtl(code){ for(var i=0;i<LANGS.length;i++){ if(LANGS[i].code === code) return !!LANGS[i].rtl; } return false; }
  // t: current-locale string with English fallback so partial translations never break.
  function t(key){ var m = I18N[lang] || I18N.en; var v = m[key]; if(v == null) v = I18N.en[key]; return v == null ? key : v; }
  function tp(key, vals){ return t(key).replace(/\\{(\\w+)\\}/g, function(_, k){ return vals[k] != null ? vals[k] : '{' + k + '}'; }); }

  // ---- theme: follows the system by default, overridable with the toolbar toggle ----
  var THEME_KEY = 'sens-theme';
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function systemDark(){ return mq ? mq.matches : false; }
  function storedTheme(){ try { return localStorage.getItem(THEME_KEY); } catch(e){ return null; } }
  function resolvedDark(){ var t = storedTheme(); return t === 'light' || t === 'dark' ? t === 'dark' : systemDark(); }
  // The canvas graph is drawn imperatively, so its colors can't come from CSS — we
  // mirror the same theme decision here. Link colors are kept legible on both grounds.
  function palette(dark){
    return dark
      ? { bg:'#0f1116', link:'rgba(180,190,208,0.22)', linkHot:'#6f9bff', label:'#aeb6c2', blue:'#6f9bff', gray:'#69707d', dead:'#e0705d', ext:'#b49ad6', ring:'#e9edf3', dim:0.26 }
      : { bg:'#ffffff', link:'rgba(40,50,70,0.24)', linkHot:'#4f7cff', label:'#5b6472', blue:'#4f7cff', gray:'#9aa2b0', dead:'#e0533d', ext:'#a06fc0', ring:'#1a1c22', dim:0.28 };
  }
  var PAL = palette(resolvedDark());

  function themeIcon(dark){
    return dark
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  }
  function applyTheme(animate){
    var st = storedTheme();
    if(st === 'light' || st === 'dark'){ document.documentElement.setAttribute('data-theme', st); }
    else { document.documentElement.removeAttribute('data-theme'); }
    var dk = resolvedDark();
    PAL = palette(dk);
    var b = document.getElementById('btnTheme');
    if(b){
      b.innerHTML = themeIcon(dk); var lbl = dk ? t('themeToLight') : t('themeToDark'); b.title = lbl; b.setAttribute('aria-label', lbl);
      if(animate && b.firstElementChild){
        var svg = b.firstElementChild; svg.classList.add('theme-spin');
        svg.addEventListener('animationend', function(){ svg.classList.remove('theme-spin'); }, { once:true });
      }
    }
    ensureRunning();
  }

  // ---- language: applies the chosen locale to every user-facing string ----
  function applyStatic(){
    var i, els;
    els = document.querySelectorAll('[data-i18n]');
    for(i=0;i<els.length;i++){ els[i].textContent = t(els[i].getAttribute('data-i18n')); }
    els = document.querySelectorAll('[data-i18n-title]');
    for(i=0;i<els.length;i++){ els[i].title = t(els[i].getAttribute('data-i18n-title')); }
    els = document.querySelectorAll('[data-i18n-aria]');
    for(i=0;i<els.length;i++){ els[i].setAttribute('aria-label', t(els[i].getAttribute('data-i18n-aria'))); }
    els = document.querySelectorAll('[data-i18n-ph]');
    for(i=0;i<els.length;i++){ els[i].placeholder = t(els[i].getAttribute('data-i18n-ph')); }
  }
  function checkSvg(){
    var chk = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    chk.setAttribute('class', 'chk'); chk.setAttribute('viewBox', '0 0 24 24'); chk.setAttribute('fill', 'none');
    chk.setAttribute('stroke', 'currentColor'); chk.setAttribute('stroke-width', '3');
    chk.innerHTML = '<polyline points="20 6 9 17 4 12" stroke-linecap="round" stroke-linejoin="round"/>';
    return chk;
  }
  function buildLangMenu(){
    var host = document.getElementById('langMenu'); host.innerHTML = '';
    LANGS.forEach(function(L){
      var row = el('div', 'menuitem' + (L.code === lang ? ' active' : ''));
      row.setAttribute('role', 'menuitemradio');
      row.setAttribute('aria-checked', L.code === lang ? 'true' : 'false');
      row.appendChild(el('span', null, L.name));
      row.appendChild(checkSvg());
      row.addEventListener('click', function(){ setLang(L.code); });
      host.appendChild(row);
    });
  }

  // Export menu: each item downloads the full file graph in one exchange format. Node
  // attributes (symbols/exports/dead) ride along in every format except the CSV edge list.
  var EXPORTS = [
    { fmt:'gexf', name:'Gephi', ext:'.gexf' },
    { fmt:'graphml', name:'GraphML', ext:'.graphml' },
    { fmt:'dot', name:'Graphviz', ext:'.dot' },
    { fmt:'json', name:'JSON', ext:'.json' },
    { fmt:'csv', name:'CSV', ext:'.csv' }
  ];
  function downloadExport(fmt){
    var a = document.createElement('a');
    a.href = '/api/export?format=' + encodeURIComponent(fmt);
    a.download = ''; document.body.appendChild(a); a.click(); a.remove();
  }
  // Layout ("shape") options for the network type: force (the Gephi/ForceAtlas default) + static.
  var LAYOUT_ITEMS = [
    { id:'force', key:'layoutForce', hint:'ForceAtlas' },
    { id:'hierarchical', key:'layoutHierarchical', hint:'' },
    { id:'circular', key:'layoutCircular', hint:'' },
    { id:'grid', key:'layoutGrid', hint:'' }
  ];
  function setLayout(name){
    closeMenus();
    if(name === layout) return;
    layout = name;
    try { localStorage.setItem(LAYOUT_KEY, name); } catch(e){}
    buildCanvasMenu();
    // the layout only governs the node-link type; other types have their own geometry
    if(data && gtype === 'node-link'){ layoutNodes(); fitView(true); ensureRunning(); }
  }

  var GTYPE_KEY = 'sens-gtype';
  var GTYPES = ['node-link','matrix','chord','arc','treemap','sunburst','sankey','bundling'];
  var gtype = (function(){ try { var s = localStorage.getItem(GTYPE_KEY); return GTYPES.indexOf(s) >= 0 ? s : 'node-link'; } catch(e){ return 'node-link'; } })();
  var bbox = null;  // world-space bounds the active view wants framed (null → derive from node positions)
  var GTYPE_ITEMS = [
    { id:'node-link', name:'Network' }, { id:'matrix', name:'Matrix' },
    { id:'chord', name:'Chord' }, { id:'arc', name:'Arc' },
    { id:'treemap', name:'Treemap' }, { id:'sunburst', name:'Sunburst' },
    { id:'sankey', name:'Sankey' }, { id:'bundling', name:'Bundling' }
  ];
  function setGType(name){
    closeMenus();
    if(name === gtype || GTYPES.indexOf(name) < 0) return;
    gtype = name;
    try { localStorage.setItem(GTYPE_KEY, name); } catch(e){}
    buildCanvasMenu();
    if(data){ selected = null; hoverNode = null; applyView(); fitView(true); ensureRunning(); }
  }

  // The in-canvas ⋮ menu gathers the three graph controls (type · shape · export) into one
  // panel, so the top bar stays clean. Rebuilt on language / type / layout change.
  function menuHead(txt){ return el('div', 'menu-head', txt); }
  function buildCanvasMenu(){
    var host = document.getElementById('canvasMenu'); if(!host) return; host.innerHTML = '';
    host.appendChild(menuHead(t('menuType')));
    GTYPE_ITEMS.forEach(function(x){
      var row = el('div', 'menuitem' + (x.id === gtype ? ' active' : ''));
      row.setAttribute('role', 'menuitemradio'); row.setAttribute('aria-checked', x.id === gtype ? 'true' : 'false');
      row.appendChild(el('span', null, x.name)); row.appendChild(checkSvg());
      row.addEventListener('click', function(){ setGType(x.id); });
      host.appendChild(row);
    });
    if(gtype === 'node-link'){
      host.appendChild(menuHead(t('menuLayout')));
      LAYOUT_ITEMS.forEach(function(x){
        var row = el('div', 'menuitem' + (x.id === layout ? ' active' : ''));
        row.setAttribute('role', 'menuitemradio'); row.setAttribute('aria-checked', x.id === layout ? 'true' : 'false');
        var name = el('span', null, t(x.key)); if(x.hint) name.appendChild(el('span', 'menuext', ' · ' + x.hint));
        row.appendChild(name); row.appendChild(checkSvg());
        row.addEventListener('click', function(){ setLayout(x.id); });
        host.appendChild(row);
      });
    }
    host.appendChild(menuHead(t('menuExport')));
    EXPORTS.forEach(function(x){
      var row = el('div', 'menuitem'); row.setAttribute('role', 'menuitem');
      row.appendChild(el('span', null, x.name)); row.appendChild(el('span', 'menuext', x.ext));
      row.addEventListener('click', function(){ downloadExport(x.fmt); closeMenus(); });
      host.appendChild(row);
    });
  }
  function applyLang(){
    lang = curLang();
    document.documentElement.setAttribute('lang', lang);
    document.documentElement.setAttribute('dir', isRtl(lang) ? 'rtl' : 'ltr');
    document.title = t('docTitle');
    applyStatic();
    applyTheme();                 // refresh the theme button label in the new language
    if(lastFresh != null) setFreshBadge(lastFresh);
    buildLangMenu();
    buildCanvasMenu();
    if(data){ renderSidebar(); renderCrumbs(); }
  }
  function setLang(code){
    try { localStorage.setItem(LANG_KEY, code); } catch(e){}
    closeMenus();
    applyLang();
    spinGlobe();   // little confirmation spin after picking a language
  }
  // Three popovers (language, export, layout) share one open/close controller: opening one
  // closes the others, and an outside click or Escape closes them all.
  var MENUS = [['langMenu','btnLang'], ['canvasMenu','btnCanvasMenu']];
  function setMenuOpen(menuId, btnId, open){
    var m = document.getElementById(menuId); if(!m) return;
    m.hidden = !open; document.getElementById(btnId).setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function closeMenus(except){
    MENUS.forEach(function(x){ if(x[0] !== except) setMenuOpen(x[0], x[1], false); });
  }
  function openMenu(menuId, btnId){
    var willOpen = document.getElementById(menuId).hidden;
    closeMenus(willOpen ? menuId : null);
    setMenuOpen(menuId, btnId, willOpen);
  }
  function spinGlobe(){
    var btn = document.getElementById('btnLang'), svg = btn && btn.firstElementChild; if(!svg) return;
    svg.classList.remove('globe-spin');
    void btn.offsetWidth;   // reflow on the button — SVG elements have no offsetWidth, so reading the svg's never forced one and the spin only ran once
    svg.classList.add('globe-spin');
  }

  var canvas = document.getElementById('graph');
  var ctx = canvas.getContext('2d');
  var dpr = window.devicePixelRatio || 1;
  var data = null, nodes = [], links = [], byId = {}, neigh = {};
  var rawNodes = [], rawLinks = [], curPath = '';  // hierarchical folder navigation state
  var selected = null, hoverNode = null, dragging = null, raf = 0;
  var lastFresh = null;   // remembered freshness state so its tooltip re-localizes on language change
  var themingT = 0;       // timer that clears the theme cross-fade window
  var alpha = 0;
  var view = { w: 0, h: 0 };
  // screen = world * k + (x,y)
  var tf = { k: 1, x: 0, y: 0 };
  var target = { k: 1, x: 0, y: 0 };

  // ---- graph layout: force (ForceAtlas-style, the Gephi default) or a static arrangement ----
  var LAYOUT_KEY = 'sens-layout';
  function storedLayout(){ try { return localStorage.getItem(LAYOUT_KEY); } catch(e){ return null; } }
  var LAYOUTS = ['force','hierarchical','circular','grid'];
  var layout = (function(){ var s = storedLayout(); return LAYOUTS.indexOf(s) >= 0 ? s : 'force'; })();

  function api(path, method){ return fetch(path, { method: method || 'GET' }).then(function(r){ return r.json(); }); }
  function el(tag, cls, text){ var e = document.createElement(tag); if(cls) e.className = cls; if(text != null) e.textContent = text; return e; }
  function setText(id, v){ document.getElementById(id).textContent = v; }
  function base(p){ return p.split('/').pop(); }
  function clamp(v, lo, hi){ return v < lo ? lo : (v > hi ? hi : v); }
  function toWorld(t, sx, sy){ return { x:(sx - t.x)/t.k, y:(sy - t.y)/t.k }; }

  // ---- hierarchical aggregation (folder map with file drill-down) ----
  // The API returns a flat file graph; we aggregate it on the client so a large project
  // opens as a readable folder map (~dozens of nodes) instead of a 700-node hairball.
  function levelGroups(prefix){
    var groups = {}, order = [], plen = prefix.length;
    for(var i=0;i<rawNodes.length;i++){
      var f = rawNodes[i];
      if(prefix && f.id.indexOf(prefix) !== 0) continue;
      var rest = f.id.slice(plen), slash = rest.indexOf('/'), id, g;
      if(slash === -1){
        id = f.id; g = groups[id];
        if(!g){ g = groups[id] = { id:id, label:f.label, folder:false, symbols:0, exported:0, dead:0, files:0 }; order.push(g); }
      } else {
        var seg = rest.slice(0, slash); id = prefix + seg + '/'; g = groups[id];
        if(!g){ g = groups[id] = { id:id, label:seg, folder:true, prefix:id, symbols:0, exported:0, dead:0, files:0 }; order.push(g); }
      }
      g.symbols += f.symbols; g.exported += f.exported; g.dead += f.dead; g.files += 1;
    }
    return order;
  }
  function groupIdOf(path, prefix){
    if(prefix && path.indexOf(prefix) !== 0) return null;
    var rest = path.slice(prefix.length), slash = rest.indexOf('/');
    return slash === -1 ? path : prefix + rest.slice(0, slash) + '/';
  }
  // A dependency that leaves the current level is collapsed to the segment where its
  // path diverges from curPath — so an outward edge lands on one compact "external"
  // reference node (e.g. the sibling folder over in "a/") instead of vanishing. This is
  // what keeps every drilled-in view showing how its items connect, not just dots.
  function externalId(path){
    var cur = curPath.split('/'); cur.pop();       // dir segments of curPath
    var p = path.split('/');                        // last item is the filename
    var m = 0;
    while(m < cur.length && m < p.length - 1 && cur[m] === p[m]) m++;
    var seg = p[m], isFolder = m < p.length - 1;
    var prefix = p.slice(0, m).join('/'); if(prefix) prefix += '/';
    return { id: isFolder ? prefix + seg + '/' : prefix + seg, label: seg, folder: isFolder };
  }
  function externalStat(id, folder){
    var s = 0, e = 0, d = 0, f = 0;
    for(var i=0;i<rawNodes.length;i++){
      var n = rawNodes[i], hit = folder ? n.id.indexOf(id) === 0 : n.id === id;
      if(!hit) continue; s += n.symbols; e += n.exported; d += n.dead; f++;
    }
    return { symbols:s, exported:e, dead:d, files:f };
  }
  function buildLevel(){
    var order = levelGroups(curPath), ext = {};
    var lmap = {}, agg = [];
    function extNode(path){
      var g = externalId(path), e = ext[g.id];
      if(!e){
        var st = externalStat(g.id, g.folder);
        e = ext[g.id] = { id:g.id, label:g.label, folder:g.folder, external:true,
                          prefix: g.folder ? g.id : undefined,
                          symbols:st.symbols, exported:st.exported, dead:st.dead, files:st.files };
        order.push(e);
      }
      return e.id;
    }
    for(var j=0;j<rawLinks.length;j++){
      var sv = groupIdOf(rawLinks[j].source, curPath), tv = groupIdOf(rawLinks[j].target, curPath);
      var s, t, isExt = false;
      if(sv && tv){ s = sv; t = tv; }
      else if(sv){ s = sv; t = extNode(rawLinks[j].target); isExt = true; }
      else if(tv){ s = extNode(rawLinks[j].source); t = tv; isExt = true; }
      else continue;
      if(s === t) continue;
      var key = s + '\\u0000' + t, L = lmap[key];
      if(L){ L.weight++; continue; }
      L = { source:s, target:t, weight:1, ext:isExt }; lmap[key] = L; agg.push(L);
    }
    return { order:order, links:agg };
  }
  // deepest directory prefix shared by every file — so we skip past a lone top "src/" wrapper.
  function commonDir(){
    if(!rawNodes.length) return '';
    var parts = rawNodes[0].id.split('/'); parts.pop();
    for(var i=1;i<rawNodes.length;i++){
      var p = rawNodes[i].id.split('/'); p.pop();
      var m = 0; while(m < parts.length && m < p.length && parts[m] === p[m]) m++;
      parts.length = m; if(!parts.length) break;
    }
    return parts.length ? parts.join('/') + '/' : '';
  }
  function setRaw(){
    rawNodes = (data.graph && data.graph.nodes) || [];
    rawLinks = (data.graph && data.graph.links) || [];
    curPath = commonDir();
  }
  function childrenOf(prefix){ return levelGroups(prefix); }
  function drillTo(prefix){
    if(curPath === prefix) return;
    curPath = prefix; selected = null; hoverNode = null;
    initGraph(); renderPanel(); ensureRunning();
  }
  function revealFile(fileId){
    var cut = fileId.lastIndexOf('/'), dir = cut >= 0 ? fileId.slice(0, cut + 1) : '';
    if(curPath !== dir){ curPath = dir; hoverNode = null; initGraph(); }
    var n = byId[fileId]; if(n){ select(n); focusNode(n); }
  }
  function renderCrumbs(){
    var host = document.getElementById('crumbs'); host.innerHTML = '';
    var segs = curPath ? curPath.replace(/\\/$/, '').split('/') : [];
    var root = el('span', 'cr' + (segs.length ? '' : ' cur'), (data && data.project) || t('root'));
    root.addEventListener('click', function(){ drillTo(''); });
    host.appendChild(root);
    var acc = '';
    segs.forEach(function(seg, i){
      acc += seg + '/';
      host.appendChild(el('span', 'sep', '/'));
      var last = i === segs.length - 1;
      var c = el('span', 'cr' + (last ? ' cur' : ''), seg);
      if(!last){ (function(p){ c.addEventListener('click', function(){ drillTo(p); }); })(acc); }
      host.appendChild(c);
    });
  }

  function resize(){
    var wrap = canvas.parentNode;
    dpr = window.devicePixelRatio || 1;
    view.w = wrap.clientWidth; view.h = wrap.clientHeight;
    canvas.width = view.w * dpr; canvas.height = view.h * dpr;
    canvas.style.width = view.w + 'px'; canvas.style.height = view.h + 'px';
    ensureRunning();
  }

  function initGraph(){
    var lvl = buildLevel();
    nodes = lvl.order.map(function(g){
      return { id:g.id, label:g.label, folder:g.folder, external:g.external, prefix:g.prefix,
               symbols:g.symbols, exported:g.exported, dead:g.dead, files:g.files,
               x:0, y:0, vx:0, vy:0, fixed:false, deg:0 };
    });
    byId = {}; nodes.forEach(function(n){ byId[n.id] = n; });
    links = lvl.links;
    neigh = {};
    nodes.forEach(function(n){ neigh[n.id] = {}; });
    links.forEach(function(l){
      if(neigh[l.source]) neigh[l.source][l.target] = true;
      if(neigh[l.target]) neigh[l.target][l.source] = true;
    });
    nodes.forEach(function(n){ var d = 0, m = neigh[n.id]; for(var kk in m) d++; n.deg = d; });
    renderCrumbs();
    applyView();
    fitView(false);
  }

  // Position/geometry for the active graph type: node-link runs a physics layout, every other
  // type computes closed-form geometry and pins the frame (alpha 0, no physics).
  function applyView(){
    bbox = null;
    var d = VIEWS[gtype];
    if(d){ d.build(); alpha = 0; }
    else layoutNodes();
  }

  // Position every node according to the active layout. The force layout pre-settles with a
  // cooling schedule (stable even for large graphs); the static layouts are O(n) closed-form
  // placements — cheap no matter how huge the graph is — and pin nodes so physics stays off.
  function layoutNodes(){
    if(!nodes.length) return;
    if(layout === 'hierarchical') hierLayout();
    else if(layout === 'circular') circularLayout();
    else if(layout === 'grid') gridLayout();
    else forceLayout();
  }
  function forceLayout(){
    var n = nodes.length, R = 40 + n * 6;
    nodes.forEach(function(nd, i){
      var a = (i / Math.max(1, n)) * PI2;
      nd.x = Math.cos(a) * R; nd.y = Math.sin(a) * R; nd.vx = 0; nd.vy = 0; nd.fixed = false;
    });
    // Constant high alpha diverges/oscillates at scale, so cool it down over the pre-settle.
    alpha = 1;
    for(var s = 0; s < 300; s++){ physics(); alpha *= 0.985; }
    alpha = 0.06;
  }
  function circularLayout(){
    var n = nodes.length, R = Math.max(120, (n * 70) / PI2);
    nodes.forEach(function(nd, i){
      var a = (i / n) * PI2 - Math.PI / 2;
      nd.x = Math.cos(a) * R; nd.y = Math.sin(a) * R; nd.vx = 0; nd.vy = 0; nd.fixed = true;
    });
    alpha = 0;
  }
  function gridLayout(){
    var n = nodes.length, cols = Math.ceil(Math.sqrt(n)), gap = 90;
    var rows = Math.ceil(n / cols), w = (cols - 1) * gap, h = (rows - 1) * gap;
    nodes.forEach(function(nd, i){
      nd.x = (i % cols) * gap - w / 2; nd.y = Math.floor(i / cols) * gap - h / 2;
      nd.vx = 0; nd.vy = 0; nd.fixed = true;
    });
    alpha = 0;
  }
  // Layered top-down by dependency depth: an importer sits above the files it imports.
  // Longest-path levels via relaxation, capped so an import cycle can't loop forever.
  function hierLayout(){
    var level = {}, i;
    nodes.forEach(function(nd){ level[nd.id] = 0; });
    var cap = nodes.length, changed = true, iter = 0;
    while(changed && iter++ < cap){
      changed = false;
      for(i = 0; i < links.length; i++){
        var s = links[i].source, t = links[i].target;
        if(level[s] == null || level[t] == null) continue;
        if(level[t] < level[s] + 1){ level[t] = Math.min(level[s] + 1, cap); changed = true; }
      }
    }
    var byLevel = {}, maxL = 0;
    nodes.forEach(function(nd){ var L = level[nd.id] || 0; (byLevel[L] = byLevel[L] || []).push(nd); if(L > maxL) maxL = L; });
    var rowGap = 120, colGap = 90;
    for(var L = 0; L <= maxL; L++){
      var arr = byLevel[L] || [], w = (arr.length - 1) * colGap;
      arr.forEach(function(nd, idx){
        nd.x = idx * colGap - w / 2; nd.y = L * rowGap - (maxL * rowGap) / 2;
        nd.vx = 0; nd.vy = 0; nd.fixed = true;
      });
    }
    alpha = 0;
  }

  function radius(n){ return n.folder ? 7 + Math.min(20, Math.sqrt(n.files) * 3.2) : 5 + Math.min(15, n.symbols * 0.8); }
  function color(n){ return n.external ? PAL.ext : (n.dead > 0 ? PAL.dead : (n.exported > 0 ? PAL.blue : PAL.gray)); }

  function physics(){
    var N = nodes, i, j;
    var REP = 1700, SPRING = 0.02, LINK = 78, GRAV = 0.014, DAMP = 0.82;
    for(i=0;i<N.length;i++){
      for(j=i+1;j<N.length;j++){
        var dx=N[j].x-N[i].x, dy=N[j].y-N[i].y, d2=dx*dx+dy*dy+0.01, d=Math.sqrt(d2);
        var f=REP/d2, fx=dx/d*f, fy=dy/d*f;
        N[i].vx-=fx; N[i].vy-=fy; N[j].vx+=fx; N[j].vy+=fy;
      }
    }
    for(i=0;i<links.length;i++){
      var a=byId[links[i].source], b=byId[links[i].target]; if(!a||!b) continue;
      var lx=b.x-a.x, ly=b.y-a.y, ld=Math.sqrt(lx*lx+ly*ly)||0.01, lf=(ld-LINK)*SPRING;
      a.vx+=lx/ld*lf; a.vy+=ly/ld*lf; b.vx-=lx/ld*lf; b.vy-=ly/ld*lf;
    }
    for(i=0;i<N.length;i++){
      var n=N[i];
      n.vx+=(0-n.x)*GRAV; n.vy+=(0-n.y)*GRAV;
      n.vx*=DAMP; n.vy*=DAMP;
      if(n!==dragging && !n.fixed){
        // Cap the per-step displacement so a close-range repulsion spike can't blow
        // the layout up at scale — constant-alpha Euler is otherwise unstable for large N.
        var sx=n.vx*alpha, sy=n.vy*alpha, sm=sx*sx+sy*sy;
        if(sm > 900){ var sc=30/Math.sqrt(sm); sx*=sc; sy*=sc; }
        n.x+=sx; n.y+=sy;
      }
    }
  }

  function easeView(){
    var e = 0.22;
    tf.k += (target.k - tf.k) * e;
    tf.x += (target.x - tf.x) * e;
    tf.y += (target.y - tf.y) * e;
    if(Math.abs(target.k-tf.k) < 0.0005 && Math.abs(target.x-tf.x) < 0.08 && Math.abs(target.y-tf.y) < 0.08){
      tf.k = target.k; tf.x = target.x; tf.y = target.y; return true;
    }
    return false;
  }

  function loop(){
    // Physics only drives the node-link force layout; every other type is closed-form geometry.
    var forceOn = gtype === 'node-link' && layout === 'force';
    var hot = forceOn && (alpha > 0.02 || dragging);
    if(hot){ physics(); if(!dragging) alpha *= 0.985; }
    var settled = easeView();
    draw();
    if(hot || dragging || !settled){ raf = requestAnimationFrame(loop); } else { raf = 0; }
  }
  function ensureRunning(){ if(!raf) raf = requestAnimationFrame(loop); }
  function reheat(a){ if(gtype !== 'node-link' || layout !== 'force'){ ensureRunning(); return; } alpha = Math.max(alpha, a == null ? 0.6 : a); ensureRunning(); }

  var PI2 = Math.PI * 2;

  function nodeShape(n, r){
    if(n.folder){
      var s = r * 1.02, cr = Math.min(s * 0.34, r);
      ctx.beginPath();
      if(ctx.roundRect){ ctx.roundRect(n.x - s, n.y - s, s * 2, s * 2, cr); }
      else { ctx.rect(n.x - s, n.y - s, s * 2, s * 2); }
    } else {
      ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, PI2);
    }
  }

  // Every graph type draws in the same world space (so pan/zoom/fit are shared); draw()
  // just clears, applies the transform, and dispatches to the active type's renderer.
  function draw(){
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,view.w,view.h);
    ctx.setTransform(tf.k*dpr, 0, 0, tf.k*dpr, tf.x*dpr, tf.y*dpr);
    var d = VIEWS[gtype]; (d && d.draw ? d.draw : drawNodeLink)();
  }

  function drawNodeLink(){
    var focus = hoverNode || selected;
    var nb = focus ? neigh[focus.id] : null;
    var lw = 1/tf.k;

    // links — thin and restrained; the focused node's edges are emphasised
    for(var i=0;i<links.length;i++){
      var a=byId[links[i].source], b=byId[links[i].target]; if(!a||!b) continue;
      var touch = focus && (links[i].source===focus.id || links[i].target===focus.id);
      ctx.globalAlpha = focus ? (touch ? 1 : 0.35) : 1;
      ctx.strokeStyle = touch ? PAL.linkHot : PAL.link;
      ctx.lineWidth = (touch ? 1.6 : Math.min(0.8 + Math.log((links[i].weight||1) + 1) * 0.5, 3)) * lw;
      if(links[i].ext){ ctx.setLineDash([4*lw, 3*lw]); }
      ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
      if(links[i].ext){ ctx.setLineDash([]); }
    }
    ctx.globalAlpha = 1;

    // nodes — circles for files, rounded squares for folders; flat fills + cutout ring
    ctx.textAlign='center'; ctx.textBaseline='alphabetic';
    ctx.font = (11/tf.k) + 'px ui-sans-serif, system-ui, sans-serif';
    for(var k=0;k<nodes.length;k++){
      var n=nodes[k], r=radius(n);
      var active = !focus || n===focus || (nb && nb[n.id]);
      ctx.globalAlpha = active ? 1 : PAL.dim;
      nodeShape(n, r);
      // external reference nodes read as "elsewhere": softer fill + a dashed outline
      if(n.external){
        ctx.globalAlpha = active ? 0.55 : PAL.dim * 0.7; ctx.fillStyle = color(n); ctx.fill();
        ctx.globalAlpha = active ? 1 : PAL.dim;
        ctx.setLineDash([3*lw, 3*lw]); ctx.lineWidth = 1.3*lw; ctx.strokeStyle = PAL.ext; ctx.stroke(); ctx.setLineDash([]);
      } else {
        ctx.fillStyle = color(n); ctx.fill();
        ctx.lineWidth = 1.5*lw; ctx.strokeStyle = PAL.bg; ctx.stroke();
      }
      if(selected===n){ ctx.lineWidth = 2*lw; ctx.strokeStyle = PAL.ring; ctx.stroke(); }
      else if(n===focus){ ctx.lineWidth = 1.6*lw; ctx.strokeStyle = PAL.ring; ctx.stroke(); }
      // smart labels: folders and external anchors are always named; files only when zoomed in, focused, or a hub
      if(active && (n.folder || n.external || n===focus || tf.k >= 0.9 || n.deg >= 8)){
        ctx.fillStyle = PAL.label; ctx.fillText(n.label, n.x, n.y - r - 6*lw);
      }
    }
    ctx.globalAlpha = 1;
  }

  function nodeAt(sx, sy){
    var w = toWorld(tf, sx, sy);
    var d = VIEWS[gtype];
    if(d && d.hit) return d.hit(w.x, w.y);
    return hitNodeLink(w.x, w.y);
  }
  function hitNodeLink(wx, wy){
    for(var i=nodes.length-1;i>=0;i--){
      var n=nodes[i], r=radius(n)+4/tf.k, dx=wx-n.x, dy=wy-n.y;
      if(n.folder){ if(Math.abs(dx)<=r && Math.abs(dy)<=r) return n; }
      else if(dx*dx+dy*dy<=r*r) return n;
    }
    return null;
  }

  // ================= alternative graph types =================
  // Each renderer consumes the same per-level nodes/links the node-link view uses, so drilling,
  // selection and the side panel work identically. build() sets geometry + bbox; draw() paints;
  // hit(wx,wy) returns the group under a world point. External-reference nodes are dropped from the
  // space-filling types (treemap/sunburst) where they have no meaning.
  function sizeOf(n){ return Math.max(1, n.folder ? n.files : n.symbols); }
  function byGroup(a, b){
    var ax = a.external ? 2 : (a.folder ? 0 : 1), bx = b.external ? 2 : (b.folder ? 0 : 1);
    if(ax !== bx) return ax - bx;
    return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
  }
  function ordered(){ return nodes.slice().sort(byGroup); }
  function sumBy(arr, f){ var s = 0; for(var i=0;i<arr.length;i++) s += f(arr[i]); return s; }

  // --- adjacency matrix: rows/cols = files, a painted cell = a dependency. Scales to huge graphs. ---
  var mat = null;
  function buildMatrix(){
    var ord = ordered(), n = ord.length, idx = {};
    ord.forEach(function(nd, i){ idx[nd.id] = i; });
    var cell = 20, span = n * cell, x0 = -span / 2, y0 = -span / 2, cells = [];
    for(var i=0;i<links.length;i++){ var r = idx[links[i].source], c = idx[links[i].target]; if(r == null || c == null) continue; cells.push({ r:r, c:c, w:links[i].weight || 1 }); }
    mat = { ord:ord, idx:idx, n:n, cell:cell, x0:x0, y0:y0, cells:cells };
    var gut = 160;
    bbox = { minx:x0 - gut, miny:y0 - gut, maxx:x0 + span, maxy:y0 + span };
  }
  function drawMatrix(){
    if(!mat) return; var lw = 1/tf.k, n = mat.n, cell = mat.cell, x0 = mat.x0, y0 = mat.y0, g;
    var focus = hoverNode || selected, fi = focus ? mat.idx[focus.id] : -1;
    ctx.strokeStyle = PAL.link; ctx.lineWidth = 0.5 * lw; ctx.globalAlpha = 0.5; ctx.beginPath();
    for(g=0; g<=n; g++){ var p = g*cell; ctx.moveTo(x0, y0+p); ctx.lineTo(x0+n*cell, y0+p); ctx.moveTo(x0+p, y0); ctx.lineTo(x0+p, y0+n*cell); }
    ctx.stroke(); ctx.globalAlpha = 1;
    for(var i=0;i<mat.cells.length;i++){ var cl = mat.cells[i], x = x0+cl.c*cell, y = y0+cl.r*cell, hot = fi>=0 && (cl.r===fi || cl.c===fi);
      ctx.fillStyle = hot ? PAL.linkHot : PAL.blue; ctx.globalAlpha = hot ? 1 : Math.min(0.9, 0.4 + Math.log(cl.w+1)*0.3);
      ctx.fillRect(x+1.5*lw, y+1.5*lw, cell-3*lw, cell-3*lw); }
    ctx.globalAlpha = 1; ctx.font = (12/tf.k) + 'px ui-sans-serif, system-ui, sans-serif';
    for(var j=0;j<n;j++){ var nd = mat.ord[j], on = fi<0 || fi===j;
      ctx.globalAlpha = on ? 1 : 0.35; ctx.fillStyle = (fi===j) ? PAL.linkHot : PAL.label;
      ctx.textAlign = 'end'; ctx.textBaseline = 'middle'; ctx.fillText(nd.label, x0 - 6*lw, y0 + j*cell + cell/2);
      ctx.save(); ctx.translate(x0 + j*cell + cell/2, y0 - 6*lw); ctx.rotate(-Math.PI/4);
      ctx.textAlign = 'start'; ctx.textBaseline = 'middle'; ctx.fillText(nd.label, 0, 0); ctx.restore(); }
    ctx.globalAlpha = 1;
  }
  function hitMatrix(wx, wy){
    if(!mat) return null; var n = mat.n, cell = mat.cell, x0 = mat.x0, y0 = mat.y0;
    var inRows = wy >= y0 && wy <= y0 + n*cell, inCols = wx >= x0 && wx <= x0 + n*cell;
    if(inRows && wx < x0 && wx > x0 - 160) return mat.ord[Math.floor((wy - y0)/cell)];
    if(inCols && wy < y0 && wy > y0 - 160) return mat.ord[Math.floor((wx - x0)/cell)];
    if(inRows && inCols) return mat.ord[Math.floor((wy - y0)/cell)];
    return null;
  }

  // --- chord / dependency wheel: nodes on a ring, arcs curve through the centre ---
  var chord = null;
  function buildChord(){
    var ord = ordered(), n = ord.length, R = Math.max(120, (n * 48) / PI2);
    ord.forEach(function(nd, i){ var a = (i/n)*PI2 - Math.PI/2; nd.x = Math.cos(a)*R; nd.y = Math.sin(a)*R; nd._a = a; });
    chord = { ord:ord, R:R }; bbox = { minx:-R*1.4, miny:-R*1.4, maxx:R*1.4, maxy:R*1.4 };
  }
  function drawRing(ord, curved){
    var lw = 1/tf.k, focus = hoverNode || selected, nb = focus ? neigh[focus.id] : null, beta = 0.82, i;
    for(i=0;i<links.length;i++){ var a=byId[links[i].source], b=byId[links[i].target]; if(!a||!b) continue;
      var touch = focus && (links[i].source===focus.id || links[i].target===focus.id);
      ctx.globalAlpha = focus ? (touch ? 1 : (curved ? 0.08 : 0.1)) : (curved ? 0.45 : 0.5);
      ctx.strokeStyle = touch ? PAL.linkHot : PAL.link; ctx.lineWidth = (touch ? 1.8 : 0.9) * lw; ctx.beginPath(); ctx.moveTo(a.x, a.y);
      if(curved) ctx.bezierCurveTo(a.x*beta, a.y*beta, b.x*beta, b.y*beta, b.x, b.y);
      else ctx.quadraticCurveTo(0, 0, b.x, b.y);
      ctx.stroke(); }
    ctx.globalAlpha = 1; ctx.font = (11/tf.k) + 'px ui-sans-serif, system-ui, sans-serif'; ctx.textBaseline = 'middle';
    for(i=0;i<ord.length;i++){ var nd = ord[i], active = !focus || nd===focus || (nb && nb[nd.id]);
      ctx.globalAlpha = active ? 1 : PAL.dim; ctx.beginPath(); ctx.arc(nd.x, nd.y, (nd.folder?5:4)*lw, 0, PI2); ctx.fillStyle = color(nd); ctx.fill();
      if(active){ var right = Math.cos(nd._a) >= 0; ctx.save(); ctx.translate(nd.x, nd.y); ctx.rotate(nd._a + (right?0:Math.PI));
        ctx.textAlign = right ? 'start' : 'end'; ctx.fillStyle = PAL.label; ctx.fillText(nd.label, (right?1:-1)*8*lw, 0); ctx.restore(); } }
    ctx.globalAlpha = 1;
  }
  function drawChord(){ if(chord) drawRing(chord.ord, false); }
  function hitRing(ord, wx, wy){
    if(!ord) return null; var best=null, bd=1e9;
    for(var i=0;i<ord.length;i++){ var nd=ord[i], dx=wx-nd.x, dy=wy-nd.y, d=dx*dx+dy*dy; if(d<bd){ bd=d; best=nd; } }
    var thr = 12/tf.k; return bd <= thr*thr ? best : null;
  }
  function hitChord(wx, wy){ return hitRing(chord && chord.ord, wx, wy); }

  // --- hierarchical edge bundling: same ring, edges bundled toward the centre ---
  var bundle = null;
  function buildBundling(){
    var ord = ordered(), n = ord.length, R = Math.max(130, (n * 46) / PI2);
    ord.forEach(function(nd, i){ var a = (i/n)*PI2 - Math.PI/2; nd.x = Math.cos(a)*R; nd.y = Math.sin(a)*R; nd._a = a; });
    bundle = { ord:ord, R:R }; bbox = { minx:-R*1.4, miny:-R*1.4, maxx:R*1.4, maxy:R*1.4 };
  }
  function drawBundling(){ if(bundle) drawRing(bundle.ord, true); }
  function hitBundling(wx, wy){ return hitRing(bundle && bundle.ord, wx, wy); }

  // --- arc diagram: nodes on a line, dependencies as semicircles above ---
  var arc = null;
  function buildArc(){
    var ord = ordered(), n = ord.length, gap = Math.max(44, Math.min(90, 760/Math.max(1,n))), w = (n-1)*gap;
    ord.forEach(function(nd, i){ nd.x = i*gap - w/2; nd.y = 0; });
    arc = { ord:ord, gap:gap, w:w }; bbox = { minx:-w/2 - 30, miny:-w/2 - 20, maxx:w/2 + 30, maxy:90 };
  }
  function drawArc(){
    if(!arc) return; var lw = 1/tf.k, focus = hoverNode || selected, nb = focus ? neigh[focus.id] : null, i;
    for(i=0;i<links.length;i++){ var a=byId[links[i].source], b=byId[links[i].target]; if(!a||!b) continue;
      var cx=(a.x+b.x)/2, r=Math.abs(b.x-a.x)/2, touch = focus && (links[i].source===focus.id || links[i].target===focus.id);
      ctx.globalAlpha = focus ? (touch ? 1 : 0.12) : 0.55; ctx.strokeStyle = touch ? PAL.linkHot : PAL.link; ctx.lineWidth = (touch ? 1.8 : 0.9) * lw;
      ctx.beginPath(); ctx.arc(cx, 0, r, Math.PI, 0, false); ctx.stroke(); }   // upper semicircle (y is down)
    ctx.globalAlpha = 1; ctx.font = (11/tf.k) + 'px ui-sans-serif, system-ui, sans-serif';
    for(i=0;i<arc.ord.length;i++){ var nd = arc.ord[i], active = !focus || nd===focus || (nb && nb[nd.id]);
      ctx.globalAlpha = active ? 1 : PAL.dim; ctx.beginPath(); ctx.arc(nd.x, 0, (nd.folder?5:4)*lw, 0, PI2); ctx.fillStyle = color(nd); ctx.fill();
      if(active){ ctx.save(); ctx.translate(nd.x, 10*lw); ctx.rotate(Math.PI/4); ctx.textAlign = 'start'; ctx.textBaseline = 'middle'; ctx.fillStyle = PAL.label; ctx.fillText(nd.label, 0, 0); ctx.restore(); } }
    ctx.globalAlpha = 1;
  }
  function hitArc(wx, wy){
    if(!arc) return null; var best=null, bd=1e9;
    for(var i=0;i<arc.ord.length;i++){ var nd=arc.ord[i], dx=wx-nd.x, dy=wy, d=dx*dx+dy*dy; if(d<bd){ bd=d; best=nd; } }
    var thr = 16/tf.k; return bd <= thr*thr ? best : null;
  }

  // --- treemap: squarified rectangles, area by symbol/file count, nested by colour ---
  var tree = null;
  function squarify(items, x, y, w, h){
    var out = [], vals = items.map(function(it){ return { node:it.node, v:it.v }; }), total = 0, i;
    for(i=0;i<vals.length;i++) total += vals[i].v;
    if(total <= 0) return out;
    var sc = (w*h) / total; for(i=0;i<vals.length;i++) vals[i].area = vals[i].v * sc;
    var rect = { x:x, y:y, w:w, h:h }, row = [], k = 0;
    function worst(rw, s){ var sum=0, mx=-Infinity, mn=Infinity; for(var q=0;q<rw.length;q++){ sum+=rw[q].area; if(rw[q].area>mx)mx=rw[q].area; if(rw[q].area<mn)mn=rw[q].area; } var s2=s*s, sm2=sum*sum; return Math.max((s2*mx)/sm2, sm2/(s2*mn)); }
    function place(rw){ var sum=0, q; for(q=0;q<rw.length;q++) sum+=rw[q].area;
      if(rect.w >= rect.h){ var cw = sum / rect.h, cy = rect.y; for(q=0;q<rw.length;q++){ var rh = rw[q].area / cw; out.push({ node:rw[q].node, x:rect.x, y:cy, w:cw, h:rh }); cy += rh; } rect.x += cw; rect.w -= cw; }
      else { var ch = sum / rect.w, cx = rect.x; for(q=0;q<rw.length;q++){ var rwid = rw[q].area / ch; out.push({ node:rw[q].node, x:cx, y:rect.y, w:rwid, h:ch }); cx += rwid; } rect.y += ch; rect.h -= ch; } }
    while(k < vals.length){ var s = Math.min(rect.w, rect.h), withNext = row.concat([vals[k]]);
      if(row.length === 0 || worst(withNext, s) <= worst(row, s)){ row = withNext; k++; } else { place(row); row = []; } }
    if(row.length) place(row);
    return out;
  }
  function buildTreemap(){
    var items = nodes.filter(function(n){ return !n.external; }).map(function(n){ return { node:n, v:sizeOf(n) }; });
    items.sort(function(a, b){ return b.v - a.v; });
    var W = 900, H = 620;
    tree = { rects: squarify(items, 0, 0, W, H), W:W, H:H };
    bbox = { minx:-12, miny:-12, maxx:W+12, maxy:H+12 };
  }
  function drawTreemap(){
    if(!tree) return; var lw = 1/tf.k, focus = hoverNode || selected;
    ctx.textBaseline = 'top'; ctx.textAlign = 'start'; ctx.font = (12/tf.k) + 'px ui-sans-serif, system-ui, sans-serif';
    for(var i=0;i<tree.rects.length;i++){ var rc = tree.rects[i], n = rc.node, active = !focus || n === focus;
      ctx.globalAlpha = active ? 1 : PAL.dim; ctx.fillStyle = color(n); ctx.fillRect(rc.x, rc.y, rc.w, rc.h);
      ctx.globalAlpha = 1; ctx.lineWidth = 1.2*lw; ctx.strokeStyle = PAL.bg; ctx.strokeRect(rc.x, rc.y, rc.w, rc.h);
      if(n === selected || n === focus){ ctx.lineWidth = 2*lw; ctx.strokeStyle = PAL.ring; ctx.strokeRect(rc.x, rc.y, rc.w, rc.h); }
      var pad = 5*lw, lbl = n.folder ? n.label + '/' : n.label;
      if(rc.w > 34 && rc.h > 18 && ctx.measureText(lbl).width <= rc.w - 2*pad){ ctx.fillStyle = '#ffffff'; ctx.globalAlpha = active ? 1 : PAL.dim; ctx.fillText(lbl, rc.x + pad, rc.y + pad); ctx.globalAlpha = 1; } }
    ctx.globalAlpha = 1;
  }
  function hitTreemap(wx, wy){
    if(!tree) return null;
    for(var i=0;i<tree.rects.length;i++){ var rc = tree.rects[i]; if(wx>=rc.x && wx<=rc.x+rc.w && wy>=rc.y && wy<=rc.y+rc.h) return rc.node; }
    return null;
  }

  // --- sunburst: inner ring = this level, outer ring = each folder's children ---
  var sun = null;
  function buildSunburst(){
    var items = nodes.filter(function(n){ return !n.external; }), total = sumBy(items, sizeOf) || 1;
    var r0 = 60, r1 = 150, r2 = 230, a = -Math.PI/2, arcs = [];
    items.forEach(function(n){ var span = (sizeOf(n)/total) * PI2, a1 = a + span;
      arcs.push({ node:n, a0:a, a1:a1, r0:r0, r1:r1 });
      if(n.folder){ var kids = childrenOf(n.prefix), kt = sumBy(kids, sizeOf) || 1, ca = a;
        for(var j=0;j<kids.length;j++){ var kf = sizeOf(kids[j])/kt, ka1 = ca + kf*span; arcs.push({ node:kids[j], a0:ca, a1:ka1, r0:r1, r1:r2, child:true }); ca = ka1; } }
      a = a1; });
    sun = { arcs:arcs, r2:r2 }; bbox = { minx:-r2*1.15, miny:-r2*1.15, maxx:r2*1.15, maxy:r2*1.15 };
  }
  function drawSunburst(){
    if(!sun) return; var lw = 1/tf.k, focus = hoverNode || selected;
    for(var i=0;i<sun.arcs.length;i++){ var s = sun.arcs[i], n = s.node, active = !focus || (focus && n.id === focus.id);
      ctx.globalAlpha = (active ? 1 : PAL.dim) * (s.child ? 0.82 : 1);
      ctx.beginPath(); ctx.arc(0, 0, s.r1, s.a0, s.a1, false); ctx.arc(0, 0, s.r0, s.a1, s.a0, true); ctx.closePath();
      ctx.fillStyle = color(n); ctx.fill(); ctx.globalAlpha = 1; ctx.lineWidth = 1*lw; ctx.strokeStyle = PAL.bg; ctx.stroke();
      if(focus && n.id === focus.id){ ctx.lineWidth = 2*lw; ctx.strokeStyle = PAL.ring; ctx.stroke(); }
      if((s.a1 - s.a0) > 0.12){ var mid = (s.a0+s.a1)/2, rr = (s.r0+s.r1)/2, right = Math.cos(mid) >= 0;
        ctx.save(); ctx.translate(Math.cos(mid)*rr, Math.sin(mid)*rr); ctx.rotate(mid + (right?0:Math.PI));
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = (10/tf.k) + 'px ui-sans-serif, system-ui, sans-serif';
        ctx.fillStyle = '#ffffff'; ctx.globalAlpha = active ? 1 : PAL.dim;
        if(ctx.measureText(n.label).width < (s.r1 - s.r0) - 8*lw) ctx.fillText(n.label, 0, 0); ctx.restore(); ctx.globalAlpha = 1; } }
    ctx.globalAlpha = 1;
  }
  function hitSunburst(wx, wy){
    if(!sun) return null; var r = Math.sqrt(wx*wx + wy*wy), a = Math.atan2(wy, wx);
    for(var i=0;i<sun.arcs.length;i++){ var s = sun.arcs[i]; if(r < s.r0 || r > s.r1) continue;
      var aa = a; while(aa < s.a0) aa += PI2; while(aa >= s.a0 + PI2) aa -= PI2; if(aa >= s.a0 && aa <= s.a1) return s.node; }
    return null;
  }

  // --- sankey: files laid out in dependency layers, imports as flowing ribbons ---
  var sankey = null;
  function buildSankey(){
    var level = {}, i, s, t; nodes.forEach(function(n){ level[n.id] = 0; });
    var cap = nodes.length, changed = true, iter = 0;
    while(changed && iter++ < cap){ changed = false; for(i=0;i<links.length;i++){ s = links[i].source; t = links[i].target; if(level[s]==null||level[t]==null) continue; if(level[t] < level[s]+1){ level[t] = Math.min(level[s]+1, cap); changed = true; } } }
    var maxL = 0; nodes.forEach(function(n){ if(level[n.id] > maxL) maxL = level[n.id]; });
    var cols = []; for(i=0;i<=maxL;i++) cols.push([]); nodes.forEach(function(n){ cols[level[n.id]].push(n); });
    var colGap = 230, barW = 16, vGap = 14, H = 620, thr = {}; nodes.forEach(function(n){ thr[n.id] = sizeOf(n); });
    var sc = 1; cols.forEach(function(col){ var raw = sumBy(col, function(n){ return thr[n.id]; }), avail = H - Math.max(0, col.length-1)*vGap; if(raw*sc > avail) sc = avail / Math.max(1, raw); });
    var pos = {}; cols.forEach(function(col, li){ var x = li*colGap - (maxL*colGap)/2, totH = sumBy(col, function(n){ return thr[n.id]*sc; }) + Math.max(0, col.length-1)*vGap, y = -totH/2;
      col.forEach(function(n){ var hh = Math.max(4, thr[n.id]*sc); pos[n.id] = { x:x, y:y, w:barW, h:hh, inY:y, outY:y }; y += hh + vGap; }); });
    var ribbons = []; for(i=0;i<links.length;i++){ var a = pos[links[i].source], b = pos[links[i].target]; if(!a||!b) continue;
      var th = Math.max(1.5, Math.min(a.h, b.h) * 0.4), sy = a.outY + th/2, ty = b.inY + th/2; a.outY += th; b.inY += th;
      ribbons.push({ x1:a.x + barW, y1:sy, x2:b.x, y2:ty, t:th, s:links[i].source, tg:links[i].target }); }
    sankey = { pos:pos, ribbons:ribbons, order:nodes.slice() };
    var span = (maxL*colGap)/2 + colGap;
    bbox = { minx:-span, miny:-H/2 - 30, maxx:span, maxy:H/2 + 30 };
  }
  function drawSankey(){
    if(!sankey) return; var lw = 1/tf.k, focus = hoverNode || selected, i;
    for(i=0;i<sankey.ribbons.length;i++){ var rb = sankey.ribbons[i], touch = focus && (rb.s===focus.id || rb.tg===focus.id), mx = (rb.x1+rb.x2)/2;
      ctx.globalAlpha = focus ? (touch ? 0.7 : 0.1) : 0.35; ctx.strokeStyle = touch ? PAL.linkHot : PAL.link; ctx.lineWidth = Math.max(1*lw, rb.t);
      ctx.beginPath(); ctx.moveTo(rb.x1, rb.y1); ctx.bezierCurveTo(mx, rb.y1, mx, rb.y2, rb.x2, rb.y2); ctx.stroke(); }
    ctx.globalAlpha = 1; ctx.font = (11/tf.k) + 'px ui-sans-serif, system-ui, sans-serif'; ctx.textBaseline = 'middle';
    var nb = focus ? neigh[focus.id] : null;
    for(i=0;i<sankey.order.length;i++){ var n = sankey.order[i], p = sankey.pos[n.id]; if(!p) continue;
      var active = !focus || n===focus || (nb && nb[n.id]); ctx.globalAlpha = active ? 1 : PAL.dim; ctx.fillStyle = color(n); ctx.fillRect(p.x, p.y, p.w, p.h);
      if(n===selected){ ctx.lineWidth = 2*lw; ctx.strokeStyle = PAL.ring; ctx.strokeRect(p.x, p.y, p.w, p.h); }
      if(active){ ctx.fillStyle = PAL.label; ctx.textAlign = 'start'; ctx.fillText(n.label, p.x + p.w + 5*lw, p.y + p.h/2); } }
    ctx.globalAlpha = 1;
  }
  function hitSankey(wx, wy){
    if(!sankey) return null;
    for(var i=0;i<sankey.order.length;i++){ var n = sankey.order[i], p = sankey.pos[n.id]; if(!p) continue; if(wx>=p.x && wx<=p.x+p.w && wy>=p.y && wy<=p.y+p.h) return n; }
    return null;
  }

  var VIEWS = {
    matrix:   { build: buildMatrix,   draw: drawMatrix,   hit: hitMatrix },
    chord:    { build: buildChord,    draw: drawChord,    hit: hitChord },
    arc:      { build: buildArc,      draw: drawArc,      hit: hitArc },
    treemap:  { build: buildTreemap,  draw: drawTreemap,  hit: hitTreemap },
    sunburst: { build: buildSunburst, draw: drawSunburst, hit: hitSunburst },
    sankey:   { build: buildSankey,   draw: drawSankey,   hit: hitSankey },
    bundling: { build: buildBundling, draw: drawBundling, hit: hitBundling }
  };

  // ---- interaction ----
  var down=false, moved=false, startN=null, panning=false, last={x:0,y:0};
  function pos(e){ var rc=canvas.getBoundingClientRect(); return { x:e.clientX-rc.left, y:e.clientY-rc.top }; }

  canvas.addEventListener('mousedown', function(e){
    var p=pos(e); startN=nodeAt(p.x,p.y); down=true; moved=false; last=p;
    // dragging a node only makes sense in node-link; elsewhere a press pans (a click still selects)
    if(startN && gtype==='node-link'){ dragging=startN; startN.fixed=true; canvas.style.cursor='grabbing'; }
    else { panning=true; canvas.style.cursor='grabbing'; }
  });
  window.addEventListener('mousemove', function(e){
    var p=pos(e);
    if(down && dragging){
      var w=toWorld(tf, p.x, p.y); dragging.x=w.x; dragging.y=w.y; dragging.vx=0; dragging.vy=0;
      moved=true; ensureRunning(); return;
    }
    if(down && panning){
      tf.x += p.x-last.x; tf.y += p.y-last.y; target.x=tf.x; target.y=tf.y; last=p;
      moved=true; ensureRunning(); return;
    }
    // hover
    var h=nodeAt(p.x,p.y);
    canvas.style.cursor = h ? 'pointer' : 'grab';
    if(h!==hoverNode){ hoverNode=h; ensureRunning(); }
  });
  window.addEventListener('mouseup', function(){
    if(down && startN && !moved){ select(startN); startN.fixed=false; }
    else if(down && !startN && !moved){ select(null); }  // click on empty space clears selection
    if(down && dragging) reheat(0.25);
    down=false; dragging=null; panning=false;
    canvas.style.cursor = hoverNode ? 'pointer' : 'grab';
  });
  window.addEventListener('keydown', function(e){ if(e.key==='Escape' && selected){ select(null); } });
  canvas.addEventListener('mouseleave', function(){ if(hoverNode){ hoverNode=null; ensureRunning(); } });
  canvas.addEventListener('dblclick', function(e){
    var p=pos(e), n=nodeAt(p.x,p.y);
    if(n && n.folder){ drillTo(n.prefix); }
    else if(n && n.external){ revealFile(n.id); }
    else if(n){ n.fixed=false; reheat(0.6); }
    else { fitView(true); }
  });
  canvas.addEventListener('wheel', function(e){
    e.preventDefault();
    var p=pos(e);
    var w=toWorld(target, p.x, p.y);
    var factor=Math.pow(1.0016, -e.deltaY);
    var nk=clamp(target.k*factor, 0.04, 4.5);
    target.k=nk; target.x=p.x - w.x*nk; target.y=p.y - w.y*nk;
    ensureRunning();
  }, { passive:false });

  function zoomBy(f){
    var cx=view.w/2, cy=view.h/2, w=toWorld(target, cx, cy);
    var nk=clamp(target.k*f, 0.04, 4.5);
    target.k=nk; target.x=cx - w.x*nk; target.y=cy - w.y*nk; ensureRunning();
  }
  document.getElementById('zin').addEventListener('click', function(){ zoomBy(1.3); });
  document.getElementById('zout').addEventListener('click', function(){ zoomBy(1/1.3); });
  document.getElementById('zfit').addEventListener('click', function(){ fitView(true); });

  function fitView(animate){
    var minx, miny, maxx, maxy;
    if(bbox){
      // a non-node-link view supplied its own world-space bounds
      minx=bbox.minx; miny=bbox.miny; maxx=bbox.maxx; maxy=bbox.maxy;
    } else {
      if(!nodes.length) return;
      minx=1e9; miny=1e9; maxx=-1e9; maxy=-1e9;
      nodes.forEach(function(n){ var r=radius(n)+18;
        if(n.x-r<minx)minx=n.x-r; if(n.y-r<miny)miny=n.y-r; if(n.x+r>maxx)maxx=n.x+r; if(n.y+r>maxy)maxy=n.y+r; });
    }
    var bw=Math.max(1,maxx-minx), bh=Math.max(1,maxy-miny), pad=48;
    var k=clamp(Math.min((view.w-pad)/bw, (view.h-pad)/bh), 0.04, 2.2);
    var cx=(minx+maxx)/2, cy=(miny+maxy)/2;
    target.k=k; target.x=view.w/2 - cx*k; target.y=view.h/2 - cy*k;
    if(!animate){ tf.k=target.k; tf.x=target.x; tf.y=target.y; }
    ensureRunning();
  }

  function select(n){ selected=n; renderPanel(); ensureRunning(); }

  // ---- sidebar ----
  function renderSidebar(){
    setText('proj', data.project);
    setText('s-files', data.stats.files);
    setText('s-symbols', data.stats.symbols);
    setText('s-exported', data.stats.exported);
    setText('s-dead', data.stats.dead);
    var status=document.getElementById('status');
    status.className = 'status ' + (data.connected ? 'ok' : 'off');
    status.title = data.connected ? t('connected') : t('notConnected');
    renderDead(); renderPanel();
  }

  function renderDead(){
    var host=document.getElementById('dead'); host.innerHTML='';
    if(!data.dead.length){ host.appendChild(el('div','muted',t('deadEmpty'))); return; }
    data.dead.forEach(function(d){
      var row=el('div','row');
      row.appendChild(el('span','mono', d.name));
      row.appendChild(el('span','loc', base(d.file)+':'+d.line));
      row.addEventListener('click', function(){ revealFile(d.file); });
      host.appendChild(row);
    });
  }

  function renderPanel(){
    var host=document.getElementById('panel'); host.innerHTML='';
    if(!selected){ host.appendChild(el('div','muted',t('panelEmpty'))); return; }
    host.appendChild(el('div','ptitle mono', selected.id));
    if(selected.folder){
      host.appendChild(el('div','muted', tp('folderMeta', { files: selected.files, symbols: selected.symbols })));
      var pfx = selected.prefix;
      childrenOf(pfx).forEach(function(kd){
        var row=el('div','row');
        row.appendChild(el('span','mono', kd.folder ? kd.label + '/' : kd.label));
        row.appendChild(el('span','loc', kd.folder ? tp('unitFiles', { n: kd.files }) : tp('unitSym', { n: kd.symbols })));
        row.addEventListener('click', function(){
          if(kd.folder){ drillTo(kd.id); }
          else { drillTo(pfx); var n=byId[kd.id]; if(n){ select(n); focusNode(n); } }
        });
        host.appendChild(row);
      });
      return;
    }
    data.symbols.filter(function(s){ return s.file===selected.id; })
      .sort(function(a,b){ return a.line-b.line; })
      .forEach(function(s){
        var row=el('div','sig mono', s.signature);
        if(s.exported) row.appendChild(el('span','tag',t('tagExport')));
        host.appendChild(row);
      });
  }

  function focusNode(n){
    var cx=view.w/2, cy=view.h/2, k=Math.max(target.k, 1.1);
    target.k=k; target.x=cx - n.x*k; target.y=cy - n.y*k; ensureRunning();
  }

  document.getElementById('search').addEventListener('input', function(e){
    var q=e.target.value.toLowerCase().trim(), host=document.getElementById('results'); host.innerHTML='';
    if(!q) return;
    data.symbols.filter(function(s){ return s.name.toLowerCase().indexOf(q)>=0; }).slice(0,20).forEach(function(s){
      var row=el('div','row');
      row.appendChild(el('span','mono', s.name));
      row.appendChild(el('span','loc', base(s.file)+':'+s.line));
      row.addEventListener('click', function(){ revealFile(s.file); });
      host.appendChild(row);
    });
  });

  function setFreshBadge(fresh){
    lastFresh = fresh;
    var badge = document.getElementById('freshBadge');
    badge.className = 'status ' + (fresh ? 'ok' : 'stale');
    badge.title = fresh ? t('freshOk') : t('freshStale');
  }
  function checkFreshness(){
    api('/api/freshness').then(function(d){ setFreshBadge(d.fresh); });
  }

  document.getElementById('btnReindex').addEventListener('click', function(){
    var b=document.getElementById('btnReindex');
    b.classList.add('loading'); b.title=t('reindexing'); b.setAttribute('aria-label',t('reindexing'));
    api('/api/reindex','POST').then(function(d){ data=d; setRaw(); selected=null; hoverNode=null; initGraph(); renderSidebar(); reheat(0.8); b.classList.remove('loading'); b.title=t('reindex'); b.setAttribute('aria-label',t('reindex'));
      setFreshBadge(true);
    });
  });
  function showToast(msg){
    var t=document.getElementById('toast');
    if(msg) t.querySelector('.msg').textContent = msg;
    t.classList.add('show');
    clearTimeout(t._t); t._t = setTimeout(function(){ t.classList.remove('show'); }, 2600);
  }
  document.getElementById('btnConnect').addEventListener('click', function(){
    api('/api/connect','POST').then(function(){ return api('/api/data'); }).then(function(d){ data=d; renderSidebar(); if(d.connected) showToast(t('connected')); });
  });

  // theme toggle: cycle stored preference between light and dark; changing it repaints
  // both the CSS chrome (via [data-theme]) and the canvas palette.
  document.getElementById('btnTheme').addEventListener('click', function(){
    var root = document.documentElement;
    root.classList.add('theming');                       // enable the soft cross-fade…
    clearTimeout(themingT);
    themingT = setTimeout(function(){ root.classList.remove('theming'); }, 340);  // …just for the switch
    var next = resolvedDark() ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, next); } catch(e){}
    applyTheme(true);
  });

  // menu buttons: each toggles its own popover (opening one closes the others)
  document.getElementById('btnLang').addEventListener('click', function(e){ e.stopPropagation(); spinGlobe(); openMenu('langMenu','btnLang'); });
  document.getElementById('btnCanvasMenu').addEventListener('click', function(e){ e.stopPropagation(); openMenu('canvasMenu','btnCanvasMenu'); });
  document.addEventListener('click', function(e){
    MENUS.forEach(function(x){ var w = document.getElementById(x[1]).parentNode; if(!w.contains(e.target)) setMenuOpen(x[0], x[1], false); });
  });
  window.addEventListener('keydown', function(e){ if(e.key === 'Escape') closeMenus(); });
  // follow the OS while the user hasn't picked a theme of their own
  if(mq){
    var onSys = function(){ if(!storedTheme()) applyTheme(); };
    if(mq.addEventListener) mq.addEventListener('change', onSys);
    else if(mq.addListener) mq.addListener(onSys);
  }
  applyLang();

  // brief hint on first load
  var hint=document.getElementById('hint');
  hint.classList.add('show');
  setTimeout(function(){ hint.classList.remove('show'); }, 4200);

  window.addEventListener('resize', resize);
  resize();
  canvas.style.cursor='grab';
  api('/api/data').then(function(d){ data=d; setRaw(); initGraph(); renderSidebar(); ensureRunning(); checkFreshness(); });
  setInterval(checkFreshness, 5000);
  window.addEventListener('focus', checkFreshness);
})();
</script>
</body>
</html>`;
}
