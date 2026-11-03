// Camera rotation / 3D — the rowboat (game/boats.js; art/faces/solid.js kit, format at the top of that file).
// A real 3D object at every camera angle (0° too) built from the hull profile (game/content/boats.js): lapstrake sides
// that flare out above the waterline (outside: a teal top strake over tarred planks; inside: ribs), the gunwale caps,
// floor boards, a transom, the stem post, a little foredeck, four thwarts on posts (the fore bench, the oars, the aft
// bench, the stern seat: 6 places), the oarlocks — all with its own face art (uv: 'boat_uv', each face in true proportions, like the chest / ballista).
// The whole model turns (spin parts) to the boat's heading and moves with it (the kit's `move`: offset + bobbing /
// rocking each frame), so it is built once for every boat. drawBoat adds the darker water under the hull and the oars
// (thin bars + blades as faces, their stroke from the drawn speed: game/boats.js b._row / _rowK).
// Art numbers: x px from the centre (64 px = 1 tile, + = the hull's local +x), v = 0.5 + u (u tiles along the hull,
// + toward the bow), h px above the water.
//   lazy art: boat (a side view: build menu icon), boat_uv (the face art)
import { defineSolid, drawSolid } from './solid.js';
import { lazyDef } from '../lazyDefs.js';
import { spritePx, lin, rng, TAU } from '../paint.js';
import { CAMV, KIT_ENV, archSprite } from '../archCompose.js';
import { shade } from './kit.js';
import { BOAT, halfW, sheer, waterW, launchPose } from '../../game/content/boats.js';

// ---------------- palette ----------------
const W = { hi: '#d9a86c', light: '#bb8753', mid: '#94623a', dark: '#6a4224', deep: '#45280f', grain: 'rgba(60,34,14,0.36)' };
const I = { hi: '#e3bb83', light: '#c99c65', mid: '#a97b49', dark: '#7c5430', grain: 'rgba(80,46,18,0.3)' };
const P = { hi: '#79b6b9', light: '#4f8f95', mid: '#38707a', dark: '#24525b' };
const IRON = { hi: '#b9bfc8', light: '#858b95', mid: '#5c616a', dark: '#383b42' };

// ---------------- face art (uv rects, px; a 1 px empty border keeps the crop exact) ----------------
export const BOAT_UV = {
  hullS: [1, 1, 97, 21], hullI: [1, 23, 97, 43], floor: [1, 45, 97, 65],
  rail: [99, 1, 151, 7], seatT: [99, 9, 151, 19], seatS: [99, 21, 151, 27], end: [99, 29, 107, 35], stem: [109, 29, 117, 49],
  oar: [119, 29, 151, 33], blade: [119, 35, 151, 47], iron: [99, 37, 107, 45], deck: [99, 49, 151, 65],
};
const UW = 152, UH = 66;
function boatUV() {
  const U = BOAT_UV, rand = rng(5113);
  return spritePx(UW, UH, (g) => {
    const box = (r, stops, horiz) => { g.fillStyle = horiz ? lin(g, r[0], 0, r[2], 0, stops) : lin(g, 0, r[1], 0, r[3], stops); g.fillRect(r[0], r[1], r[2] - r[0], r[3] - r[1]); };
    const grain = (x0, y0, x1, y1, n, vert, col) => {
      g.strokeStyle = col; g.lineWidth = 0.6;
      for (let i = 0; i < n; i++) {
        g.beginPath();
        if (vert) { const x = x0 + 1 + rand() * (x1 - x0 - 2); g.moveTo(x, y0); g.bezierCurveTo(x + (rand() - 0.5) * 2, y0 + (y1 - y0) * 0.3, x + (rand() - 0.5) * 2, y0 + (y1 - y0) * 0.7, x + (rand() - 0.5) * 1.4, y1); }
        else { const y = y0 + 0.6 + rand() * (y1 - y0 - 1.2); g.moveTo(x0, y); g.bezierCurveTo(x0 + (x1 - x0) * 0.3, y + (rand() - 0.5) * 1.2, x0 + (x1 - x0) * 0.7, y + (rand() - 0.5) * 1.2, x1, y + (rand() - 0.5) * 0.8); }
        g.stroke();
      }
    };
    const line = (x0, y0, x1, y1, col, w = 1) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
    // ---- outside of the hull (rows: gunwale → waterline): the teal top strake, a pale rubbing strip, three
    // overlapping planks (each lap casts a thin shadow), copper nails, the tarred waterline ----
    {
      const r = U.hullS, x0 = r[0], x1 = r[2], y0 = r[1];
      g.fillStyle = lin(g, 0, y0, 0, y0 + 5, [[0, P.hi], [0.35, P.light], [1, P.mid]]); g.fillRect(x0, y0, x1 - x0, 5);
      g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x0, y0, x1 - x0, 0.8);
      for (let x = x0 + 3; x < x1; x += 7 + rand() * 6) { g.fillStyle = `rgba(30,60,64,${0.15 + rand() * 0.15})`; g.fillRect(x, y0 + 1 + rand() * 3, 2 + rand() * 4, 0.7); } // (worn paint)
      g.fillStyle = '#e6d9b8'; g.fillRect(x0, y0 + 5, x1 - x0, 1.3);
      line(x0, y0 + 6.6, x1, y0 + 6.6, 'rgba(40,22,8,0.75)', 0.8);
      const planks = [[6.6, 10.6, W.light], [10.6, 14.6, W.mid], [14.6, 18.4, W.dark]];
      for (const [a, b, c] of planks) {
        g.fillStyle = lin(g, 0, y0 + a, 0, y0 + b, [[0, c], [1, W.deep]]); g.globalAlpha = 1; g.fillRect(x0, y0 + a, x1 - x0, b - a);
        g.fillStyle = 'rgba(255,230,190,0.22)'; g.fillRect(x0, y0 + a + 0.3, x1 - x0, 0.8);
        grain(x0, y0 + a, x1, y0 + b, 3, false, W.grain);
        line(x0, y0 + b - 0.2, x1, y0 + b - 0.2, 'rgba(30,16,6,0.7)', 0.9);
        for (let x = x0 + 4; x < x1 - 1; x += 8) { g.fillStyle = '#c98a4e'; g.fillRect(x, y0 + b - 1.6, 1, 1); g.fillStyle = 'rgba(60,30,10,0.6)'; g.fillRect(x + 0.6, y0 + b - 1, 0.6, 0.6); }
      }
      g.fillStyle = lin(g, 0, y0 + 18.4, 0, y0 + 20, [[0, '#3a3a26'], [1, '#231a12']]); g.fillRect(x0, y0 + 18.4, x1 - x0, 1.6);
    }
    // ---- inside (rows: gunwale → the floor's edge): the inwale, lighter planks, ribs every 16 px ----
    {
      const r = U.hullI, x0 = r[0], x1 = r[2], y0 = r[1];
      g.fillStyle = lin(g, 0, y0, 0, y0 + 3, [[0, W.light], [1, W.dark]]); g.fillRect(x0, y0, x1 - x0, 3);
      const planks = [[3, 8.5], [8.5, 14], [14, 20]];
      for (const [a, b] of planks) {
        g.fillStyle = lin(g, 0, y0 + a, 0, y0 + b, [[0, I.light], [1, I.mid]]); g.fillRect(x0, y0 + a, x1 - x0, b - a);
        grain(x0, y0 + a, x1, y0 + b, 3, false, I.grain);
        line(x0, y0 + b, x1, y0 + b, 'rgba(70,40,14,0.55)', 0.8);
      }
      for (let x = x0 + 5; x < x1 - 2; x += 16) {
        g.fillStyle = lin(g, x, 0, x + 3.4, 0, [[0, W.light], [0.5, W.mid], [1, W.dark]]); g.fillRect(x, y0 + 2, 3.4, 18);
        g.fillStyle = 'rgba(255,235,200,0.3)'; g.fillRect(x, y0 + 2, 0.7, 18);
        g.fillStyle = 'rgba(30,16,6,0.35)'; g.fillRect(x + 3.4, y0 + 2, 0.8, 18);
      }
      g.fillStyle = 'rgba(40,24,10,0.25)'; g.fillRect(x0, y0 + 17, x1 - x0, 3); // (damp near the floor)
    }
    // ---- floor boards (columns across the hull, rows along it): five boards, dark seams, a little water ----
    {
      const r = U.floor, x0 = r[0], x1 = r[2], y0 = r[1], y1 = r[3], n = 5, bw = (x1 - x0) / n;
      for (let k = 0; k < n; k++) {
        const a = x0 + k * bw, c = k % 2 ? I.mid : I.light;
        g.fillStyle = lin(g, a, 0, a + bw, 0, [[0, c], [1, I.dark]]); g.fillRect(a, y0, bw, y1 - y0);
        grain(a, y0, a + bw, y1, 3, true, I.grain);
        line(a + bw - 0.4, y0, a + bw - 0.4, y1, 'rgba(40,22,8,0.7)', 0.8);
      }
      g.fillStyle = 'rgba(60,90,110,0.18)'; g.beginPath(); g.ellipse(x0 + 52, y0 + 12, 18, 5, 0, 0, TAU); g.fill(); // (a puddle)
      for (let y = y0 + 3; y < y1; y += 9) for (let k = 0; k < n; k++) { g.fillStyle = '#7a5838'; g.fillRect(x0 + k * bw + bw / 2 - 0.5, y, 1, 1); }
    }
    // ---- gunwale cap, thwarts (top: grain across; front), end grain, the stem, oars, iron, foredeck ----
    box(U.rail, [[0, W.hi], [1, W.light]]); grain(U.rail[0], U.rail[1], U.rail[2], U.rail[3], 2, false, W.grain);
    box(U.seatT, [[0, W.hi], [1, W.light]]); grain(U.seatT[0], U.seatT[1], U.seatT[2], U.seatT[3], 4, false, W.grain);
    line(U.seatT[0], U.seatT[1] + 5, U.seatT[2], U.seatT[1] + 5, 'rgba(60,34,14,0.4)', 0.6);
    box(U.seatS, [[0, W.light], [1, W.dark]]); grain(U.seatS[0], U.seatS[1], U.seatS[2], U.seatS[3], 2, false, W.grain);
    box(U.end, [[0, W.light], [1, W.dark]]);
    for (let k = 3; k > 0; k--) { g.strokeStyle = 'rgba(70,40,16,0.5)'; g.lineWidth = 0.5; g.beginPath(); g.ellipse(103, 32, k * 1.1, k * 0.9, 0, 0, TAU); g.stroke(); }
    box(U.stem, [[0, W.mid], [0.5, W.dark], [1, W.deep]], true); grain(U.stem[0], U.stem[1], U.stem[2], U.stem[3], 2, true, W.grain);
    box(U.oar, [[0, '#e4c08a'], [1, '#a77a46']]); grain(U.oar[0], U.oar[1], U.oar[2], U.oar[3], 1, false, W.grain);
    g.fillStyle = '#6f4a2a'; g.fillRect(U.oar[0], U.oar[1], 5, 4); // (the grip, worn dark)
    {
      const r = U.blade;
      box(r, [[0, '#d6b07a'], [1, '#9c6e3e']]); grain(r[0], r[1], r[2], r[3], 3, false, W.grain);
      g.fillStyle = lin(g, r[2] - 9, 0, r[2], 0, [[0, P.mid], [1, P.dark]]); g.fillRect(r[2] - 9, r[1], 9, r[3] - r[1]); // (painted tip)
      g.fillStyle = '#e6d9b8'; g.fillRect(r[2] - 10, r[1], 1, r[3] - r[1]);
    }
    box(U.iron, [[0, IRON.hi], [0.5, IRON.light], [1, IRON.dark]]);
    {
      const r = U.deck;
      box(r, [[0, W.hi], [1, W.light]]);
      for (let y = r[1] + 4; y < r[3]; y += 4) line(r[0], y, r[2], y, 'rgba(60,34,14,0.45)', 0.6);
      grain(r[0], r[1], r[2], r[3], 4, false, W.grain);
    }
  });
}

// ---------------- the side view (build menu icon, fallback until the model is ready) ----------------
function boatIcon() {
  return spritePx(132, 64, (g, Pn) => {
    const y = 40;
    // an oar behind the hull
    Pn.layer((g) => {
      g.strokeStyle = '#a77a46'; g.lineWidth = 3; g.beginPath(); g.moveTo(44, y - 18); g.lineTo(18, y + 16); g.stroke();
      g.fillStyle = '#9c6e3e'; g.beginPath(); g.moveTo(22, y + 8); g.lineTo(12, y + 22); g.lineTo(6, y + 19); g.lineTo(16, y + 6); g.closePath(); g.fill();
    }, 2.2);
    Pn.layer((g) => {
      // hull: a long curve, the bow up at the right
      const hull = () => { g.beginPath(); g.moveTo(10, y - 10); g.lineTo(104, y - 12); g.quadraticCurveTo(118, y - 16, 124, y - 22); g.quadraticCurveTo(120, y + 2, 98, y + 12); g.lineTo(26, y + 12); g.quadraticCurveTo(12, y + 8, 10, y - 10); g.closePath(); };
      hull(); g.fillStyle = lin(g, 0, y - 12, 0, y + 12, [[0, W.light], [0.6, W.mid], [1, W.deep]]); g.fill();
      g.save(); hull(); g.clip();
      g.fillStyle = lin(g, 0, y - 22, 0, y - 4, [[0, P.light], [1, P.mid]]); g.fillRect(0, y - 24, 132, 18);
      g.fillStyle = '#e6d9b8'; g.fillRect(0, y - 6, 132, 1.6);
      for (const d of [0, 6, 11]) { g.strokeStyle = 'rgba(30,16,6,0.6)'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, y - 1 + d); g.lineTo(132, y - 2 + d); g.stroke(); }
      g.fillStyle = '#2a2016'; g.fillRect(0, y + 9, 132, 4);
      g.restore();
      // gunwale, the stem post, a thwart seen end-on, the oarlock
      g.strokeStyle = W.hi; g.lineWidth = 2; g.beginPath(); g.moveTo(10, y - 10); g.lineTo(104, y - 12); g.quadraticCurveTo(118, y - 16, 124, y - 22); g.stroke();
      g.fillStyle = W.dark; g.fillRect(121, y - 28, 4, 8);
      g.fillStyle = IRON.mid; g.fillRect(52, y - 16, 4, 5);
    }, 2.4);
    // the near oar over the gunwale
    Pn.layer((g) => {
      g.strokeStyle = '#d2a86f'; g.lineWidth = 3; g.beginPath(); g.moveTo(66, y - 22); g.lineTo(96, y + 18); g.stroke();
      g.fillStyle = '#c69a62'; g.beginPath(); g.moveTo(90, y + 8); g.lineTo(102, y + 24); g.lineTo(108, y + 20); g.lineTo(96, y + 5); g.closePath(); g.fill();
      g.fillStyle = P.mid; g.beginPath(); g.moveTo(98, y + 16); g.lineTo(102, y + 24); g.lineTo(108, y + 20); g.lineTo(104, y + 13); g.closePath(); g.fill();
    }, 2.2);
  });
}

lazyDef('boat', boatIcon, 0.5, 52 / 64);
lazyDef('boat_uv', boatUV, 0, 0);

// ---------------- the model ----------------
const U = BOAT_UV, T = 0.045; // (side thickness at the gunwale, tiles)
const ST = [-1.9, -1.5, -0.9, -0.3, 0.3, 0.9, 1.35, 1.7, 1.95, 2.12]; // stations along the hull
const L0 = ST[0], LEN = ST[ST.length - 1] - L0;
const fr = (u) => (u - L0) / LEN;
const px = (s) => 64 * s, vv = (u) => 0.5 + u, hp = (h) => 64 * h;
const P3 = (s, u, h) => [px(s), vv(u), hp(h)];
const SP = { spin: true, sh: false };
// a part of rect r between fractions a..b of its columns (rev: reversed) / rows
const cols = (r, a, b, rev = false) => (rev ? [r[0] + (r[2] - r[0]) * b, r[1], r[0] + (r[2] - r[0]) * a, r[3]] : [r[0] + (r[2] - r[0]) * a, r[1], r[0] + (r[2] - r[0]) * b, r[3]]);
const rows = (r, a, b) => [r[0], r[1] + (r[3] - r[1]) * a, r[2], r[1] + (r[3] - r[1]) * b];
const floorW = (u) => waterW(u) - 0.03;
function hullParts() {
  const out = [];
  for (let i = 0; i + 1 < ST.length; i++) {
    const a = ST[i], b = ST[i + 1], fa = fr(a), fb = fr(b);
    const Wa = halfW(a), Wb = halfW(b), Ga = sheer(a), Gb = sheer(b), La = waterW(a), Lb = waterW(b), Fa = floorW(a), Fb = floorW(b), FH = BOAT.floorH;
    for (const sd of [1, -1]) {
      // outside (TL TR BR BL as seen from outside)
      const oq = sd > 0 ? [P3(Wb, b, Gb), P3(Wa, a, Ga), P3(La, a, 0), P3(Lb, b, 0)] : [P3(-Wa, a, Ga), P3(-Wb, b, Gb), P3(-Lb, b, 0), P3(-La, a, 0)];
      out.push({ quad: oq, uv: { q: cols(U.hullS, fa, fb, sd > 0) }, ...SP });
      // inside
      const iq = sd > 0 ? [P3(Wa - T, a, Ga), P3(Wb - T, b, Gb), P3(Fb, b, FH), P3(Fa, a, FH)] : [P3(-(Wb - T), b, Gb), P3(-(Wa - T), a, Ga), P3(-Fa, a, FH), P3(-Fb, b, FH)];
      out.push({ quad: iq, uv: { q: cols(U.hullI, fa, fb, sd < 0) }, ...SP });
      // the gunwale cap
      out.push({ quad: [P3(sd * Wa, a, Ga), P3(sd * Wb, b, Gb), P3(sd * (Wb - T), b, Gb), P3(sd * (Wa - T), a, Ga)], uv: { q: cols(U.rail, fa, fb) }, ...SP });
    }
    // the floor boards
    out.push({ quad: [P3(-Fa, a, FH), P3(Fa, a, FH), P3(Fb, b, FH), P3(-Fb, b, FH)], uv: { q: rows(U.floor, fa, fb) }, ...SP });
  }
  // the transom: outside (facing the stern), inside, its cap
  const s0 = ST[0], Ws = halfW(s0), Gs = sheer(s0), Ls = waterW(s0), Fs = floorW(s0), FH = BOAT.floorH;
  out.push({ quad: [P3(Ws, s0, Gs), P3(-Ws, s0, Gs), P3(-Ls, s0, 0), P3(Ls, s0, 0)], uv: { q: [1, 1, 49, 21] }, ...SP });
  out.push({ quad: [P3(-(Ws - T), s0 + T, Gs), P3(Ws - T, s0 + T, Gs), P3(Fs, s0 + T, FH), P3(-Fs, s0 + T, FH)], uv: { q: [1, 23, 49, 43] }, ...SP });
  out.push({ quad: [P3(-Ws, s0, Gs), P3(Ws, s0, Gs), P3(Ws - T, s0 + T, Gs), P3(-(Ws - T), s0 + T, Gs)], uv: { q: U.rail }, ...SP });
  // the foredeck: a little triangle of planks over the bow, and the stem post rising from it
  const fd = 1.62, Wd = halfW(fd) - T, Gd = sheer(fd) + 0.005, tip = 2.06, Gt = sheer(tip) + 0.005;
  out.push({ quad: [P3(-Wd, fd, Gd), P3(Wd, fd, Gd), P3(0.01, tip, Gt), P3(-0.01, tip, Gt)], uv: { q: U.deck }, ...SP });
  out.push({ box: [-2.4, 2.4, vv(2.02), vv(2.16), 0, hp(sheer(2.12) + 0.08)], uv: { s: U.stem, n: U.stem, e: U.stem, w: U.stem, t: U.end }, ...SP });
  // thwarts on their posts (two posts on the long ones): the fore bench, the oars', the aft bench, the stern seat
  const thwart = (u, d) => {
    const w = halfW(u) - T - 0.006, h0 = BOAT.seatH - 0.035, h1 = BOAT.seatH;
    out.push({ box: [-px(w), px(w), vv(u - d), vv(u + d), hp(h0), hp(h1)], uv: { s: U.seatS, n: U.seatS, e: U.end, w: U.end, t: U.seatT }, ...SP });
    for (const sx of w > 0.45 ? [-0.28, 0.28] : [0]) out.push({ box: [px(sx) - 2, px(sx) + 2, vv(u - 0.03), vv(u + 0.03), hp(FH), hp(h0)], uv: { s: U.stem, n: U.stem, e: U.stem, w: U.stem, t: U.end }, ...SP });
  };
  const PL = BOAT.places;
  thwart(PL[1][0], 0.1); thwart(PL[0][0], 0.085); thwart(PL[3][0], 0.1); thwart(PL[5][0], 0.12);
  // the oarlocks on the gunwale by the oars' thwart
  const uo = PL[0][0], wo = halfW(uo) - T / 2, go = sheer(uo);
  for (const sd of [1, -1]) out.push({ box: [px(sd * wo) - 1.4, px(sd * wo) + 1.4, vv(uo - 0.025), vv(uo + 0.025), hp(go), hp(go) + 4.2], uv: { s: U.iron, n: U.iron, e: U.iron, w: U.iron, t: U.iron }, ...SP });
  return out;
}

// the pose drawn: a boat (game/boats.js: the proxy carries it in _boat) or a boat blueprint / ghost (its launch pose)
const PI2 = Math.PI / 2;
function poseOf(o) {
  const b = o._boat;
  if (b) return PZ.set(b._x, b._y, b._h);
  const key = o.tx * 4096 + o.ty;
  if (o._lpk !== key) { o._lpk = key; o._lp = (KIT_ENV.game && launchPose(KIT_ENV.game, o.tx, o.ty)) || null; }
  const lp = o._lp;
  return lp ? PZ.set(lp[0], lp[1], lp[2]) : PZ.set(o.tx + 0.5, o.ty + 0.5, PI2);
}
const PZ = { x: 0, y: 0, h: 0, set(x, y, h) { this.x = x; this.y = y; this.h = h; return this; } };
const MV = [0, 0, 0, 0, 0];
defineSolid('boat', {
  ow: 0, uvS: 'boat_uv', align: false,
  spin: (o) => poseOf(o).h, spinAt: [0, 0.5, 0],
  // translation from the body centre (the tile's middle) to the pose, the bobbing and the rocking (a height gradient)
  move(o) {
    const q = poseOf(o), k = o._boat?._bob;
    MV[0] = q.x - (o.tx + 0.5); MV[1] = q.y - (o.ty + 0.5);
    if (k) {
      const c = Math.cos(q.h), n = Math.sin(q.h);
      MV[2] = k.base; MV[3] = k.pitch * c + k.roll * n; MV[4] = k.pitch * n - k.roll * c;
    } else MV[2] = MV[3] = MV[4] = 0;
    return MV;
  },
  parts: hullParts(),
  blob: false,
});

// ---------------- drawing a boat (game/boats.js collect: one drawable per boat) ----------------
const PROXY = { type: 'boat', tx: 0, ty: 0, x: 0.5, y: 1, cy: 0.6, rot: 0, face: 's', fw: 1, fh: 1, _boat: null }; // (one model for every boat)
export function drawBoat(B, A, b, t) {
  const S = archSprite(A, 'boat_uv');
  if (!archSprite(A, 'boat') || !S) return; // (painted on demand: a frame or two)
  const yaw = Math.atan2(CAMV.s, CAMV.c);
  // the water darkens under the hull
  const bl = A.has('fx_blob') ? A.get('fx_blob') : null;
  if (bl && B.blob) B.blob.add(bl, b._x, b._y, 4.6 / bl.w, 1.5 / bl.h, 1, 1, 1, 0.42, 0, b._h - yaw);
  // under a bridge (game/boats.js b._ub): the whole boat behind its deck, like the riders (the deck covers it as it passes)
  const F = B.faces, ob = F ? F.bias : 0;
  if (F && b._ub) F.bias = ob + UNDER;
  PROXY._boat = b;
  drawSolid(B, A, PROXY, t);
  PROXY._boat = null;
  if (F) { oars(F, S, b); F.bias = ob; }
}
const UNDER = -1.5; // (= game/boats.js UNDER: the riders' bias under a deck)

// ---- the oars: a thin bar from the handle through the oarlock out to the blade, as faces ----
const UVT = [0, 0, 0, 0];
function uvOf(S, r) {
  const du = (S.u1 - S.u0) / S.pw, dv = (S.v1 - S.v0) / S.ph;
  UVT[0] = S.u0 + du * (r[0] + 0.5); UVT[1] = S.v0 + dv * (r[1] + 0.5); UVT[2] = S.u0 + du * (r[2] - 0.5); UVT[3] = S.v0 + dv * (r[3] - 0.5);
  return UVT;
}
// world point of hull point (u, s, h) in the drawn pose, with the rocking: into out[o..o+2]
function at(b, u, s, h, out, o) {
  const c = Math.cos(b._h), n = Math.sin(b._h), k = b._bob;
  out[o] = b._x + u * c + s * n; out[o + 1] = b._y + u * n - s * c; out[o + 2] = h + (k ? k.base + k.roll * s + k.pitch * u : 0);
}
// one flat strip from p0 to p1 (hull space [u, s, h]), its width along e (a unit hull-space vector) — corners TL TR BR BL
const QV = new Float64Array(12);
function strip(F, S, r, b, p0, p1, e, w, lit) {
  at(b, p0[0] + e[0] * w, p0[1] + e[1] * w, p0[2] + e[2] * w, QV, 0); at(b, p1[0] + e[0] * w, p1[1] + e[1] * w, p1[2] + e[2] * w, QV, 3);
  at(b, p1[0] - e[0] * w, p1[1] - e[1] * w, p1[2] - e[2] * w, QV, 6); at(b, p0[0] - e[0] * w, p0[1] - e[1] * w, p0[2] - e[2] * w, QV, 9);
  F.quad(QV[0], QV[1], QV[2], QV[3], QV[4], QV[5], QV[6], QV[7], QV[8], QV[9], QV[10], QV[11], uvOf(S, r), lit, lit, lit, 1);
}
const PIV = [0, 0, 0], TIP = [0, 0, 0], HAND = [0, 0, 0], BL0 = [0, 0, 0], SIDE = [0, 0, 0], UP = [0, 0, 1], BE = [0, 0, 0];
function oars(F, S, b) {
  const uo = BOAT.places[0][0], k = b._rowK || 0, ph = (b._row || 0) % 1, manned = !!b.seats?.[0];
  // stroke: the catch (blade forward, dipping in), the drive (pulled back in the water), the recovery (lifted, forward)
  const drive = ph < 0.55, q = drive ? ph / 0.55 : (ph - 0.55) / 0.45;
  const swing = drive ? 0.62 - 1.24 * q : -0.62 + 1.24 * (q * q * (3 - 2 * q));
  const lift = drive ? 0 : 0.16 * Math.sin(q * Math.PI);
  const c = Math.cos(b._h), n = Math.sin(b._h);
  for (const sd of [1, -1]) {
    PIV[0] = uo; PIV[1] = sd * (halfW(uo) - 0.02); PIV[2] = sheer(uo) + 0.05;
    // nobody at the oars: shipped along the gunwale; someone, not rowing: blades resting on the water; rowing: the stroke
    // pulled in where the oar would go through a bank, a pier or under a bridge (game/boats.js b._oi, eased per side)
    let sw, tipH;
    if (!manned) { sw = -1.4; tipH = sheer(uo) + 0.06; }
    else { sw = -0.25 * (1 - k) + swing * k; tipH = 0.015 + lift * k + 0.02 * (1 - k); }
    const shp = manned ? (b._oi ? b._oi[sd > 0 ? 0 : 1] : 0) : 1;
    if (manned && shp > 0) { sw += (-1.4 - sw) * shp; tipH += (sheer(uo) + 0.06 - tipH) * shp; }
    const out = 1.4 + (1.15 - 1.4) * shp, inb = 0.55 + (0.22 - 0.55) * shp;
    const dh = tipH - PIV[2], hz = Math.sqrt(Math.max(0.05, out * out - dh * dh)) / out; // (horizontal share of its direction)
    const du = Math.sin(sw) * hz, ds = sd * Math.cos(sw) * hz, dz = dh / out;
    for (let j = 0; j < 3; j++) { const d = j === 0 ? du : j === 1 ? ds : dz; TIP[j] = PIV[j] + d * out; HAND[j] = PIV[j] - d * inb; BL0[j] = PIV[j] + d * (out - 0.4); }
    // the shaft: a flat strip and an upright one (a thin bar from every side), shaded by the side facing the light
    const hl = Math.hypot(du, ds) || 1;
    SIDE[0] = -ds / hl; SIDE[1] = du / hl; SIDE[2] = 0;
    const lit = shade(c * SIDE[0] + n * SIDE[1], n * SIDE[0] - c * SIDE[1]);
    strip(F, S, BOAT_UV.oar, b, HAND, BL0, SIDE, 0.022, 1);
    strip(F, S, BOAT_UV.oar, b, HAND, BL0, UP, 0.022, lit * 0.85);
    // the blade: upright in the water during the drive, feathered flat on the recovery / at rest
    const fe = (manned ? (drive ? 0.15 : 0.85) * k + 0.8 * (1 - k) : 1) * (1 - shp) + shp;
    BE[0] = SIDE[0] * fe; BE[1] = SIDE[1] * fe; BE[2] = 1 - fe;
    const el = Math.hypot(BE[0], BE[1], BE[2]) || 1; BE[0] /= el; BE[1] /= el; BE[2] /= el;
    strip(F, S, BOAT_UV.blade, b, BL0, TIP, BE, 0.085, 0.95);
  }
}
