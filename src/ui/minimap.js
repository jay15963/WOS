// Minimap: the world around the player rasterized per chunk (1 px per tile) from rock/water/ground/objects, then a
// window around the player is blitted each refresh with creature / structure dots on top.
// Drawn inside the radar disc (radar.js) and the map window; dot colours follow the HUD theme (hud-theme.css).

import { SPECIES } from '../game/data.js';
import { markExplored } from '../game/explore.js';

// theme colours (hud-theme.css tokens): coral hostile, mustard neutral, olive passive, teal players
const DOT = { hostile: '#ec5a4c', neutral: '#f0c24a', passive: '#9cc45a' };
const INK = '#24160d', CREAM = '#f6ead0', TEAL = '#4cc2b4', FIRE = '#ffa040', ICE = '#bfeaf8';
// an ice giant (species 'giant'): a big red disc in an ice ring with an ice crystal in it — also the map's legend
export function giantMark(ctx, X, Y, r) {
  ctx.fillStyle = 'rgba(236,90,76,0.25)'; ctx.beginPath(); ctx.arc(X, Y, r + 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = DOT.hostile; ctx.beginPath(); ctx.arc(X, Y, r, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = INK; ctx.lineWidth = 1.2; ctx.stroke();
  ctx.strokeStyle = ICE; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(X, Y, r + 1.4, 0, Math.PI * 2); ctx.stroke();
  const k = r * 0.62;
  ctx.fillStyle = ICE; ctx.beginPath(); ctx.moveTo(X, Y - k); ctx.lineTo(X + k * 0.6, Y); ctx.lineTo(X, Y + k); ctx.lineTo(X - k * 0.6, Y); ctx.closePath(); ctx.fill();
}

// camera yaw (game.cam.rot, docs/CAMERA-ROTATION.md): the radar disc turns with the view by default (up on the radar =
// up on the screen; the compass needle shows north), the big map stays north-up; both show a cone where the camera
// looks while it is turned. Preference 'wos.radarRot' ('0' = the radar stays north-up), set in the map window.
let RADAR_ROT = null;
export function radarTurns() {
  if (RADAR_ROT == null) { try { RADAR_ROT = localStorage.getItem('wos.radarRot') !== '0'; } catch { RADAR_ROT = true; } }
  return RADAR_ROT;
}
export function setRadarTurns(on) { RADAR_ROT = !!on; try { localStorage.setItem('wos.radarRot', on ? '1' : '0'); } catch { /* ignore */ } }
// the yaw the radar is drawn with (0 = north-up)
export const radarYaw = (game) => (radarTurns() ? game.cam.rot || 0 : 0);

const GROUND = [[92, 76, 52], [74, 60, 40], [176, 158, 116], [118, 112, 100], [72, 80, 52], [78, 64, 46], [104, 100, 94], [70, 86, 46]];
const ROCK = [[96, 94, 90], [104, 101, 96], [128, 122, 106], [76, 78, 84], [150, 148, 142]];
const GRASS = [86, 112, 54];

// Planet scale (docs/STREAMING.md "Mapa"): no whole-world raster. A RING canvas of RING × RING tiles (1 px / tile) holds
// the chunks around the player, rasterized when they load (the classic world: all of it up front); the big map draws
// the source's coarse planet image (macro) under them and the chunks discovered so far (fog of war: `seen`), with
// zoom (wheel / buttons) and pan (drag) — Minimap.view = { cx, cy, span } (null = fit the world / around the player).
// Fog of war (planet): game.explored (one byte per chunk, marked around the local player: markExplored, saved with the
// player in save.js) — the explored land is drawn bright, the rest of the planet dimmed; the ring's chunks carry
// relief shading from the terrain heights (radar and map); other players are marked with their names on the map.
const RING = 1024, RM = RING - 1, RC = RING / 64;


export class Minimap {
  constructor(game) {
    this.g = game;
    const w = game.world;
    this.base = document.createElement('canvas');
    this.base.width = RING; this.base.height = RING;
    this.bctx = this.base.getContext('2d');
    this.img = this.bctx.createImageData(64, 64);
    this.slot = new Int32Array(RC * RC).fill(-1); // chunk key rasterized in each ring slot
    this.seen = new Set();                         // chunks discovered (rasterized once at least)
    this.view = null;
    this.macro = null;
    const M = w.source?.macro?.();
    if (M) {
      const c = document.createElement('canvas');
      c.width = M.w; c.height = M.h;
      const im = c.getContext('2d').createImageData(M.w, M.h);
      im.data.set(M.rgba);
      c.getContext('2d').putImageData(im, 0, 0);
      this.macro = { canvas: c, tpp: M.tpp }; // tpp: tiles per macro pixel
    }
    // the painted planet (relief, biomes, coasts, rivers — planetSource mapImage, made by the planet worker after the
    // boot) replaces the coarse macro picture when it arrives
    w.source?.mapImage?.then?.((I) => {
      if (!I || this.g.world !== w) return;
      const c = document.createElement('canvas');
      c.width = I.w; c.height = I.h;
      const cx = c.getContext('2d'), im = cx.createImageData(I.w, I.h);
      im.data.set(I.rgba);
      cx.putImageData(im, 0, 0);
      this.macro = { canvas: c, tpp: I.tpp, painted: true };
    });
    if (!w.wrap) for (let cy = Math.floor(w.by0 / 64); cy <= Math.floor((w.by1 - 1) / 64); cy++) for (let cx = Math.floor(w.bx0 / 64); cx <= Math.floor((w.bx1 - 1) / 64); cx++) this._raster(cx, cy);
  }

  // rasterize chunk (cx, cy) into its ring slot (it must be loaded)
  _raster(cx, cy) {
    const w = this.g.world, c = cy * 256 + (cx & 255);
    if (!w.isLoaded(c)) return false;
    const x0 = cx * 64, y0 = cy * 64;
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) this._px(x0 + x, y0 + y, (y * 64 + x) * 4);
    this._stampObjects(x0, y0, x0 + 63, y0 + 63);
    this.bctx.putImageData(this.img, x0 & RM, y0 & RM);
    this.slot[((cy & (RC - 1)) * RC) + (cx & (RC - 1))] = c;
    this.seen.add(c);
    return true;
  }
  // keep the ring filled around (x, y): a few new chunks per call (they load as the player moves)
  _sync(x, y) {
    const w = this.g.world, pcx = Math.floor(x / 64), pcy = Math.floor(y / 64);
    let n = 0;
    const max = this.slot.includes(-1) && !this._warm ? 64 : 1; // (one new chunk per call while playing: ~1 ms)
    this._warm = true;
    for (let r = 0; r <= RC / 2 - 1 && n < max; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r || n >= max) continue;
      const cx = pcx + dx, cy = pcy + dy;
      if (cy < 0 || cy >= 128) continue;
      const c = cy * 256 + (cx & 255);
      if (this.slot[(cy & (RC - 1)) * RC + (cx & (RC - 1))] === c || !w.isLoaded(c)) continue;
      if (this._raster(cx, cy)) n++;
    }
  }

  _px(x, y, o) {
    const w = this.g.world, i = w.idx(x, y), d = this.img.data;
    let c;
    if (!w.inBounds(x, y)) c = [29, 18, 10];
    else if (w.rock.get(i)) {
      c = ROCK[w.rockType.get(i)] || ROCK[0];
      const k = w.ore.get(i) ? 1.15 : 1;
      c = [c[0] * k, c[1] * k, c[2] * (w.ore.get(i) ? 0.9 : 1)];
    } else if (w.water.get(i) >= 2) c = w.zone && w.zone.get(i) & 8 ? [16, 30, 56] : [38, 72, 96]; // (the abyssal ocean darker)
    else if (w.water.get(i) === 1) c = [72, 116, 128];
    else {
      const g = GROUND[w.ground.get(i)] || GROUND[0];
      const l = w.lush.get(i) * 0.55;
      c = [g[0] + (GRASS[0] - g[0]) * l, g[1] + (GRASS[1] - g[1]) * l, g[2] + (GRASS[2] - g[2]) * l];
      const pg = w.pground ? w.pground.get(i) : 0;
      if (pg === 8 || pg === 9) c = [222, 228, 236]; // (the planet's snow / ice ground)
    }
    // relief: light from the north-west on the terrain heights (corners: hC, the surface with the players' edits)
    let k = 1;
    if (w.height?.any && !w.water.get(i)) {
      const H = w.hC, a = H.get(i), b = H.get(w.idx(x + 1, y + 1)), e = H.get(w.idx(x + 1, y)), f = H.get(w.idx(x, y + 1));
      k = Math.max(0.55, Math.min(1.45, 1 + 0.55 * ((a - b) + 0.5 * (f - e))));
    }
    const n = ((x * 73 + y * 151) & 7) - 3.5;
    d[o] = c[0] * k + n; d[o + 1] = c[1] * k + n; d[o + 2] = c[2] * k + n; d[o + 3] = 255;
  }

  _stampObjects(x0, y0, x1, y1) {
    const w = this.g.world, d = this.img.data;
    w.forChunks(x0, y0, x1 + 1, y1 + 1, (ch) => {
      for (const o of ch.objects) {
        const tx = Math.floor(o.x), ty = Math.floor(o.y - 0.05);
        if (tx < x0 || ty < y0 || tx > x1 || ty > y1 || !w.inBounds(tx, ty)) continue;
        const k = ((ty - y0) * 64 + (tx - x0)) * 4;
        let c = null;
        if (o.type.startsWith('tree_') && !o.stump) c = o.type === 'tree_pine' ? [34, 62, 36] : [44, 76, 38];
        else if (o.type === 'boulder') c = [128, 124, 116];
        else if (o.type === 'berrybush') c = [120, 52, 70];
        else if (o.building) c = o.type === 'wall_wood' ? [150, 112, 70] : o.fire ? [240, 150, 60] : o.type === 'pier_wood' ? [168, 128, 82] : o.type === 'bridge_wood' ? [182, 150, 108] : [190, 150, 100]; // (piers / bridges: planks over the water)
        if (c) { d[k] = c[0]; d[k + 1] = c[1]; d[k + 2] = c[2]; }
      }
    });
  }

  // re-rasterize a small tile region (mining, building, felled tree): its chunk(s), when they are in the ring
  updateTiles(tx, ty, r = 2) {
    const done = new Set();
    for (const [x, y] of [[tx - r, ty - r], [tx + r, ty - r], [tx - r, ty + r], [tx + r, ty + r]]) {
      const cx = Math.floor(x / 64), cy = Math.floor(y / 64), c = cy * 256 + (cx & 255);
      if (done.has(c) || this.slot[(cy & (RC - 1)) * RC + (cx & (RC - 1))] !== c) continue;
      done.add(c);
      this._raster(cx, cy);
    }
  }

  // the rect of the world the big map shows: the classic world whole, the planet around the player (zoom / pan: view)
  mapRect(full) {
    const g = this.g, w = g.world, p = g.player;
    if (this.view) return this.view;
    if (!w.wrap) { const bw = w.bx1 - w.bx0, bh = w.by1 - w.by0, s = Math.max(bw, bh); return { cx: w.bx0 + bw / 2, cy: w.by0 + bh / 2, span: s }; }
    return { cx: p.x, cy: p.y, span: full ? 512 : 64 };
  }
  zoom(k) { const r = { ...this.mapRect(true) }; r.span = Math.max(48, Math.min(this.g.world.W, r.span * k)); this.view = r; }
  pan(dx, dy) { const r = { ...this.mapRect(true) }; r.cx = this.g.world.wrapPos(r.cx + dx); r.cy = Math.max(0, Math.min(this.g.world.H, r.cy + dy)); this.view = r; }
  resetView() { this.view = null; }

  // the fog of war (planet): 1 px per chunk, transparent where explored, a dark veil elsewhere
  _fogCanvas() {
    const g = this.g;
    if (!g.explored) markExplored(g);
    const E = g.explored, v = g._exploredV || 0;
    if (!this.fog) { this.fog = document.createElement('canvas'); this.fog.width = 256; this.fog.height = 128; this.fogV = -1; }
    if (this.fogV !== v) {
      this.fogV = v;
      const cx = this.fog.getContext('2d'), im = cx.createImageData(256, 128), d = im.data;
      for (let c = 0; c < 32768; c++) { const o = c * 4; d[o] = 38; d[o + 1] = 27; d[o + 2] = 16; d[o + 3] = E && E[c] ? 0 : 128; } // (a warm veil: still readable)
      cx.putImageData(im, 0, 0);
    }
    return this.fog;
  }

  // the world under the map: the macro planet image (when zoomed out / undiscovered), then the discovered chunks
  _blit(ctx, sx, sy, sw, sh, kx, ky) {
    const w = this.g.world, M = this.macro;
    if (M && w.wrap) {
      // the planet picture, repeated across the seam
      const t = M.tpp, mx = sx / t, my = sy / t, mw = sw / t, mh = sh / t, PWm = w.W / t;
      ctx.imageSmoothingEnabled = true; // (32 tiles a pixel: soft, not blocks)
      for (let k = Math.floor(mx / PWm); k * PWm < mx + mw; k++) {
        const ox = k * PWm, a0 = Math.max(mx, ox), a1 = Math.min(mx + mw, ox + PWm);
        if (a1 <= a0) continue;
        const b0 = Math.max(0, my), b1 = Math.min(M.canvas.height, my + mh);
        if (b1 <= b0) continue;
        ctx.drawImage(M.canvas, a0 - ox, b0, a1 - a0, b1 - b0, (a0 - mx) * t * kx, (b0 - my) * t * ky, (a1 - a0) * t * kx, (b1 - b0) * t * ky);
      }
      // the fog of war over it (explored chunks bright), soft edges
      const F = this._fogCanvas(), fx = sx / 64, fy = sy / 64, fw = sw / 64, fh = sh / 64;
      this._ringA = sw > 1400 ? 0 : sw > 700 ? (1400 - sw) / 700 : 1; // (the detailed chunks fade in as the map zooms in)
      ctx.imageSmoothingEnabled = true;
      for (let k = Math.floor(fx / 256); k * 256 < fx + fw; k++) {
        const ox = k * 256, a0 = Math.max(fx, ox), a1 = Math.min(fx + fw, ox + 256), b0 = Math.max(0, fy), b1 = Math.min(128, fy + fh);
        if (a1 <= a0 || b1 <= b0) continue;
        ctx.filter = `blur(${Math.max(1, Math.min(14, 28 * kx)).toFixed(1)}px)`; // (soft fog edges, not chunk squares)
        ctx.drawImage(F, a0 - ox, b0, a1 - a0, b1 - b0, (a0 - fx) * 64 * kx, (b0 - fy) * 64 * ky, (a1 - a0) * 64 * kx, (b1 - b0) * 64 * ky);
        ctx.filter = 'none';
      }
      ctx.imageSmoothingEnabled = false;
    }
    // discovered chunks in the ring
    const cx0 = Math.floor(sx / 64), cx1 = Math.floor((sx + sw) / 64), cy0 = Math.max(0, Math.floor(sy / 64)), cy1 = Math.min(127, Math.floor((sy + sh) / 64));
    if (cx1 - cx0 > RC * 2 || cy1 - cy0 > RC * 2) return; // (zoomed far out: the planet picture is enough)
    const ra = M && w.wrap ? this._ringA ?? 1 : 1;
    if (ra <= 0) return;
    ctx.globalAlpha = ra;
    // zoomed in (a tile ≥ 2 px): smooth the 1 px-per-tile picture — soft coasts instead of stair steps
    const smooth = kx >= 2;
    if (smooth) { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; }
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const c = cy * 256 + (cx & 255);
      if (this.slot[(cy & (RC - 1)) * RC + (cx & (RC - 1))] !== c) continue;
      ctx.drawImage(this.base, (cx * 64) & RM, (cy * 64) & RM, 64, 64, (cx * 64 - sx) * kx, (cy * 64 - sy) * ky, 64 * kx + 0.5, 64 * ky + 0.5);
    }
    ctx.globalAlpha = 1;
    if (smooth) ctx.imageSmoothingEnabled = false;
  }

  // draw into ctx (css px size W×H); span = tiles visible across; full = the big map (mapRect)
  draw(ctx, W, H, span, full = false) {
    const g = this.g, p = g.player, w = g.world;
    this._sync(p.x, p.y);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#1d120a';
    ctx.fillRect(0, 0, W, H);
    let sx, sy, sw, sh;
    if (full) { const r = this.mapRect(true); sw = r.span; sh = r.span * (H / W); sx = r.cx - sw / 2; sy = r.cy - sh / 2; }
    else { sw = span; sh = span * (H / W); sx = p.x - sw / 2; sy = p.y - sh / 2; }
    const kx = W / sw, ky = H / sh;
    const cr = full ? 0 : radarYaw(g); // (the radar turned with the camera: everything below in the turned frame)
    if (cr) {
      const c = Math.abs(Math.cos(cr)), s = Math.abs(Math.sin(cr)), sw2 = c * sw + s * sh, sh2 = s * sw + c * sh;
      ctx.save();
      ctx.translate(W / 2, H / 2); ctx.rotate(-cr); ctx.translate(-W / 2, -H / 2);
      ctx.save(); ctx.translate(W / 2 - (sw2 * kx) / 2, H / 2 - (sh2 * ky) / 2);
      this._blit(ctx, p.x - sw2 / 2, p.y - sh2 / 2, sw2, sh2, kx, ky);
      ctx.restore();
    } else this._blit(ctx, sx, sy, sw, sh, kx, ky);
    const mxC = sx + sw / 2; // (positions nearest the map centre: the planet wraps)
    const toX = (x) => (w.near(x, mxC) - sx) * kx, toY = (y) => (y - sy) * ky;
    // (turned: what the disc shows is a circle around the player, wider than the unturned rectangle in one direction)
    const M = cr ? Math.max(W, H) / 2 : 0, out = (X, Y, e) => (cr ? Math.hypot(X - W / 2, Y - H / 2) > M + e : X < -e || Y < -e || X > W + e || Y > H + e);
    // structures
    for (const o of g.build.structures) {
      if (!o.fire && o.type !== 'bed' && o.type !== 'chest') continue;
      const X = toX(o.x), Y = toY(o.y);
      if (out(X, Y, 4)) continue;
      if (o.fire) {
        ctx.fillStyle = 'rgba(255,150,60,0.35)';
        ctx.beginPath(); ctx.arc(X, Y, 4.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = FIRE;
        ctx.fillRect(X - 1.8, Y - 1.8, 3.6, 3.6);
      } else {
        ctx.fillStyle = INK; ctx.fillRect(X - 2.5, Y - 2.5, 5, 5);
        ctx.fillStyle = CREAM; ctx.fillRect(X - 1.5, Y - 1.5, 3, 3);
      }
    }
    // boats (game/boats.js): a little hull along its heading — wood, the bow pointed; teal edge when you are aboard
    if (g.boats?.map.size) {
      const mine = g.boats.mine?.();
      for (const b of g.boats.map.values()) {
        const X = toX(b._x), Y = toY(b._y);
        if (out(X, Y, 8)) continue;
        const L = Math.max(5, 2.1 * kx), Wd = Math.max(2.2, 0.7 * kx), c = Math.cos(b._h), s = Math.sin(b._h);
        const P = (u, v) => [X + c * u * L - s * v * Wd, Y + s * u * L + c * v * Wd];
        ctx.beginPath();
        const pts = [P(1, 0), P(0.45, 1), P(-0.95, 0.85), P(-0.95, -0.85), P(0.45, -1)];
        ctx.moveTo(pts[0][0], pts[0][1]); for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]); ctx.closePath();
        ctx.fillStyle = '#b07a45'; ctx.fill();
        ctx.strokeStyle = b === mine ? TEAL : INK; ctx.lineWidth = b === mine ? 1.6 : 1; ctx.stroke();
      }
    }
    // creatures (the big map zoomed far out: only players and giants — the planet is not a swarm of dots)
    const dot = full ? 2 : 2.5, farMap = full && sw > 700;
    const giants = [];
    for (const e of g.entities) {
      if (e.dead) continue;
      if (e.species === 'giant') { giants.push(e); continue; } // (drawn last, on top: giantMark)
      if (e.remote || e.faction === 'bandit' || e.faction === 'walker') {
        // other players (blue), raiders and winter walkers (red)
        if (farMap && !e.remote) continue;
        const X = toX(e.x), Y = toY(e.y);
        if (out(X, Y, 0)) continue;
        if (!full && !e.remote && Math.hypot(w.dx(e.x, p.x), e.y - p.y) > 40) continue;
        ctx.fillStyle = e.remote ? TEAL : DOT.hostile;
        ctx.beginPath(); ctx.arc(X, Y, e.remote ? dot + 1 : dot, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = e.remote ? CREAM : INK; ctx.lineWidth = 1; ctx.stroke();
        if (full && e.remote && e.name) { // (the map: who it is)
          ctx.font = '600 10px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = INK;
          ctx.strokeText(e.name, X, Y - 7); ctx.fillStyle = CREAM; ctx.fillText(e.name, X, Y - 7);
        }
        continue;
      }
      if (e.kind !== 'animal' || farMap) continue;
      const X = toX(e.x), Y = toY(e.y);
      if (out(X, Y, 0)) continue;
      if (!full && Math.hypot(w.dx(e.x, p.x), e.y - p.y) > 40) continue;
      ctx.fillStyle = DOT[SPECIES[e.species]?.temper] || DOT.neutral;
      ctx.beginPath(); ctx.arc(X, Y, e === p.target ? dot + 1.2 : dot * (e.elite ? 1.4 : 1), 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = e === p.target ? '#fff' : 'rgba(36,22,13,0.85)'; ctx.lineWidth = e === p.target ? 1.4 : 0.8; ctx.stroke();
    }
    // ice giants: their own bigger mark, seen from farther (the threat of the winter nights)
    for (const e of giants) {
      const X = toX(e.x), Y = toY(e.y);
      if (out(X, Y, 0) || (!full && Math.hypot(w.dx(e.x, p.x), e.y - p.y) > 70)) continue;
      giantMark(ctx, X, Y, full ? 3.6 : 4.4);
      if (e === p.target) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(X, Y, (full ? 3.6 : 4.4) + 3, 0, Math.PI * 2); ctx.stroke(); }
    }
    // spawn camp marker
    {
      const X = toX(w.spawn.x), Y = toY(w.spawn.y);
      ctx.strokeStyle = 'rgba(246,234,208,0.8)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(X, Y - 3.5); ctx.lineTo(X + 3.5, Y); ctx.lineTo(X, Y + 3.5); ctx.lineTo(X - 3.5, Y); ctx.closePath(); ctx.stroke();
    }
    // player arrow
    const X = toX(p.x), Y = toY(p.y);
    const ang = { s: Math.PI / 2, n: -Math.PI / 2, e: 0, w: Math.PI }[p.facing] ?? 0;
    // camera turned: a soft cone toward where the view looks (up on the screen)
    if (g.cam.rot || g.cam.rotTo) {
      const [ux, uy] = g.toWorldDir(0, -1), va = Math.atan2(uy, ux), R = full ? 16 : 22;
      ctx.fillStyle = 'rgba(255,236,190,0.2)';
      ctx.beginPath(); ctx.moveTo(X, Y); ctx.arc(X, Y, R, va - 0.6, va + 0.6); ctx.closePath(); ctx.fill();
    }
    ctx.save();
    ctx.translate(X, Y); ctx.rotate(ang);
    // soft light under the player, then a cream arrow with an ink outline
    ctx.fillStyle = 'rgba(255,236,190,0.22)';
    ctx.beginPath(); ctx.arc(0, 0, full ? 7 : 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = CREAM; ctx.strokeStyle = INK; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
    const s = full ? 5 : 6;
    ctx.beginPath(); ctx.moveTo(s, 0); ctx.lineTo(-s * 0.7, s * 0.65); ctx.lineTo(-s * 0.35, 0); ctx.lineTo(-s * 0.7, -s * 0.65); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
    if (cr) ctx.restore();
  }
}
