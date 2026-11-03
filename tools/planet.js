// tools/planet.html — planet preview (docs/PLANET.md §8). ?seed=N, ?compare[=1,2,3,4,5,6], ?layer=<name>.
// Whole planet (equirectangular, wraps east-west) with switchable layers, drag to pan, wheel to zoom, hover for
// the values at a point, click to render a 256 / 512 tile window from generateChunk (hill-shaded).
const QS = new URLSearchParams(location.search);
const $ = (s) => document.querySelector(s);
const W = 16384, H = 8192;
const LAYERS = [['detail', 'Detalhe'], ['satellite', 'Satélite'], ['relief', 'Relevo'], ['biome', 'Biomas'], ['temp', 'Temperatura'], ['rain', 'Chuva'], ['rivers', 'Rios e lagos'], ['plates', 'Placas'], ['water', 'Água'], ['seasons', 'Estações']];

// ---------- worker RPC ----------
const worker = new Worker(new URL('./planet-worker.js', import.meta.url), { type: 'module' });
let rid = 0;
const pend = new Map();
worker.onmessage = (e) => { const f = pend.get(e.data.id); if (f) { pend.delete(e.data.id); f(e.data); } };
worker.onerror = (e) => status('Erro no worker: ' + (e.message || e));
const call = (type, args = {}) => new Promise((res, rej) => { const id = ++rid; pend.set(id, (d) => (d.error ? rej(new Error(d.error)) : res(d))); worker.postMessage({ id, type, ...args }); });
const status = (t) => { $('#status').textContent = t; };
const toCanvas = (d) => { const c = document.createElement('canvas'); c.width = d.w; c.height = d.h; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(d.data.buffer || d.data), d.w, d.h), 0, 0); return c; };

if (QS.has('compare')) compare(); else single();

// ---------- compare: a grid of 6 seeds ----------
async function compare() {
  $('#seed').parentElement.style.display = 'none'; $('#go').style.display = 'none';
  const list = (QS.get('compare') || '').split(',').map((s) => parseInt(s, 10)).filter((n) => n === n);
  const seeds = list.length ? list.slice(0, 6) : [1, 2, 3, 4, 5, 6];
  while (seeds.length < 6) seeds.push(seeds[seeds.length - 1] + 1);
  const grid = document.createElement('div'); grid.className = 'grid'; $('#root').appendChild(grid);
  for (const s of seeds) {
    status(`Gerando a semente ${s}…`);
    const g = await call('gen', { seed: s });
    const d = await call('detail', { w: 1024, h: 512 });
    const fig = document.createElement('figure'), cap = document.createElement('figcaption');
    const st = g.stats;
    cap.innerHTML = `<a href="?seed=${s}">semente ${s}</a> · ${g.ms} ms (+${d.ms} ms imagem) · terra ${st.land}% · ${st.continents} continentes · ${st.islands} ilhas · ${st.lakes} lagos · ~${st.villages} vilas`;
    fig.append(toCanvas(d), cap);
    grid.appendChild(fig);
  }
  status(`Pronto · ${seeds.length} sementes`);
}

// ---------- single planet ----------
async function single() {
  const root = $('#root');
  root.innerHTML = `<main><div id="wrap"><canvas id="map" width="1600" height="800"></canvas><div id="probe"></div></div>
    <div id="side"><canvas id="tiles" width="512" height="512"></canvas><div id="tinfo">Clique no mapa para ver o lugar em escala de tile.</div></div></main>`;
  const seed = parseInt(QS.get('seed') || '1', 10) || 1;
  $('#seed').value = seed;
  $('#go').onclick = () => { location.search = '?seed=' + ($('#seed').value | 0); };
  const imgs = {};
  let layer = QS.get('layer') || 'detail';
  const lay = $('#layers');
  for (const [k, pt] of LAYERS) {
    const b = document.createElement('button'); b.textContent = pt; b.dataset.k = k;
    b.onclick = () => setLayer(k);
    lay.appendChild(b);
  }
  const map = $('#map'), ctx = map.getContext('2d');
  // view: centre (tiles) and scale (canvas px per tile)
  const view = { cx: W / 2, cy: H / 2, z: map.width / W };
  const fitZ = map.width / W;
  function draw() {
    const img = imgs[layer];
    ctx.fillStyle = '#05080c'; ctx.fillRect(0, 0, map.width, map.height);
    if (!img) return;
    ctx.imageSmoothingEnabled = view.z / (img.width / W) < 2.5;
    const pxW = W * view.z, pxH = H * view.z;
    const x0 = map.width / 2 - view.cx * view.z, y0 = map.height / 2 - view.cy * view.z;
    for (let k = -2; k <= 2; k++) {
      const x = x0 + k * pxW;
      if (x + pxW < 0 || x > map.width) continue;
      ctx.drawImage(img, x, y0, pxW, pxH);
    }
    if (spawn) {
      for (let k = -1; k <= 1; k++) {
        const sx = x0 + (spawn.x + k * W) * view.z, sy = y0 + spawn.y * view.z;
        ctx.strokeStyle = '#ff4'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sx, sy, 7, 0, 7); ctx.stroke();
      }
    }
    if (picked) {
      const s = picked.size * view.z, px = x0 + picked.x0 * view.z, py = y0 + picked.y0 * view.z;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(px, py, Math.max(3, s), Math.max(3, s));
    }
  }
  const clampView = () => {
    view.z = Math.min(Math.max(view.z, fitZ), 1);
    const halfH = map.height / 2 / view.z;
    view.cy = Math.min(Math.max(view.cy, Math.min(halfH, H / 2)), Math.max(H - halfH, H / 2));
    view.cx = ((view.cx % W) + W) % W;
  };
  async function setLayer(k) {
    layer = k;
    for (const b of lay.children) b.classList.toggle('on', b.dataset.k === k);
    if (!imgs[k]) {
      status(`Desenhando a camada ${k}…`);
      const d = k === 'detail' ? await call('detail', { w: 2048, h: 1024 }) : await call('layer', { name: k });
      imgs[k] = toCanvas(d);
      status(`${info} · camada ${k}: ${d.ms} ms`);
    }
    draw();
  }
  // generate
  status(`Gerando o planeta ${seed}…`);
  const g = await call('gen', { seed });
  const t = g.timings, st = g.stats;
  const spawn = g.spawn;
  let picked = null;
  const info = `semente ${seed} · impressão ${g.hash} · planeta em ${g.ms} ms (${Object.entries(t).filter(([k]) => k !== 'total' && k !== 'seaShift').map(([k, v]) => `${k} ${v}`).join(', ')}) · início ${g.spMs} ms · ${g.mb} MB · terra ${st.land}% · ${st.continents} continentes (${st.continentAreas.map((a) => Math.round(a * 1024 / 65536)).join(', ')} vilas) · ${st.islands} ilhas · ${st.lakes} lagos · ${st.rivers} células de rio · ${st.volcanoes} vulcões · ${st.plates} placas · ~${st.villages} vilas de terra`;
  status(info);
  await setLayer(layer);
  // interaction
  const wrap = $('#wrap');
  let drag = null;
  const toTile = (ev) => {
    const r = map.getBoundingClientRect(), k = map.width / r.width;
    const px = (ev.clientX - r.left) * k, py = (ev.clientY - r.top) * k;
    return [((view.cx + (px - map.width / 2) / view.z) % W + W) % W, view.cy + (py - map.height / 2) / view.z];
  };
  wrap.addEventListener('pointerdown', (ev) => { drag = { x: ev.clientX, y: ev.clientY, cx: view.cx, cy: view.cy, moved: false }; wrap.setPointerCapture(ev.pointerId); });
  wrap.addEventListener('pointermove', (ev) => {
    if (drag) {
      const r = map.getBoundingClientRect(), k = map.width / r.width;
      const dx = (ev.clientX - drag.x) * k, dy = (ev.clientY - drag.y) * k;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      view.cx = drag.cx - dx / view.z; view.cy = drag.cy - dy / view.z; clampView(); draw();
    } else probe(ev);
  });
  wrap.addEventListener('pointerup', (ev) => {
    const d = drag; drag = null;
    if (d && !d.moved) { const [x, y] = toTile(ev); if (y >= 0 && y < H) showTiles(Math.floor(x), Math.floor(y)); }
  });
  wrap.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const [x, y] = toTile(ev);
    const f = ev.deltaY < 0 ? 1.25 : 0.8;
    const r = map.getBoundingClientRect(), k = map.width / r.width;
    const px = (ev.clientX - r.left) * k, py = (ev.clientY - r.top) * k;
    view.z *= f; clampView();
    view.cx = x - (px - map.width / 2) / view.z; view.cy = y - (py - map.height / 2) / view.z; clampView(); draw();
  }, { passive: false });
  let probeBusy = false;
  async function probe(ev) {
    if (probeBusy) return;
    const [x, y] = toTile(ev);
    if (y < 0 || y >= H) return;
    probeBusy = true;
    try {
      const p = await call('probe', { x: Math.floor(x), y: Math.floor(y) });
      $('#probe').textContent = `tile ${p.x}, ${p.y} · lat ${p.lat}° · ${p.biome}${p.coast ? ' · costa: ' + p.coast : ''}\nelevação ${p.elev} m (${p.stories} andares) · ${p.T} °C · ${p.P} mm/ano · ${p.zone} · placa ${p.plate} · ${p.water}`;
    } finally { probeBusy = false; }
  }
  async function showTiles(x, y) {
    const size = +$('#tsize').value;
    $('#tinfo').textContent = `Gerando ${size}×${size} tiles em ${x}, ${y}…`;
    const d = await call('tiles', { x, y, size, scale: size <= 256 ? 4 : 2 });
    const c = $('#tiles'); c.width = d.w; c.height = d.h;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(d.data.buffer || d.data), d.w, d.h), 0, 0);
    picked = { x0: d.x0, y0: d.y0, size: d.tiles };
    draw();
    const feats = Object.entries(d.feats).map(([k, v]) => `${k} ${v}`).join(', ');
    $('#tinfo').textContent = `${d.tiles}×${d.tiles} tiles a partir de ${d.x0}, ${d.y0} · ${d.chunks} chunks em ${d.genMs} ms (${d.perChunk} ms/chunk) · ${d.objects} objetos · altura ${d.hmin.toFixed(1)}…${d.hmax.toFixed(1)} andares\n${d.biomes.join(' · ')}${feats ? '\nmarcas: ' + feats + ' (círculos: branco = cachoeira, azul = nascente, laranja = cratera)' : ''}`;
  }
  // start on the spawn
  if (spawn) { view.cx = spawn.x; view.cy = H / 2; showTiles(Math.floor(spawn.x), Math.floor(spawn.y)); }
  window.planetView = { view, draw, showTiles, setLayer };
}
