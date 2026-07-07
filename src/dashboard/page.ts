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
  :root { color-scheme: light dark; }
  body { margin: 0; font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #1a1c22; background: #f6f7f9; }
  .app { display: flex; flex-direction: column; height: 100vh; }
  .topbar { display: flex; align-items: center; justify-content: space-between; padding: 12px 18px; border-bottom: 1px solid #e6e8ec; background: #fff; }
  .brand { font-size: 17px; font-weight: 600; letter-spacing: -0.01em; }
  .brand .dot { color: #4f7cff; }
  .muted { color: #8a92a0; font-weight: 400; }
  .actions { display: flex; align-items: center; gap: 10px; }
  button { font: inherit; border: 1px solid #d3d7de; background: #fff; color: #1a1c22; padding: 7px 13px; border-radius: 8px; cursor: pointer; }
  button:hover { background: #f1f3f6; }
  .badge { font-size: 12px; padding: 4px 10px; border-radius: 20px; }
  .badge.ok { background: #dff5e8; color: #1a7f47; }
  .badge.off { background: #eef0f3; color: #8a92a0; }
  .body { display: flex; flex: 1; min-height: 0; }
  .graphwrap { flex: 1; position: relative; overflow: hidden; }
  canvas { display: block; }
  .legend { position: absolute; left: 14px; bottom: 12px; display: flex; gap: 14px; font-size: 12px; color: #6b7280; background: rgba(255,255,255,.7); padding: 6px 10px; border-radius: 8px; }
  .legend .d { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 5px; vertical-align: 0; }
  .d.blue { background: #4f7cff; } .d.gray { background: #aab2bf; } .d.dead { background: #e0533d; }
  .side { width: 340px; border-left: 1px solid #e6e8ec; background: #fff; overflow: auto; padding: 16px; }
  .cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
  .card { background: #f6f7f9; border-radius: 10px; padding: 12px; }
  .card .n { font-size: 22px; font-weight: 600; }
  .card .l { font-size: 12px; color: #8a92a0; }
  input { width: 100%; margin: 16px 0 6px; padding: 9px 11px; border: 1px solid #d3d7de; border-radius: 8px; font: inherit; }
  h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: #8a92a0; margin: 20px 0 8px; }
  .row { display: flex; justify-content: space-between; gap: 8px; padding: 7px 8px; border-radius: 7px; cursor: pointer; }
  .row:hover { background: #f1f3f6; }
  .loc { color: #8a92a0; font-size: 12px; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12.5px; }
  .ptitle { color: #4f7cff; margin-bottom: 8px; word-break: break-all; }
  .sig { padding: 4px 0; border-bottom: 1px solid #f0f2f5; }
  .tag { background: #eef1f6; color: #5b6472; border-radius: 5px; padding: 1px 6px; font-size: 11px; margin-left: 6px; }
  @media (prefers-color-scheme: dark) {
    body { color: #e6e8ec; background: #0f1116; }
    .topbar, .side { background: #171a21; border-color: #262b34; }
    button { background: #1c2029; color: #e6e8ec; border-color: #2c3340; } button:hover { background: #232833; }
    .card { background: #1c2029; } .badge.off { background: #232833; color: #8a92a0; } .badge.ok { background: #113524; color: #4bd48a; }
    .legend { background: rgba(23,26,33,.75); color: #9aa3b0; } .row:hover { background: #232833; } .sig { border-color: #21252e; } .tag { background: #232833; }
  }
</style>
</head>
<body>
<div class="app">
  <header class="topbar">
    <div class="brand">Sens<span class="dot">.</span> <span id="proj" class="muted"></span></div>
    <div class="actions">
      <span id="badge" class="badge off">…</span>
      <button id="btnConnect">Connect to Claude Code</button>
      <button id="btnReindex">Rebuild index</button>
    </div>
  </header>
  <div class="body">
    <div class="graphwrap">
      <canvas id="graph"></canvas>
      <div class="legend">
        <span><i class="d blue"></i>exports</span>
        <span><i class="d gray"></i>internal</span>
        <span><i class="d dead"></i>has dead code</span>
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
  var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  var PAL = dark
    ? { link:'rgba(150,160,175,0.16)', label:'#c7ccd4', gray:'#5b6472', blue:'#5f86ff', dead:'#ef6b52', ring:'#e9edf3' }
    : { link:'rgba(120,130,145,0.30)', label:'#3a3f47', gray:'#aab2bf', blue:'#4f7cff', dead:'#e0533d', ring:'#1a1c22' };

  var canvas = document.getElementById('graph');
  var ctx = canvas.getContext('2d');
  var data = null, nodes = [], links = [], byId = {}, selected = null, dragging = null, raf = 0;
  var view = { w: 0, h: 0 };

  function api(path, method){ return fetch(path, { method: method || 'GET' }).then(function(r){ return r.json(); }); }
  function el(tag, cls, text){ var e = document.createElement(tag); if(cls) e.className = cls; if(text != null) e.textContent = text; return e; }
  function setText(id, v){ document.getElementById(id).textContent = v; }
  function base(p){ return p.split('/').pop(); }

  function resize(){
    var wrap = canvas.parentNode, dpr = window.devicePixelRatio || 1;
    view.w = wrap.clientWidth; view.h = wrap.clientHeight;
    canvas.width = view.w * dpr; canvas.height = view.h * dpr;
    canvas.style.width = view.w + 'px'; canvas.style.height = view.h + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function initGraph(){
    var g = data.graph;
    nodes = g.nodes.map(function(n, i){
      var a = (i / Math.max(1, g.nodes.length)) * Math.PI * 2;
      return { id:n.id, label:n.label, symbols:n.symbols, exported:n.exported, dead:n.dead,
               x: view.w/2 + Math.cos(a) * Math.min(view.w, view.h) * 0.32,
               y: view.h/2 + Math.sin(a) * Math.min(view.w, view.h) * 0.32, vx:0, vy:0 };
    });
    byId = {}; nodes.forEach(function(n){ byId[n.id] = n; });
    links = g.links;
  }

  function radius(n){ return 5 + Math.min(15, n.symbols * 0.8); }
  function color(n){ return n.dead > 0 ? PAL.dead : (n.exported > 0 ? PAL.blue : PAL.gray); }

  function tick(){
    var N = nodes, i, j;
    var REP = 1700, SPRING = 0.02, LINK = 72, GRAV = 0.015, DAMP = 0.82;
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
      n.vx+=(view.w/2-n.x)*GRAV; n.vy+=(view.h/2-n.y)*GRAV;
      n.vx*=DAMP; n.vy*=DAMP;
      if(n!==dragging){ n.x+=n.vx; n.y+=n.vy; }
    }
    draw();
    raf = requestAnimationFrame(tick);
  }

  function draw(){
    ctx.clearRect(0,0,view.w,view.h);
    for(var i=0;i<links.length;i++){
      var a=byId[links[i].source], b=byId[links[i].target]; if(!a||!b) continue;
      var hot = selected && (links[i].source===selected.id || links[i].target===selected.id);
      ctx.strokeStyle = hot ? PAL.blue : PAL.link;
      ctx.lineWidth = hot ? 1.6 : 1;
      ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
    }
    ctx.textAlign='center'; ctx.font='11px ui-sans-serif, system-ui, sans-serif';
    for(var k=0;k<nodes.length;k++){
      var n=nodes[k], r=radius(n);
      ctx.beginPath(); ctx.arc(n.x,n.y,r,0,Math.PI*2); ctx.fillStyle=color(n); ctx.fill();
      if(selected===n){ ctx.lineWidth=2.2; ctx.strokeStyle=PAL.ring; ctx.stroke(); }
      ctx.fillStyle=PAL.label; ctx.fillText(n.label, n.x, n.y - r - 5);
    }
  }

  function nodeAt(mx,my){
    for(var i=nodes.length-1;i>=0;i--){
      var n=nodes[i], r=radius(n)+4, dx=mx-n.x, dy=my-n.y;
      if(dx*dx+dy*dy<=r*r) return n;
    }
    return null;
  }

  var down=false, moved=false, startN=null;
  function pos(e){ var rc=canvas.getBoundingClientRect(); return { x:e.clientX-rc.left, y:e.clientY-rc.top }; }
  canvas.addEventListener('mousedown', function(e){ var p=pos(e); startN=nodeAt(p.x,p.y); dragging=startN; down=true; moved=false; });
  canvas.addEventListener('mousemove', function(e){ if(!down||!dragging) return; var p=pos(e); dragging.x=p.x; dragging.y=p.y; dragging.vx=0; dragging.vy=0; moved=true; });
  window.addEventListener('mouseup', function(){ if(down && startN && !moved){ select(startN); } down=false; dragging=null; });

  function select(n){ selected=n; renderPanel(); }

  function renderSidebar(){
    setText('proj', data.project);
    setText('s-files', data.stats.files);
    setText('s-symbols', data.stats.symbols);
    setText('s-exported', data.stats.exported);
    setText('s-dead', data.stats.dead);
    var badge=document.getElementById('badge');
    badge.textContent = data.connected ? 'Connected to Claude Code' : 'Not connected';
    badge.className = 'badge ' + (data.connected ? 'ok' : 'off');
    renderDead(); renderPanel();
  }

  function renderDead(){
    var host=document.getElementById('dead'); host.innerHTML='';
    if(!data.dead.length){ host.appendChild(el('div','muted','No dead-code candidates found.')); return; }
    data.dead.forEach(function(d){
      var row=el('div','row');
      row.appendChild(el('span','mono', d.name));
      row.appendChild(el('span','loc', base(d.file)+':'+d.line));
      row.addEventListener('click', function(){ var n=byId[d.file]; if(n) select(n); });
      host.appendChild(row);
    });
  }

  function renderPanel(){
    var host=document.getElementById('panel'); host.innerHTML='';
    if(!selected){ host.appendChild(el('div','muted','Click a node to see its symbols.')); return; }
    host.appendChild(el('div','ptitle mono', selected.id));
    data.symbols.filter(function(s){ return s.file===selected.id; })
      .sort(function(a,b){ return a.line-b.line; })
      .forEach(function(s){
        var row=el('div','sig mono', s.signature);
        if(s.exported) row.appendChild(el('span','tag','export'));
        host.appendChild(row);
      });
  }

  document.getElementById('search').addEventListener('input', function(e){
    var q=e.target.value.toLowerCase().trim(), host=document.getElementById('results'); host.innerHTML='';
    if(!q) return;
    data.symbols.filter(function(s){ return s.name.toLowerCase().indexOf(q)>=0; }).slice(0,20).forEach(function(s){
      var row=el('div','row');
      row.appendChild(el('span','mono', s.name));
      row.appendChild(el('span','loc', base(s.file)+':'+s.line));
      row.addEventListener('click', function(){ var n=byId[s.file]; if(n) select(n); });
      host.appendChild(row);
    });
  });

  document.getElementById('btnReindex').addEventListener('click', function(){
    var b=document.getElementById('btnReindex'); b.textContent='Reindexing…';
    api('/api/reindex','POST').then(function(d){ data=d; initGraph(); renderSidebar(); b.textContent='Rebuild index'; });
  });
  document.getElementById('btnConnect').addEventListener('click', function(){
    api('/api/connect','POST').then(function(){ return api('/api/data'); }).then(function(d){ data=d; renderSidebar(); });
  });

  window.addEventListener('resize', resize);
  resize();
  api('/api/data').then(function(d){ data=d; initGraph(); renderSidebar(); if(raf) cancelAnimationFrame(raf); tick(); });
})();
</script>
</body>
</html>`;
}
