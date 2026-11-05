// The wars on the map and the radar (docs/REINOS.md §13, phase 3a), drawn by ui/realmMap.js drawRealm:
//   - the borders between kingdoms at war: a red line along them (a small raster per war, made again only when the
//     relations or the owners change);
//   - the armies in the field: a disc in the kingdom's colour with its pennant, bigger with more soldiers, an arrow where it
//     marches (dashed when it retreats), "Reino · N" when zoomed in;
//   - sieges: a red dashed ring turning around the besieged place, the camp, a line from the camp to the walls;
//   - battles: crossed swords, a red glow.
// game.ui.warLayer === false hides it all (the map window's "Guerras" switch). Cosmetic, local; nothing per frame but the
// few armies in the field.
import { mapColor, territories, TERR } from './realmMap.js';

const INK = '#24160d', RED = '#e8463a', CREAM = '#f6ead0';
export const warOn = (game) => game.ui?.warLayer !== false && !!game.realms?.armies;

// ---------- the borders at war ----------
let WB = null; // { ov, rv, layers: [{ x0, y0, cv }] }
function warLayers(game, T) {
  const R = game.realms, realm = game.towns.realm;
  if (WB && WB.realm === realm && WB.ov === T.ov && WB.rv === R.rv) return WB.layers;
  const MW = 512, MH = 256, { RW, RH } = TERR, pk = T.pk, layers = [];
  const K = new Int16Array(realm.settlements.length + 1);
  for (const s of realm.settlements) K[s.id + 1] = R.owner(s.id) + 1;
  const cellK = (i) => (realm.owner[i] ? (realm.district[i] ? K[realm.district[i]] : realm.owner[i]) : 0);
  for (const [key, r] of R.rels) {
    if (r.r !== 'war') continue;
    const [a, b] = key.split('.').map(Number), A = a + 1, B = b + 1;
    // the cells where their lands touch → a pixel box around them
    let x0 = MW, y0 = MH, x1 = -1, y1 = -1;
    for (let cy = 0; cy < MH; cy++) for (let cx = 0; cx < MW; cx++) {
      const k = cellK(cy * MW + cx);
      if (k !== A && k !== B) continue;
      const o = k === A ? B : A;
      if ((cx + 1 < MW && cellK(cy * MW + cx + 1) === o) || (cy + 1 < MH && cellK((cy + 1) * MW + cx) === o)) { if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cy < y0) y0 = cy; if (cy > y1) y1 = cy; }
    }
    if (x1 < 0 || x1 - x0 > MW / 2) continue; // (they do not touch; or across the seam — the seam is open sea)
    const px0 = Math.max(0, x0 * 4 - 8), py0 = Math.max(0, y0 * 4 - 8), px1 = Math.min(RW - 1, x1 * 4 + 12), py1 = Math.min(RH - 1, y1 * 4 + 12);
    const w = px1 - px0 + 1, h = py1 - py0 + 1, mask = new Uint8Array(w * h);
    for (let y = py0; y <= py1; y++) for (let x = px0; x <= px1; x++) {
      const i = y * RW + x, k = pk[i];
      if (k !== A && k !== B) continue;
      const o = k === A ? B : A;
      if ((x + 1 < RW && pk[i + 1] === o) || (x > 0 && pk[i - 1] === o) || (y + 1 < RH && pk[i + RW] === o) || (y > 0 && pk[i - RW] === o)) mask[(y - py0) * w + (x - px0)] = 2;
    }
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const g = cv.getContext('2d'), im = g.createImageData(w, h), d = im.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const m = mask[y * w + x];
      let a2 = m ? 235 : 0;
      if (!m) for (let dy = -1; dy <= 1 && !a2; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h && mask[yy * w + xx]) { a2 = 90; break; } }
      if (!a2) continue;
      const o = (y * w + x) * 4;
      d[o] = 232; d[o + 1] = 60; d[o + 2] = 46; d[o + 3] = a2;
    }
    g.putImageData(im, 0, 0);
    layers.push({ x0: px0, y0: py0, w, h, cv, a, b });
  }
  WB = { realm, ov: T.ov, rv: R.rv, layers };
  return layers;
}
export function drawWarBorders(ctx, game, T, sx, sy, sw, sh, kx, ky, full) {
  const L = warLayers(game, T);
  if (!L.length) return;
  const { RW, TPP } = TERR, mx = sx / TPP, my = sy / TPP, mw = sw / TPP, mh = sh / TPP;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.globalAlpha = (full ? 0.85 : 0.6) + 0.15 * Math.sin(performance.now() / 380);
  for (const q of L) {
    for (let k = Math.floor((mx - q.x0 - q.w) / RW) + 1; (q.x0 + k * RW) < mx + mw; k++) {
      const ox = q.x0 + k * RW;
      if (ox + q.w < mx || q.y0 + q.h < my || q.y0 > my + mh) continue;
      ctx.drawImage(q.cv, (ox - mx) * TPP * kx, (q.y0 - my) * TPP * ky, q.w * TPP * kx, q.h * TPP * ky);
    }
  }
  ctx.restore();
}

// ---------- glyphs ----------
export function swords(ctx, X, Y, s, col = CREAM) {
  ctx.save();
  ctx.lineCap = 'round';
  for (const pass of [0, 1]) {
    ctx.strokeStyle = pass ? col : INK; ctx.lineWidth = pass ? Math.max(1.2, s * 0.16) : Math.max(2.6, s * 0.32);
    ctx.beginPath();
    ctx.moveTo(X - s, Y - s); ctx.lineTo(X + s * 0.75, Y + s * 0.75); // blades
    ctx.moveTo(X + s, Y - s); ctx.lineTo(X - s * 0.75, Y + s * 0.75);
    ctx.moveTo(X + s * 0.35, Y + s * 0.95); ctx.lineTo(X + s * 0.95, Y + s * 0.35); // guards
    ctx.moveTo(X - s * 0.35, Y + s * 0.95); ctx.lineTo(X - s * 0.95, Y + s * 0.35);
    ctx.stroke();
  }
  ctx.restore();
}
function tent(ctx, X, Y, s, col) {
  ctx.beginPath(); ctx.moveTo(X - s, Y + s * 0.7); ctx.lineTo(X, Y - s * 0.8); ctx.lineTo(X + s, Y + s * 0.7); ctx.closePath();
  ctx.fillStyle = col; ctx.fill(); ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(X, Y - s * 0.8); ctx.lineTo(X, Y + s * 0.7); ctx.stroke();
}
// an army: its kingdom's disc, a pennant, an arrow ahead when it marches
export function armyMark(ctx, X, Y, r, col, dir = null, retreat = false, live = false) {
  ctx.save();
  if (dir != null) {
    const c = Math.cos(dir), s = Math.sin(dir), L = r + 6;
    ctx.fillStyle = retreat ? 'rgba(246,234,208,0.75)' : col; ctx.strokeStyle = INK; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(X + c * (L + 4), Y + s * (L + 4)); ctx.lineTo(X + c * (r + 1) - s * 4, Y + s * (r + 1) + c * 4); ctx.lineTo(X + c * (r + 1) + s * 4, Y + s * (r + 1) - c * 4); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(X, Y, r, 0, Math.PI * 2);
  ctx.fillStyle = col; ctx.fill();
  ctx.lineWidth = 1.6; ctx.strokeStyle = INK;
  if (retreat) ctx.setLineDash([2.5, 2]);
  ctx.stroke(); ctx.setLineDash([]);
  ctx.beginPath(); ctx.arc(X, Y, r - 2.2, 0, Math.PI * 2); ctx.strokeStyle = 'rgba(246,234,208,0.7)'; ctx.lineWidth = 1; ctx.stroke();
  // the pennant on its pole
  ctx.strokeStyle = INK; ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.moveTo(X, Y - r * 0.2); ctx.lineTo(X, Y - r - 7); ctx.stroke();
  ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(X, Y - r - 7); ctx.lineTo(X + 7, Y - r - 4.5); ctx.lineTo(X, Y - r - 2); ctx.closePath(); ctx.fill(); ctx.stroke();
  if (live) { ctx.strokeStyle = '#ffe39a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(X, Y, r + 3, 0, Math.PI * 2); ctx.stroke(); }
  ctx.restore();
}

// ---------- armies, sieges, battles ----------
export function drawWar(ctx, game, sx, sy, sw, sh, kx, ky, full, toX, toY, W, H) {
  const R = game.realms, realm = game.towns?.realm;
  if (!R?.armies?.size || !realm) return;
  const w = game.world, p = game.player, t = performance.now() / 1000;
  const out = (X, Y, m) => X < -m || Y < -m || X > W + m || Y > H + m;
  const colOf = (k) => `rgb(${mapColor(realm.kingdoms[k]?.color || [200, 200, 200]).join(',')})`;
  ctx.save();
  ctx.textAlign = 'center';
  // sieges first (under the armies): the ring around the place, the line from the camp
  for (const a of R.armies.values()) {
    if (a.state !== 'siege' && !(a.state === 'battle' && a.phase.startsWith('siege'))) continue;
    const s = realm.settlements[a.target];
    if (!s) continue;
    const X = toX(s.x), Y = toY(s.y), rr = Math.max(full ? 9 : 7, s.r * kx + 4);
    if (out(X, Y, rr + 20)) continue;
    const CX = toX(a.x), CY = toY(a.y);
    ctx.strokeStyle = 'rgba(232,70,58,0.55)'; ctx.lineWidth = 1.4; ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(CX, CY); ctx.lineTo(X + (CX - X) * (rr / (Math.hypot(CX - X, CY - Y) || 1)), Y + (CY - Y) * (rr / (Math.hypot(CX - X, CY - Y) || 1))); ctx.stroke();
    ctx.strokeStyle = RED; ctx.lineWidth = full ? 2.4 : 2; ctx.setLineDash([5, 4]); ctx.lineDashOffset = -t * 8;
    ctx.beginPath(); ctx.arc(X, Y, rr, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]); ctx.lineDashOffset = 0;
    ctx.fillStyle = `rgba(232,70,58,${0.12 + 0.08 * Math.sin(t * 3)})`; ctx.beginPath(); ctx.arc(X, Y, rr, 0, Math.PI * 2); ctx.fill();
    if (!out(CX, CY, 10)) tent(ctx, CX + (full ? 9 : 6), CY + 2, full ? 5 : 3.5, colOf(a.k));
    swords(ctx, X + rr * 0.72, Y - rr * 0.72, full ? 5 : 3.5, '#ffd9cf');
    if (full && sw < 2600) {
      const txt = `Cerco · ${a.n} × ${R.defense?.(a.target)?.n ?? '?'}`;
      ctx.font = '700 10px system-ui, sans-serif'; ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.strokeText(txt, X, Y - rr - 5); ctx.fillStyle = '#ffd0c4'; ctx.fillText(txt, X, Y - rr - 5);
    }
  }
  // armies in the field and battles
  for (const a of R.armies.values()) {
    if (a.state === 'home') continue;
    if (!full && Math.hypot(w.dx(a.x, p.x), a.y - p.y) > sw) continue;
    const X = toX(a.x), Y = toY(a.y);
    if (out(X, Y, 24)) continue;
    if (a.state === 'battle') {
      const f = R.armies.get(a.foe);
      if (f && f.id < a.id) continue; // (one mark per battle)
      const g = 0.5 + 0.5 * Math.sin(t * 5);
      ctx.fillStyle = `rgba(232,70,58,${0.25 + 0.2 * g})`; ctx.beginPath(); ctx.arc(X, Y, (full ? 12 : 9) + 3 * g, 0, Math.PI * 2); ctx.fill();
      swords(ctx, X, Y, full ? 7 : 5);
      if (full && sw < 2600 && f) {
        const txt = `Batalha · ${a.n} × ${f.n}`;
        ctx.font = '700 10px system-ui, sans-serif'; ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.strokeText(txt, X, Y - 15); ctx.fillStyle = '#ffd0c4'; ctx.fillText(txt, X, Y - 15);
      }
      continue;
    }
    if (a.state === 'siege') continue; // (the camp is drawn with the siege)
    const r = full ? Math.max(4, Math.min(10, 3 + Math.sqrt(a.n) * 0.55)) : Math.max(3, Math.min(6, 2 + Math.sqrt(a.n) * 0.35));
    const moving = a.state === 'march' || a.state === 'retreat';
    armyMark(ctx, X, Y, r, colOf(a.k), moving && a._dir != null ? a._dir : null, a.state === 'retreat', !!a.live);
    if (full && sw < 2600) {
      const txt = `${realm.kingdoms[a.k]?.name || ''} · ${a.n}`;
      ctx.font = '700 10px system-ui, sans-serif'; ctx.lineWidth = 3; ctx.strokeStyle = INK; ctx.strokeText(txt, X, Y + r + 11); ctx.fillStyle = CREAM; ctx.fillText(txt, X, Y + r + 11);
    }
  }
  ctx.restore();
}

// ---------- the map window's legend and switch (ui/panels.js) ----------
let styled = false;
export function warLegend(game) {
  if (!styled && typeof document !== 'undefined') {
    styled = true;
    const st = document.createElement('style');
    st.textContent = `
.legend.war { margin-top: -2px; flex-wrap: wrap; justify-content: center; }
.legend i.lg-army { background: #d9a441; box-shadow: 0 0 0 1.5px var(--n-ink), inset 0 0 0 2px rgba(246,234,208,0.7); }
.legend i.lg-siege { background: transparent; box-shadow: none; border: 2px dashed #e8463a; width: 9px; height: 9px; }
.legend i.lg-war { border-radius: 2px; height: 4px; width: 14px; background: #e8463a; vertical-align: 2px; box-shadow: 0 0 4px #e8463a; }
.legend i.lg-battle { border-radius: 0; box-shadow: none; width: 13px; height: 13px; vertical-align: -2px;
  background: linear-gradient(45deg, transparent 42%, #f6ead0 42%, #f6ead0 58%, transparent 58%), linear-gradient(-45deg, transparent 42%, #f6ead0 42%, #f6ead0 58%, transparent 58%); filter: drop-shadow(0 0 1px #24160d) drop-shadow(0 0 2px #e8463a); }
.mm-war { margin-top: 2px; }
`;
    document.head.appendChild(st);
  }
  const on = game.ui?.warLayer !== false;
  return `<div class="legend war"><span><i class="lg-army"></i>Exército</span><span><i class="lg-siege"></i>Cerco</span><span><i class="lg-battle"></i>Batalha</span><span><i class="lg-war"></i>Fronteira em guerra</span></div>
    <label class="mm-rot mm-war" data-tip="<b>Guerras</b><p>Mostra no mapa e no radar os exércitos em marcha (cor do reino, tamanho pelos soldados, seta para onde vão), os cercos, as batalhas e as fronteiras entre reinos em guerra.</p>"><input type="checkbox" data-mmwar${on ? ' checked' : ''}> Guerras e exércitos</label>`;
}
export { territories };
