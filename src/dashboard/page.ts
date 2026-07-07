// The dashboard is a single self-contained page served by the local server.
// The client JS uses plain string concatenation (no template literals) so this
// whole document can live inside one TS template literal safely.

export function renderDashboardPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sens dashboard</title>
<style>
  * { box-sizing: border-box; }
  :root { color-scheme: light dark; --accent: #4f7cff; --accent-hover: #3d6bf0; }
  body { margin: 0; font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #1a1c22; background: #f6f7f9; }
  .app { display: flex; flex-direction: column; height: 100vh; }
  .topbar { display: flex; align-items: center; justify-content: space-between; padding: 11px 18px; border-bottom: 1px solid #e9ebef; background: rgba(255,255,255,.88); backdrop-filter: saturate(1.4) blur(10px); }
  .brand { display: flex; align-items: center; gap: 11px; font-size: 17px; font-weight: 600; letter-spacing: -0.02em; }
  .brand .mark { width: 33px; height: 33px; border-radius: 9px; display: grid; place-items: center; color: #fff; font-size: 17px; font-weight: 700; background: linear-gradient(140deg, #6f9bff, #4f7cff); box-shadow: 0 3px 8px rgba(79,124,255,.38), inset 0 1px 0 rgba(255,255,255,.35); }
  .brand .dot { color: var(--accent); }
  .muted { color: #8a92a0; font-weight: 400; }
  .actions { display: flex; align-items: center; gap: 8px; }
  button { font: inherit; border: 1px solid #d3d7de; background: #fff; color: #1a1c22; padding: 7px 13px; border-radius: 8px; cursor: pointer; }
  button:hover { background: #f1f3f6; }

  .btn { font: inherit; font-size: 13px; font-weight: 500; display: inline-flex; align-items: center; gap: 7px; padding: 8px 13px; border-radius: 9px; border: 1px solid transparent; cursor: pointer; white-space: nowrap; transition: background .15s ease, border-color .15s ease, box-shadow .15s ease, transform .08s ease; }
  .btn svg { width: 15px; height: 15px; flex: none; }
  .btn:active { transform: translateY(.5px); }
  .btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .btn-primary { background: var(--accent); color: #fff; box-shadow: 0 1px 2px rgba(20,30,60,.20), inset 0 1px 0 rgba(255,255,255,.20); }
  .btn-primary:hover { background: var(--accent-hover); }
  .btn-ghost { background: #fff; color: #3a4250; border-color: #e2e5ea; box-shadow: 0 1px 1.5px rgba(20,30,60,.05); }
  .btn-ghost:hover { background: #f4f6f9; border-color: #d3d7de; }
  .btn.loading { pointer-events: none; opacity: .75; }
  .btn.loading svg { animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .btn-icon { width: 34px; height: 34px; padding: 0; gap: 0; justify-content: center; }
  .btn-icon svg { width: 17px; height: 17px; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }

  .status { width: 11px; height: 11px; border-radius: 50%; background: #c2c8d0; position: relative; margin-right: 4px; }
  .status.ok { background: #22c55e; box-shadow: 0 0 7px rgba(34,197,94,.7); }
  .status.ok::after { content: ''; position: absolute; inset: 0; border-radius: 50%; background: #22c55e; animation: statuspulse 2.2s ease-out infinite; }
  .status.stale { background: #ef4444; box-shadow: 0 0 7px rgba(239,68,68,.65); }
  .status.stale::after { content: ''; position: absolute; inset: 0; border-radius: 50%; background: #ef4444; animation: statuspulse 2.2s ease-out infinite; }
  @keyframes statuspulse { 0% { transform: scale(1); opacity: .55; } 100% { transform: scale(2.8); opacity: 0; } }

  .conn { position: relative; display: inline-flex; }
  .conn > .btn { -webkit-mask-image: radial-gradient(circle 9px at calc(100% - 3px) 3px, transparent 98%, #000 100%); mask-image: radial-gradient(circle 9px at calc(100% - 3px) 3px, transparent 98%, #000 100%); }
  .conn .status { position: absolute; top: -3px; right: -3px; margin: 0; z-index: 2; }

  .toast { position: fixed; top: 14px; right: 18px; z-index: 50; display: flex; align-items: center; gap: 9px; padding: 10px 15px 10px 11px; border-radius: 12px; background: #fff; color: #157042; font-size: 13px; font-weight: 600; box-shadow: 0 10px 34px rgba(20,30,60,.20), 0 0 0 1px rgba(34,163,92,.22); opacity: 0; transform: translateY(-14px) scale(.96); pointer-events: none; transition: opacity .26s ease, transform .3s cubic-bezier(.2,.9,.3,1.4); }
  .toast.show { opacity: 1; transform: translateY(0) scale(1); }
  .toast .ic { width: 21px; height: 21px; border-radius: 50%; background: #22a35c; color: #fff; display: grid; place-items: center; flex: none; }
  .toast .ic svg { width: 13px; height: 13px; }
  .body { display: flex; flex: 1; min-height: 0; }
  .graphwrap { flex: 1; position: relative; overflow: hidden; touch-action: none; background: #ffffff; }
  canvas { display: block; }
  .legend { position: absolute; left: 14px; bottom: 12px; display: flex; gap: 14px; font-size: 12px; color: #6b7280; background: rgba(255,255,255,.85); padding: 6px 10px; border-radius: 8px; border: 1px solid #e6e8ec; }
  .legend .d { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 5px; vertical-align: 0; }
  .d.blue { background: #4f7cff; } .d.gray { background: #aab2bf; } .d.dead { background: #e0533d; }
  .zoomctl { position: absolute; right: 14px; bottom: 12px; display: flex; flex-direction: column; gap: 6px; }
  .zoomctl button { width: 34px; height: 34px; padding: 0; display: flex; align-items: center; justify-content: center; font-size: 17px; line-height: 1; border-radius: 8px; }
  .hint { position: absolute; left: 50%; transform: translateX(-50%); top: 12px; font-size: 11.5px; color: #8a92a0; background: rgba(255,255,255,.85); padding: 5px 9px; border-radius: 7px; border: 1px solid #e6e8ec; pointer-events: none; opacity: 0; transition: opacity .4s; white-space: nowrap; }
  .hint.show { opacity: 1; }
  .crumbs { position: absolute; left: 14px; top: 12px; display: flex; align-items: center; gap: 1px; flex-wrap: wrap; max-width: 62%; font-size: 12px; background: rgba(255,255,255,.85); padding: 4px 6px; border-radius: 8px; border: 1px solid #e6e8ec; }
  .crumbs .cr { color: #5b6472; cursor: pointer; padding: 2px 7px; border-radius: 6px; transition: background .12s ease, color .12s ease; }
  .crumbs .cr:hover { background: #eef1f6; color: #1a1c22; }
  .crumbs .cr.cur { color: #1a1c22; font-weight: 600; cursor: default; }
  .crumbs .cr.cur:hover { background: transparent; }
  .crumbs .sep { color: #c2c8d0; }
  .d.sq { border-radius: 3px; }
  .side { width: 400px; flex: none; border-left: 1px solid #e6e8ec; background: #fff; overflow-y: auto; overflow-x: hidden; padding: 16px; scrollbar-width: thin; scrollbar-color: #d3d7de transparent; }
  .side::-webkit-scrollbar { width: 9px; }
  .side::-webkit-scrollbar-track { background: transparent; }
  .side::-webkit-scrollbar-thumb { background-color: #d3d7de; border-radius: 8px; border: 2.5px solid #fff; }
  .side::-webkit-scrollbar-thumb:hover { background-color: #b9bfc9; }
  .cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
  .card { background: #f6f7f9; border-radius: 10px; padding: 12px; }
  .card .n { font-size: 22px; font-weight: 600; }
  .card .l { font-size: 12px; color: #8a92a0; }
  input { width: 100%; margin: 16px 0 6px; padding: 9px 11px; border: 1px solid #d3d7de; border-radius: 8px; font: inherit; box-sizing: border-box; }
  h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: #8a92a0; margin: 20px 0 8px; }
  .row { display: flex; justify-content: space-between; gap: 8px; padding: 7px 8px; border-radius: 7px; cursor: pointer; min-width: 0; }
  .row:hover { background: #f1f3f6; }
  .row .mono { min-width: 0; overflow-wrap: anywhere; }
  .loc { color: #8a92a0; font-size: 12px; flex: none; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; overflow-wrap: anywhere; }
  .ptitle { color: #4f7cff; margin-bottom: 8px; word-break: break-all; }
  .sig { padding: 4px 0; border-bottom: 1px solid #f0f2f5; overflow-wrap: anywhere; }
  .tag { background: #eef1f6; color: #5b6472; border-radius: 5px; padding: 1px 6px; font-size: 11px; margin-left: 6px; }
  @media (prefers-color-scheme: dark) {
    body { color: #e6e8ec; background: #0f1116; }
    .topbar { background: rgba(23,26,33,.82); border-color: #262b34; }
    .side { background: #171a21; border-color: #262b34; scrollbar-color: #2c3340 transparent; }
    .side::-webkit-scrollbar-thumb { background-color: #2c3340; border-color: #171a21; }
    .side::-webkit-scrollbar-thumb:hover { background-color: #3a4250; }
    button { background: #1c2029; color: #e6e8ec; border-color: #2c3340; } button:hover { background: #232833; }
    .btn-ghost { background: #1c2029; color: #cdd3dc; border-color: #2c3340; box-shadow: none; }
    .btn-ghost:hover { background: #232833; border-color: #3a4250; }
    .card { background: #1c2029; }
    .status { background: #3a4250; }
    .status.ok { background: #34d47f; box-shadow: 0 0 8px rgba(52,212,127,.7); }
    .status.ok::after { background: #34d47f; }
    .status.stale { background: #f87171; box-shadow: 0 0 8px rgba(248,113,113,.7); }
    .status.stale::after { background: #f87171; }
    .toast { background: #1c2029; color: #4bd48a; box-shadow: 0 10px 34px rgba(0,0,0,.5), 0 0 0 1px rgba(75,212,138,.28); }
    .toast .ic { background: #2ea866; }
    .row:hover { background: #232833; } .sig { border-color: #21252e; } .tag { background: #232833; }
    .graphwrap { background: #0f1116; }
    .legend { background: rgba(23,26,33,.85); color: #9aa3b0; border-color: #262b34; }
    .hint { background: rgba(23,26,33,.85); color: #9aa3b0; border-color: #262b34; }
    .crumbs { background: rgba(23,26,33,.85); border-color: #262b34; }
    .crumbs .cr { color: #9aa3b0; } .crumbs .cr:hover { background: #232833; color: #e6e8ec; }
    .crumbs .cr.cur { color: #e6e8ec; } .crumbs .sep { color: #3a4250; }
  }
</style>
</head>
<body>
<div class="app">
  <header class="topbar">
    <div class="brand">
      <span class="mark">S</span>
      <span>Sens<span class="dot">.</span> <span id="proj" class="muted"></span></span>
    </div>
    <div class="actions">
      <div class="conn">
        <button id="btnConnect" class="btn btn-primary btn-icon" title="Connect to Claude Code" aria-label="Connect to Claude Code">
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z"/></svg>
        </button>
        <span id="status" class="status off" title="Not connected"></span>
      </div>
      <div class="conn">
        <button id="btnReindex" class="btn btn-ghost btn-icon" title="Rebuild index" aria-label="Rebuild index">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>
        </button>
        <span id="freshBadge" class="status" title="Checking index freshness\u2026"></span>
      </div>
    </div>
  </header>
  <div id="toast" class="toast">
    <span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>
    <span class="msg">Connected to Claude Code</span>
  </div>
  <div class="body">
    <div class="graphwrap">
      <canvas id="graph"></canvas>
      <div id="crumbs" class="crumbs"></div>
      <div id="hint" class="hint">Double-click a folder to open it · breadcrumb to go back · scroll to zoom · click a node for details</div>
      <div class="legend">
        <span><i class="d sq gray"></i>folder</span>
        <span><i class="d gray"></i>file</span>
        <span><i class="d blue"></i>exports</span>
        <span><i class="d dead"></i>dead code</span>
      </div>
      <div class="zoomctl">
        <button id="zin" title="Zoom in">+</button>
        <button id="zout" title="Zoom out">−</button>
        <button id="zfit" title="Fit to view">⤢</button>
      </div>
    </div>
    <aside class="side">
      <div class="cards">
        <div class="card"><div class="n" id="s-files">0</div><div class="l">files</div></div>
        <div class="card"><div class="n" id="s-symbols">0</div><div class="l">symbols</div></div>
        <div class="card"><div class="n" id="s-exported">0</div><div class="l">exported</div></div>
        <div class="card"><div class="n" id="s-dead">0</div><div class="l">dead-code</div></div>
      </div>
      <input id="search" placeholder="Search symbols…" autocomplete="off">
      <div id="results"></div>
      <h3>Selected file</h3>
      <div id="panel"></div>
      <h3>Dead-code candidates</h3>
      <div id="dead"></div>
    </aside>
  </div>
</div>
<script>
(function(){
  // Clean, professional palette that follows the system light/dark theme.
  var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  var PAL = dark
    ? { bg:'#0f1116', link:'rgba(180,190,208,0.16)', linkHot:'#6f9bff', label:'#aeb6c2', blue:'#6f9bff', gray:'#69707d', dead:'#e0705d', ring:'#e9edf3', dim:0.26 }
    : { bg:'#ffffff', link:'rgba(40,50,70,0.14)', linkHot:'#4f7cff', label:'#5b6472', blue:'#4f7cff', gray:'#aab2bf', dead:'#e0533d', ring:'#1a1c22', dim:0.28 };

  var canvas = document.getElementById('graph');
  var ctx = canvas.getContext('2d');
  var dpr = window.devicePixelRatio || 1;
  var data = null, nodes = [], links = [], byId = {}, neigh = {};
  var rawNodes = [], rawLinks = [], curPath = '';  // hierarchical folder navigation state
  var selected = null, hoverNode = null, dragging = null, raf = 0;
  var alpha = 0;
  var view = { w: 0, h: 0 };
  // screen = world * k + (x,y)
  var tf = { k: 1, x: 0, y: 0 };
  var target = { k: 1, x: 0, y: 0 };

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
  function buildLevel(){
    var order = levelGroups(curPath), have = {};
    order.forEach(function(g){ have[g.id] = true; });
    var lmap = {}, agg = [];
    for(var j=0;j<rawLinks.length;j++){
      var s = groupIdOf(rawLinks[j].source, curPath), t = groupIdOf(rawLinks[j].target, curPath);
      if(!s || !t || s === t || !have[s] || !have[t]) continue;
      var key = s + '\\u0000' + t, L = lmap[key];
      if(L){ L.weight++; continue; }
      L = { source:s, target:t, weight:1 }; lmap[key] = L; agg.push(L);
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
    var root = el('span', 'cr' + (segs.length ? '' : ' cur'), (data && data.project) || 'root');
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
    nodes = lvl.order.map(function(g, i){
      var a = (i / Math.max(1, lvl.order.length)) * Math.PI * 2;
      var R = 40 + lvl.order.length * 6;
      return { id:g.id, label:g.label, folder:g.folder, prefix:g.prefix,
               symbols:g.symbols, exported:g.exported, dead:g.dead, files:g.files,
               x: Math.cos(a) * R, y: Math.sin(a) * R, vx:0, vy:0, fixed:false, deg:0 };
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
    // Pre-settle with a cooling schedule so the layout converges to a compact, stable
    // frame even for large graphs — a constant high alpha diverges/oscillates at scale.
    alpha = 1;
    for(var s = 0; s < 300; s++){ physics(); alpha *= 0.985; }
    alpha = 0.06;
    fitView(false);
  }

  function radius(n){ return n.folder ? 7 + Math.min(20, Math.sqrt(n.files) * 3.2) : 5 + Math.min(15, n.symbols * 0.8); }
  function color(n){ return n.dead > 0 ? PAL.dead : (n.exported > 0 ? PAL.blue : PAL.gray); }

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
    var hot = alpha > 0.02 || dragging;
    if(hot){ physics(); if(!dragging) alpha *= 0.985; }
    var settled = easeView();
    draw();
    if(hot || !settled){ raf = requestAnimationFrame(loop); } else { raf = 0; }
  }
  function ensureRunning(){ if(!raf) raf = requestAnimationFrame(loop); }
  function reheat(a){ alpha = Math.max(alpha, a == null ? 0.6 : a); ensureRunning(); }

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

  function draw(){
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,view.w,view.h);
    ctx.setTransform(tf.k*dpr, 0, 0, tf.k*dpr, tf.x*dpr, tf.y*dpr);

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
      ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
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
      ctx.fillStyle = color(n); ctx.fill();
      ctx.lineWidth = 1.5*lw; ctx.strokeStyle = PAL.bg; ctx.stroke();
      if(selected===n){ ctx.lineWidth = 2*lw; ctx.strokeStyle = PAL.ring; ctx.stroke(); }
      else if(n===focus){ ctx.lineWidth = 1.6*lw; ctx.strokeStyle = PAL.ring; ctx.stroke(); }
      // smart labels: folders are always named; files only when zoomed in, focused, or a hub
      if(active && (n.folder || n===focus || tf.k >= 0.9 || n.deg >= 8)){
        ctx.fillStyle = PAL.label; ctx.fillText(n.label, n.x, n.y - r - 6*lw);
      }
    }
    ctx.globalAlpha = 1;
  }

  function nodeAt(sx, sy){
    var w = toWorld(tf, sx, sy);
    for(var i=nodes.length-1;i>=0;i--){
      var n=nodes[i], r=radius(n)+4/tf.k, dx=w.x-n.x, dy=w.y-n.y;
      if(n.folder){ if(Math.abs(dx)<=r && Math.abs(dy)<=r) return n; }
      else if(dx*dx+dy*dy<=r*r) return n;
    }
    return null;
  }

  // ---- interaction ----
  var down=false, moved=false, startN=null, panning=false, last={x:0,y:0};
  function pos(e){ var rc=canvas.getBoundingClientRect(); return { x:e.clientX-rc.left, y:e.clientY-rc.top }; }

  canvas.addEventListener('mousedown', function(e){
    var p=pos(e); startN=nodeAt(p.x,p.y); down=true; moved=false; last=p;
    if(startN){ dragging=startN; startN.fixed=true; canvas.style.cursor='grabbing'; }
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
    if(!nodes.length) return;
    var minx=1e9, miny=1e9, maxx=-1e9, maxy=-1e9;
    nodes.forEach(function(n){ var r=radius(n)+18;
      if(n.x-r<minx)minx=n.x-r; if(n.y-r<miny)miny=n.y-r; if(n.x+r>maxx)maxx=n.x+r; if(n.y+r>maxy)maxy=n.y+r; });
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
    status.title = data.connected ? 'Connected to Claude Code' : 'Not connected';
    renderDead(); renderPanel();
  }

  function renderDead(){
    var host=document.getElementById('dead'); host.innerHTML='';
    if(!data.dead.length){ host.appendChild(el('div','muted','No dead-code candidates found.')); return; }
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
    if(!selected){ host.appendChild(el('div','muted','Click a node to see its contents.')); return; }
    host.appendChild(el('div','ptitle mono', selected.id));
    if(selected.folder){
      host.appendChild(el('div','muted', selected.files + ' files · ' + selected.symbols + ' symbols'));
      var pfx = selected.prefix;
      childrenOf(pfx).forEach(function(kd){
        var row=el('div','row');
        row.appendChild(el('span','mono', kd.folder ? kd.label + '/' : kd.label));
        row.appendChild(el('span','loc', kd.folder ? kd.files + ' files' : kd.symbols + ' sym'));
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
        if(s.exported) row.appendChild(el('span','tag','export'));
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
    var badge = document.getElementById('freshBadge');
    badge.className = 'status ' + (fresh ? 'ok' : 'stale');
    badge.title = fresh ? 'Index up to date' : 'Index out of date — click rebuild';
  }
  function checkFreshness(){
    api('/api/freshness').then(function(d){ setFreshBadge(d.fresh); });
  }

  document.getElementById('btnReindex').addEventListener('click', function(){
    var b=document.getElementById('btnReindex');
    b.classList.add('loading'); b.title='Reindexing…'; b.setAttribute('aria-label','Reindexing…');
    api('/api/reindex','POST').then(function(d){ data=d; setRaw(); selected=null; hoverNode=null; initGraph(); renderSidebar(); reheat(0.8); b.classList.remove('loading'); b.title='Rebuild index'; b.setAttribute('aria-label','Rebuild index');
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
    api('/api/connect','POST').then(function(){ return api('/api/data'); }).then(function(d){ data=d; renderSidebar(); if(d.connected) showToast('Connected to Claude Code'); });
  });

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
