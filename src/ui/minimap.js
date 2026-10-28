// Minimap: the world is rasterized once (1 px per tile) from rock/water/ground/objects, then a
// window around the player is blitted each refresh with creature / structure dots on top.

import { SPECIES, TEMPER_COLOR } from '../game/data.js';

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
    ctx.fillStyle = '#0d0e0f';
    ctx.fillRect(0, 0, W, H);
    let sx, sy, sw, sh;
    if (full) { sx = 0; sy = 0; sw = w.W; sh = w.H; }
    else { sw = span; sh = span * (H / W); sx = p.x - sw / 2; sy = p.y - sh / 2; }
    const kx = W / sw, ky = H / sh;
    ctx.drawImage(this.base, sx, sy, sw, sh, 0, 0, W, H);
    const toX = (x) => (x - sx) * kx, toY = (y) => (y - sy) * ky;
    // structures
    for (const o of g.build.structures) {
      if (!o.fire && o.type !== 'bed' && o.type !== 'chest') continue;
      const X = toX(o.x), Y = toY(o.y);
      if (X < -4 || Y < -4 || X > W + 4 || Y > H + 4) continue;
      ctx.fillStyle = o.fire ? '#ffb040' : '#e8d0a0';
      ctx.fillRect(X - 2, Y - 2, 4, 4);
    }
    // creatures
    const dot = full ? 2 : 2.5;
    for (const e of g.entities) {
      if (e.kind !== 'animal' || e.dead) continue;
      const X = toX(e.x), Y = toY(e.y);
      if (X < 0 || Y < 0 || X > W || Y > H) continue;
      if (!full && Math.hypot(e.x - p.x, e.y - p.y) > 40) continue;
      ctx.fillStyle = TEMPER_COLOR[SPECIES[e.species].temper];
      ctx.beginPath(); ctx.arc(X, Y, e === p.target ? dot + 1.2 : dot * (e.elite ? 1.4 : 1), 0, Math.PI * 2); ctx.fill();
      if (e === p.target) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke(); }
    }
    // spawn camp marker
    {
      const X = toX(w.spawn.x), Y = toY(w.spawn.y);
      ctx.strokeStyle = 'rgba(230,226,216,0.7)'; ctx.lineWidth = 1;
      ctx.strokeRect(X - 2.5, Y - 2.5, 5, 5);
    }
    // player arrow
    const X = toX(p.x), Y = toY(p.y);
    const ang = { s: Math.PI / 2, n: -Math.PI / 2, e: 0, w: Math.PI }[p.facing] ?? 0;
    ctx.save();
    ctx.translate(X, Y); ctx.rotate(ang);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.2;
    const s = full ? 5 : 5.5;
    ctx.beginPath(); ctx.moveTo(s, 0); ctx.lineTo(-s * 0.7, s * 0.65); ctx.lineTo(-s * 0.35, 0); ctx.lineTo(-s * 0.7, -s * 0.65); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}
