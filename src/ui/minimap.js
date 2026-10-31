// Minimap: the world is rasterized once (1 px per tile) from rock/water/ground/objects, then a
// window around the player is blitted each refresh with creature / structure dots on top.
// Drawn inside the radar disc (radar.js) and the map window; dot colours follow the HUD theme (hud-theme.css).

import { SPECIES } from '../game/data.js';

// theme colours (hud-theme.css tokens): coral hostile, mustard neutral, olive passive, teal players
const DOT = { hostile: '#ec5a4c', neutral: '#f0c24a', passive: '#9cc45a' };
const INK = '#24160d', CREAM = '#f6ead0', TEAL = '#4cc2b4', FIRE = '#ffa040';

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

export class Minimap {
  constructor(game) {
    this.g = game;
    const w = game.world;
    this.base = document.createElement('canvas');
    this.base.width = w.W; this.base.height = w.H;
    this.bctx = this.base.getContext('2d');
    this.img = this.bctx.createImageData(w.W, w.H);
    for (let y = 0; y < w.H; y++) for (let x = 0; x < w.W; x++) this._px(x, y);
    this._stampObjects(0, 0, w.W - 1, w.H - 1);
    this.bctx.putImageData(this.img, 0, 0);
  }

  _px(x, y) {
    const w = this.g.world, i = w.idx(x, y), d = this.img.data, o = i * 4;
    let c;
    if (w.rock[i]) {
      c = ROCK[w.rockType[i]] || ROCK[0];
      const k = w.ore[i] ? 1.15 : 1;
      c = [c[0] * k, c[1] * k, c[2] * (w.ore[i] ? 0.9 : 1)];
    } else if (w.water[i] === 2) c = [38, 72, 96];
    else if (w.water[i] === 1) c = [72, 116, 128];
    else {
      const g = GROUND[w.ground[i]] || GROUND[0];
      const l = (w.lush ? w.lush[i] : 0) * 0.55;
      c = [g[0] + (GRASS[0] - g[0]) * l, g[1] + (GRASS[1] - g[1]) * l, g[2] + (GRASS[2] - g[2]) * l];
    }
    const n = ((x * 73 + y * 151) & 7) - 3.5;
    d[o] = c[0] + n; d[o + 1] = c[1] + n; d[o + 2] = c[2] + n; d[o + 3] = 255;
  }

  _stampObjects(x0, y0, x1, y1) {
    const w = this.g.world, d = this.img.data;
    w.forChunks(x0, y0, x1 + 1, y1 + 1, (ch) => {
      for (const o of ch.objects) {
        const tx = Math.floor(o.x), ty = Math.floor(o.y - 0.05);
        if (tx < x0 || ty < y0 || tx > x1 || ty > y1 || !w.inBounds(tx, ty)) continue;
        const k = w.idx(tx, ty) * 4;
        let c = null;
        if (o.type.startsWith('tree_') && !o.stump) c = o.type === 'tree_pine' ? [34, 62, 36] : [44, 76, 38];
        else if (o.type === 'boulder') c = [128, 124, 116];
        else if (o.type === 'berrybush') c = [120, 52, 70];
        else if (o.building) c = o.type === 'wall_wood' ? [150, 112, 70] : o.fire ? [240, 150, 60] : [190, 150, 100];
        if (c) { d[k] = c[0]; d[k + 1] = c[1]; d[k + 2] = c[2]; }
      }
    });
  }

  // re-rasterize a small tile region (mining, building, felled tree)
  updateTiles(tx, ty, r = 2) {
    const w = this.g.world;
    const x0 = Math.max(0, tx - r), y0 = Math.max(0, ty - r), x1 = Math.min(w.W - 1, tx + r), y1 = Math.min(w.H - 1, ty + r);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this._px(x, y);
    this._stampObjects(x0, y0, x1, y1);
    this.bctx.putImageData(this.img, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  }

  // draw into ctx (css px size W×H); span = tiles visible across; full = whole map
  draw(ctx, W, H, span, full = false) {
    const g = this.g, p = g.player, w = g.world;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#1d120a';
    ctx.fillRect(0, 0, W, H);
    let sx, sy, sw, sh;
    if (full) { sx = 0; sy = 0; sw = w.W; sh = w.H; }
    else { sw = span; sh = span * (H / W); sx = p.x - sw / 2; sy = p.y - sh / 2; }
    const kx = W / sw, ky = H / sh;
    const cr = full ? 0 : radarYaw(g); // (the radar turned with the camera: everything below in the turned frame)
    if (cr) {
      const c = Math.abs(Math.cos(cr)), s = Math.abs(Math.sin(cr)), sw2 = c * sw + s * sh, sh2 = s * sw + c * sh;
      ctx.save();
      ctx.translate(W / 2, H / 2); ctx.rotate(-cr); ctx.translate(-W / 2, -H / 2);
      ctx.drawImage(this.base, p.x - sw2 / 2, p.y - sh2 / 2, sw2, sh2, W / 2 - (sw2 * kx) / 2, H / 2 - (sh2 * ky) / 2, sw2 * kx, sh2 * ky);
    } else ctx.drawImage(this.base, sx, sy, sw, sh, 0, 0, W, H);
    const toX = (x) => (x - sx) * kx, toY = (y) => (y - sy) * ky;
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
    // creatures
    const dot = full ? 2 : 2.5;
    for (const e of g.entities) {
      if (e.dead) continue;
      if (e.remote || e.faction === 'bandit' || e.faction === 'walker') {
        // other players (blue), raiders and winter walkers (red)
        const X = toX(e.x), Y = toY(e.y);
        if (out(X, Y, 0)) continue;
        if (!full && !e.remote && Math.hypot(e.x - p.x, e.y - p.y) > 40) continue;
        ctx.fillStyle = e.remote ? TEAL : DOT.hostile;
        ctx.beginPath(); ctx.arc(X, Y, e.remote ? dot + 1 : dot, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = e.remote ? CREAM : INK; ctx.lineWidth = 1; ctx.stroke();
        continue;
      }
      if (e.kind !== 'animal') continue;
      const X = toX(e.x), Y = toY(e.y);
      if (out(X, Y, 0)) continue;
      if (!full && Math.hypot(e.x - p.x, e.y - p.y) > 40) continue;
      ctx.fillStyle = DOT[SPECIES[e.species]?.temper] || DOT.neutral;
      ctx.beginPath(); ctx.arc(X, Y, e === p.target ? dot + 1.2 : dot * (e.elite ? 1.4 : 1), 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = e === p.target ? '#fff' : 'rgba(36,22,13,0.85)'; ctx.lineWidth = e === p.target ? 1.4 : 0.8; ctx.stroke();
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
