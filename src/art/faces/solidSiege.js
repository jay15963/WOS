// Camera rotation / 3D — the siege engines (game/siege.js; art/faces/solid.js kit, format at the top of that file):
// the trebuchet ("Trabuco"), the catapult ("Catapulta"), the battering ram ("Aríete"), the siege tower ("Torre de
// cerco") and the Oficina de cerco. Real 3D objects at every camera angle (0° too), in the ballista's style: boxes with
// their own face art (uv: 'siege_uv', each face in true proportions: weathered beams, iron bands, rope, wet hides,
// planks, wheels, stone).
//   - what stays put is the kit's model (parts, built once per object: sun shadows, cracks, blueprint tint);
//   - what moves is drawn every frame as faces (B.faces, per-pixel depth like the rest): the trebuchet's whole turning
//     frame, its arm swinging over the axle, the counterweight, the sling and the stone; the catapult's frame turning on
//     its base and the arm snapping up against the padded bar; the ram's log swinging on its chains; the tower's ramp
//     dropping on the wall-walk; every wheel rolling while it is pushed (game/siege.js: o._aimD, o._reload, o._shotT,
//     o._swT, o._rampK, o._roll, the slide of a step).
// Local numbers here are TILES from the footprint's centre: x across, y toward the front (the way it faces / throws),
// h up (1 = a story). The kit's art numbers are made from them (px = 64 × tiles, v = y + 1 − D / 2: align false).
//   lazy art: <type> (front view: build-menu icon, fallback), siege_uv (the face art), item_treb_stone / item_cat_stone
//   (icons), proj_treb_stone / proj_cat_stone (the stones in flight)
import { defineSolid } from './solid.js';
import { lazyDef } from '../lazyDefs.js';
import { spritePx, lin, rng, circle, TAU } from '../paint.js';
import { CAMV, archSprite } from '../archCompose.js';
import { shade } from './kit.js';
import { ARTY } from '../../game/content/siege.js';
import { STORY_H } from '../../game/levels.js';

// ---------------- palette ----------------
const W = { hi: '#c99f6c', light: '#a9825a', mid: '#86633f', dark: '#5f432a', deep: '#3d2a18', grain: 'rgba(52,32,16,0.42)' };
const I = { hi: '#c4cad3', light: '#8d939d', mid: '#61666f', dark: '#3c3f46', deep: '#24262b' };
const R = { hi: '#e7d39c', light: '#cdb277', mid: '#a88d55', dark: '#6f5a30' };
const L = { hi: '#b98552', light: '#9a6a3f', mid: '#7a4f2d', dark: '#55341c', deep: '#36200f' };
const ST = { hi: '#cfc9bc', light: '#aca598', mid: '#878074', dark: '#5f5950', deep: '#3e3a34' };

// ---------------- face art (uv rects, px; content from (1, 1): the crop keeps the rects exact) ----------------
export const SIEGE_UV = {
  beamS: [1, 1, 49, 9], beamT: [1, 11, 49, 19], end: [51, 1, 59, 9], dark: [51, 11, 59, 19], iron: [61, 1, 77, 9], ironT: [61, 11, 77, 19],
  rope: [79, 1, 91, 25], post: [93, 1, 105, 25], plank: [107, 1, 155, 33], hide: [157, 1, 191, 33],
  railS: [1, 21, 49, 29], railT: [1, 31, 49, 39], stone: [51, 27, 91, 47], floor: [93, 35, 155, 59], shingle: [157, 35, 191, 59],
  wheelR: [1, 41, 49, 49], wheelF: [1, 51, 41, 91], ladder: [43, 51, 63, 91], ramS: [65, 61, 113, 69], ramE: [115, 61, 123, 69],
  ramH: [125, 61, 141, 77], cup: [143, 61, 159, 73], chain: [161, 61, 173, 93], boulder: [65, 71, 113, 93], ironD: [175, 61, 191, 77],
};
const UW = 192, UH = 96;
function siegeUV() {
  const U = SIEGE_UV, rand = rng(4417);
  return spritePx(UW, UH, (g) => {
    const box = (r, stops, horiz) => { g.fillStyle = horiz ? lin(g, r[0], 0, r[2], 0, stops) : lin(g, 0, r[1], 0, r[3], stops); g.fillRect(r[0], r[1], r[2] - r[0], r[3] - r[1]); };
    const edge = (r, a = 0.75) => { g.strokeStyle = `rgba(26,14,5,${a})`; g.lineWidth = 1; g.strokeRect(r[0] + 0.5, r[1] + 0.5, r[2] - r[0] - 1, r[3] - r[1] - 1); };
    const grain = (r, n, vert = false, col = W.grain) => {
      g.strokeStyle = col; g.lineWidth = 0.7;
      for (let i = 0; i < n; i++) {
        g.beginPath();
        if (vert) { const x = r[0] + 1 + rand() * (r[2] - r[0] - 2); g.moveTo(x, r[1]); g.bezierCurveTo(x + (rand() - 0.5) * 2, r[1] + (r[3] - r[1]) * 0.3, x + (rand() - 0.5) * 2, r[1] + (r[3] - r[1]) * 0.7, x + (rand() - 0.5) * 1.5, r[3]); }
        else { const y = r[1] + 1 + rand() * (r[3] - r[1] - 2); g.moveTo(r[0], y); g.bezierCurveTo(r[0] + (r[2] - r[0]) * 0.3, y + (rand() - 0.5) * 1.6, r[0] + (r[2] - r[0]) * 0.7, y + (rand() - 0.5) * 1.6, r[2], y + (rand() - 0.5)); }
        g.stroke();
      }
    };
    const knots = (r, n) => { for (let i = 0; i < n; i++) { g.fillStyle = 'rgba(48,28,10,0.5)'; g.beginPath(); g.ellipse(r[0] + 3 + rand() * (r[2] - r[0] - 6), r[1] + 2 + rand() * (r[3] - r[1] - 4), 1.3, 0.8, 0, 0, TAU); g.fill(); } };
    const band = (x, r, w = 3) => { g.fillStyle = I.mid; g.fillRect(x, r[1], w, r[3] - r[1]); g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x, r[1], 0.8, r[3] - r[1]); g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + w - 0.7, r[1], 0.7, r[3] - r[1]); g.fillStyle = I.hi; g.fillRect(x + w / 2 - 0.5, r[1] + 1, 1, 1); g.fillRect(x + w / 2 - 0.5, r[3] - 2, 1, 1); };
    const rivets = (r, step) => { for (let x = r[0] + 2; x < r[2] - 1; x += step) for (const y of [r[1] + 1.8, r[3] - 2.4]) { g.fillStyle = I.deep; g.beginPath(); circle(g, x + 0.3, y + 0.3, 0.8); g.fill(); g.fillStyle = I.hi; g.beginPath(); circle(g, x, y, 0.55); g.fill(); } };
    const nails = (x0, y0, x1, y1, n) => { for (let i = 0; i < n; i++) { const x = x0 + (x1 - x0) * (i + 0.5) / n, y = y0 + (y1 - y0) * (i + 0.5) / n; g.fillStyle = I.deep; g.fillRect(x - 0.6, y - 0.6, 1.3, 1.3); g.fillStyle = I.hi; g.fillRect(x - 0.5, y - 0.5, 0.6, 0.6); } };
    // beams (side: grain, a lit upper edge; top: lighter; end grain: rings) — weathered, a little greyer than the ballista
    box(U.beamS, [[0, W.light], [0.5, W.mid], [1, W.dark]]); grain(U.beamS, 5); knots(U.beamS, 2);
    g.fillStyle = 'rgba(255,236,200,0.28)'; g.fillRect(U.beamS[0], U.beamS[1], 48, 1); edge(U.beamS);
    box(U.beamT, [[0, W.hi], [1, W.light]]); grain(U.beamT, 5); edge(U.beamT, 0.5);
    box(U.end, [[0, W.light], [1, W.dark]]);
    for (let k = 3; k > 0; k--) { g.strokeStyle = 'rgba(70,40,16,0.55)'; g.lineWidth = 0.6; g.beginPath(); g.ellipse(55, 5, k * 1.2, k * 1.1, 0, 0, TAU); g.stroke(); }
    edge(U.end);
    box(U.dark, [[0, W.dark], [1, W.deep]]); edge(U.dark, 0.9);
    box(U.iron, [[0, I.light], [0.45, I.mid], [1, I.dark]]); rivets(U.iron, 5); edge(U.iron, 0.9);
    box(U.ironT, [[0, I.hi], [1, I.light]]); rivets(U.ironT, 5); edge(U.ironT, 0.8);
    box(U.ironD, [[0, I.mid], [0.5, I.dark], [1, I.deep]]); rivets(U.ironD, 6); edge(U.ironD, 0.9);
    // rope: twisted strands running up, bound at the ends
    box(U.rope, [[0, R.light], [0.5, R.mid], [1, R.dark]], true);
    g.strokeStyle = 'rgba(80,60,26,0.6)'; g.lineWidth = 0.9;
    for (let y = U.rope[1] - 2; y < U.rope[3] + 2; y += 2.2) { g.beginPath(); g.moveTo(U.rope[0], y); g.lineTo(U.rope[2], y + 3); g.stroke(); }
    g.strokeStyle = 'rgba(255,240,200,0.35)'; g.lineWidth = 0.5;
    for (let y = U.rope[1] - 1; y < U.rope[3] + 2; y += 2.2) { g.beginPath(); g.moveTo(U.rope[0] + 2, y); g.lineTo(U.rope[2] - 3, y + 2.2); g.stroke(); }
    edge(U.rope, 0.5);
    // posts (vertical grain)
    box(U.post, [[0, W.light], [0.5, W.mid], [1, W.dark]], true); grain(U.post, 4, true); edge(U.post);
    // plank wall: vertical boards with dark gaps, a batten across and nails
    box(U.plank, [[0, W.light], [1, W.mid]]);
    for (let x = U.plank[0]; x < U.plank[2]; x += 8) {
      const t = rand();
      g.fillStyle = t < 0.33 ? 'rgba(255,230,190,0.08)' : t < 0.66 ? 'rgba(40,20,8,0.1)' : 'rgba(0,0,0,0)'; g.fillRect(x, U.plank[1], 8, 32);
      g.fillStyle = W.deep; g.fillRect(x + 7.2, U.plank[1], 0.9, 32);
      grain([x, U.plank[1], x + 7, U.plank[3]], 2, true);
    }
    for (const y of [U.plank[1] + 4, U.plank[3] - 8]) { g.fillStyle = lin(g, 0, y, 0, y + 4, [[0, W.light], [1, W.dark]]); g.fillRect(U.plank[0], y, 48, 4); g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(U.plank[0], y + 4, 48, 0.8); nails(U.plank[0] + 2, y + 2, U.plank[2] - 2, y + 2, 6); }
    edge(U.plank, 0.6);
    // wet hides: stitched leather panels, darker blotches (against fire)
    box(U.hide, [[0, L.light], [0.6, L.mid], [1, L.dark]]);
    for (let i = 0; i < 9; i++) { g.fillStyle = `rgba(${40 + rand() * 30},${22 + rand() * 14},10,${0.12 + rand() * 0.14})`; g.beginPath(); g.ellipse(U.hide[0] + 2 + rand() * 30, U.hide[1] + 2 + rand() * 28, 2 + rand() * 4, 1.5 + rand() * 3, rand() * 3, 0, TAU); g.fill(); }
    g.strokeStyle = 'rgba(30,16,6,0.6)'; g.lineWidth = 0.8;
    for (const x of [U.hide[0] + 11, U.hide[0] + 23]) { g.beginPath(); g.moveTo(x, U.hide[1]); g.lineTo(x + 1, U.hide[3]); g.stroke(); for (let y = U.hide[1] + 2; y < U.hide[3]; y += 3) { g.beginPath(); g.moveTo(x - 1.2, y); g.lineTo(x + 2, y + 1); g.stroke(); } }
    g.strokeStyle = 'rgba(255,220,170,0.18)'; g.lineWidth = 0.6; for (let i = 0; i < 6; i++) { const y = U.hide[1] + 3 + rand() * 26; g.beginPath(); g.moveTo(U.hide[0], y); g.lineTo(U.hide[2], y + (rand() - 0.5) * 3); g.stroke(); }
    edge(U.hide, 0.5);
    // the arm / stock: side with iron bands, top
    box(U.railS, [[0, W.hi], [0.5, W.light], [1, W.mid]]); grain(U.railS, 4); band(U.railS[0] + 5, U.railS); band(U.railS[0] + 22, U.railS); band(U.railS[0] + 40, U.railS); edge(U.railS);
    box(U.railT, [[0, W.hi], [1, W.light]]); grain(U.railT, 3); band(U.railT[0] + 5, U.railT); band(U.railT[0] + 22, U.railT); band(U.railT[0] + 40, U.railT); edge(U.railT, 0.5);
    // stone blocks (the counterweight box, the base)
    box(U.stone, [[0, ST.light], [1, ST.mid]]);
    for (let y = U.stone[1], row = 0; y < U.stone[3]; y += 6.6, row++) {
      g.fillStyle = 'rgba(40,36,30,0.55)'; g.fillRect(U.stone[0], y, 40, 0.9);
      for (let x = U.stone[0] + (row & 1 ? 5 : 0); x < U.stone[2]; x += 10) { g.fillRect(x, y, 0.9, 6.6); g.fillStyle = `rgba(255,255,255,${0.05 + rand() * 0.1})`; g.fillRect(x + 1, y + 1, 8, 1); g.fillStyle = 'rgba(40,36,30,0.55)'; }
    }
    edge(U.stone, 0.7);
    // deck / floor planks (across), with dark joints and nails
    box(U.floor, [[0, W.hi], [1, W.light]]);
    for (let y = U.floor[1]; y < U.floor[3]; y += 6) { g.fillStyle = W.dark; g.fillRect(U.floor[0], y + 5.2, 62, 0.8); grain([U.floor[0], y, U.floor[2], y + 5], 2); nails(U.floor[0] + 3, y + 2.5, U.floor[0] + 3, y + 2.5, 1); nails(U.floor[2] - 4, y + 2.5, U.floor[2] - 4, y + 2.5, 1); }
    edge(U.floor, 0.5);
    // roof hides (darker, smoke-stained, laced over battens)
    box(U.shingle, [[0, L.mid], [1, L.deep]]);
    for (let y = U.shingle[1] + 5; y < U.shingle[3]; y += 7) { g.fillStyle = 'rgba(20,10,4,0.5)'; g.fillRect(U.shingle[0], y, 34, 1.2); g.fillStyle = 'rgba(255,220,170,0.14)'; g.fillRect(U.shingle[0], y - 1.2, 34, 0.8); }
    for (let i = 0; i < 6; i++) { g.fillStyle = `rgba(20,10,4,${0.1 + rand() * 0.12})`; g.beginPath(); g.ellipse(U.shingle[0] + 3 + rand() * 28, U.shingle[1] + 3 + rand() * 18, 3, 2, 0, 0, TAU); g.fill(); }
    edge(U.shingle, 0.5);
    // wheel tread: an iron tyre with bolts over the felloe
    box(U.wheelR, [[0, I.light], [0.4, I.mid], [1, I.dark]]); rivets(U.wheelR, 6); edge(U.wheelR, 0.9);
    // wheel face: felloe, six spokes, hub
    {
      const r = U.wheelF, cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2, R0 = (r[2] - r[0]) / 2 - 0.5;
      g.fillStyle = W.dark; g.fillRect(r[0], r[1], r[2] - r[0], r[3] - r[1]);
      g.fillStyle = I.dark; g.beginPath(); circle(g, cx, cy, R0); g.fill();
      g.fillStyle = lin(g, r[0], r[1], r[2], r[3], [[0, W.light], [1, W.mid]]); g.beginPath(); circle(g, cx, cy, R0 - 2.2); g.fill();
      g.fillStyle = W.deep; g.beginPath(); circle(g, cx, cy, R0 - 6.5); g.fill();
      for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; g.save(); g.translate(cx, cy); g.rotate(a); g.fillStyle = lin(g, 0, -2, 0, 2, [[0, W.hi], [1, W.mid]]); g.fillRect(0, -1.8, R0 - 5, 3.6); g.restore(); }
      g.fillStyle = lin(g, cx - 5, cy - 5, cx + 5, cy + 5, [[0, I.hi], [1, I.dark]]); g.beginPath(); circle(g, cx, cy, 5); g.fill();
      g.fillStyle = I.deep; g.beginPath(); circle(g, cx, cy, 1.8); g.fill();
      for (let k = 0; k < 10; k++) { const a = (k / 10) * TAU; g.fillStyle = I.hi; g.fillRect(cx + Math.cos(a) * (R0 - 1.2) - 0.5, cy + Math.sin(a) * (R0 - 1.2) - 0.5, 1, 1); }
    }
    // ladder: two rails, rungs
    box(U.ladder, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0)']]);
    g.fillStyle = W.deep; g.fillRect(U.ladder[0], U.ladder[1], 20, 40);
    g.fillStyle = lin(g, U.ladder[0], 0, U.ladder[0] + 4, 0, [[0, W.hi], [1, W.mid]]); g.fillRect(U.ladder[0], U.ladder[1], 4, 40);
    g.fillStyle = lin(g, U.ladder[2] - 4, 0, U.ladder[2], 0, [[0, W.hi], [1, W.mid]]); g.fillRect(U.ladder[2] - 4, U.ladder[1], 4, 40);
    for (let y = U.ladder[1] + 3; y < U.ladder[3] - 1; y += 6) { g.fillStyle = lin(g, 0, y, 0, y + 2.4, [[0, W.hi], [1, W.dark]]); g.fillRect(U.ladder[0] + 3, y, 14, 2.4); }
    // the ram's log: bark, end rings, the iron head
    box(U.ramS, [[0, '#8a6a46'], [0.5, '#6d5034'], [1, '#4a3420']]);
    for (let i = 0; i < 18; i++) { g.strokeStyle = `rgba(30,18,8,${0.3 + rand() * 0.3})`; g.lineWidth = 0.7; const x = U.ramS[0] + rand() * 48; g.beginPath(); g.moveTo(x, U.ramS[1]); g.lineTo(x + (rand() - 0.5) * 6, U.ramS[3]); g.stroke(); }
    band(U.ramS[0] + 8, U.ramS, 3); band(U.ramS[0] + 28, U.ramS, 3); edge(U.ramS, 0.7);
    box(U.ramE, [[0, '#b08a5c'], [1, '#7a5a38']]); for (let k = 3; k > 0; k--) { g.strokeStyle = 'rgba(70,40,16,0.55)'; g.lineWidth = 0.5; g.beginPath(); g.ellipse(119, 65, k * 1.1, k * 1.1, 0, 0, TAU); g.stroke(); } edge(U.ramE);
    box(U.ramH, [[0, I.mid], [0.5, I.dark], [1, I.deep]]); rivets(U.ramH, 4);
    g.strokeStyle = 'rgba(200,205,215,0.4)'; g.lineWidth = 0.8; g.beginPath(); g.moveTo(U.ramH[0] + 2, U.ramH[1] + 4); g.quadraticCurveTo(U.ramH[0] + 8, U.ramH[1] + 1, U.ramH[2] - 2, U.ramH[1] + 5); g.stroke(); edge(U.ramH, 0.9);
    // the leather cup / sling pouch
    box(U.cup, [[0, L.hi], [0.6, L.mid], [1, L.dark]]); g.strokeStyle = 'rgba(30,16,6,0.6)'; g.lineWidth = 0.7; for (let x = U.cup[0] + 2; x < U.cup[2]; x += 3) { g.beginPath(); g.moveTo(x, U.cup[1] + 1); g.lineTo(x, U.cup[1] + 2.5); g.stroke(); } edge(U.cup, 0.6);
    // chain links
    g.fillStyle = W.deep; g.fillRect(U.chain[0], U.chain[1], 12, 32);
    for (let y = U.chain[1]; y < U.chain[3]; y += 5) { g.strokeStyle = I.light; g.lineWidth = 1.4; g.beginPath(); g.ellipse(U.chain[0] + 6, y + 2.5, 2.4, 3, 0, 0, TAU); g.stroke(); g.strokeStyle = I.deep; g.lineWidth = 0.6; g.beginPath(); g.ellipse(U.chain[0] + 6, y + 2.5, 1.2, 2, 0, 0, TAU); g.stroke(); }
    // rough boulder (the stones)
    box(U.boulder, [[0, ST.hi], [0.5, ST.light], [1, ST.dark]]);
    for (let i = 0; i < 14; i++) { g.fillStyle = `rgba(${rand() < 0.5 ? '40,36,30' : '255,250,240'},${0.08 + rand() * 0.14})`; g.beginPath(); g.ellipse(U.boulder[0] + rand() * 48, U.boulder[1] + rand() * 22, 1.5 + rand() * 4, 1 + rand() * 3, rand() * 3, 0, TAU); g.fill(); }
    g.strokeStyle = 'rgba(40,36,30,0.5)'; g.lineWidth = 0.6; for (let i = 0; i < 5; i++) { g.beginPath(); const x = U.boulder[0] + rand() * 48, y = U.boulder[1] + rand() * 22; g.moveTo(x, y); g.lineTo(x + (rand() - 0.5) * 9, y + (rand() - 0.5) * 6); g.stroke(); }
  });
}

// ---------------- front views (build-menu icons; the model's fallback until the face art is painted) ----------------
const wood = (g, x0, y0, x1, y1, horiz = false) => { g.fillStyle = horiz ? lin(g, x0, 0, x1, 0, [[0, W.hi], [1, W.dark]]) : lin(g, 0, y0, 0, y1, [[0, W.hi], [1, W.dark]]); g.fillRect(x0, y0, x1 - x0, y1 - y0); };
const beamTo = (g, x0, y0, x1, y1, w, c0 = W.light, c1 = W.dark) => { const a = Math.atan2(y1 - y0, x1 - x0), L2 = Math.hypot(x1 - x0, y1 - y0); g.save(); g.translate(x0, y0); g.rotate(a); g.fillStyle = lin(g, 0, -w / 2, 0, w / 2, [[0, c0], [1, c1]]); g.fillRect(0, -w / 2, L2, w); g.restore(); };
const wheelIcon = (g, x, y, r) => { g.fillStyle = I.dark; g.beginPath(); circle(g, x, y, r); g.fill(); g.fillStyle = W.mid; g.beginPath(); circle(g, x, y, r - 2); g.fill(); g.strokeStyle = W.hi; g.lineWidth = 1.6; for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * (r - 2), y + Math.sin(a) * (r - 2)); g.stroke(); } g.fillStyle = I.light; g.beginPath(); circle(g, x, y, 2.4); g.fill(); };
function trebIcon() {
  return spritePx(128, 120, (g, P) => {
    const gy = 112;
    P.layer((g) => { wood(g, 8, gy - 8, 120, gy); g.fillStyle = I.mid; g.fillRect(56, gy - 10, 16, 3); }, 2.6);
    P.layer((g) => { beamTo(g, 30, gy - 6, 62, gy - 70, 7); beamTo(g, 98, gy - 6, 66, gy - 70, 7); wood(g, 40, gy - 38, 88, gy - 33); g.fillStyle = I.dark; g.fillRect(58, gy - 74, 12, 8); }, 2.6);
    P.layer((g) => {
      beamTo(g, 64, gy - 70, 112, gy - 104, 6, W.hi, W.mid); beamTo(g, 64, gy - 70, 44, gy - 58, 7, W.hi, W.mid);
      g.fillStyle = lin(g, 0, gy - 58, 0, gy - 30, [[0, ST.light], [1, ST.dark]]); g.fillRect(30, gy - 56, 26, 24); g.fillStyle = W.dark; g.fillRect(30, gy - 56, 26, 3); g.fillRect(30, gy - 35, 26, 3);
      g.strokeStyle = R.mid; g.lineWidth = 1.4; g.beginPath(); g.moveTo(112, gy - 104); g.quadraticCurveTo(122, gy - 92, 116, gy - 80); g.stroke();
      g.fillStyle = ST.light; g.beginPath(); circle(g, 116, gy - 78, 4.5); g.fill();
    }, 2.6);
  });
}
function catIcon() {
  return spritePx(104, 84, (g, P) => {
    const gy = 78;
    P.layer((g) => { wood(g, 10, gy - 12, 94, gy - 4); wheelIcon(g, 24, gy - 6, 6); wheelIcon(g, 80, gy - 6, 6); }, 2.6);
    P.layer((g) => { wood(g, 54, gy - 50, 60, gy - 10, true); wood(g, 44, gy - 52, 70, gy - 45); g.fillStyle = L.mid; g.fillRect(44, gy - 54, 26, 4); g.fillStyle = R.mid; g.fillRect(34, gy - 20, 36, 8); }, 2.6);
    P.layer((g) => { beamTo(g, 40, gy - 16, 62, gy - 60, 6, W.hi, W.mid); g.fillStyle = L.mid; g.beginPath(); g.ellipse(64, gy - 63, 7, 4, -0.5, 0, TAU); g.fill(); g.fillStyle = ST.light; g.beginPath(); circle(g, 64, gy - 66, 4); g.fill(); }, 2.6);
  });
}
function ramIcon() {
  return spritePx(132, 92, (g, P) => {
    const gy = 86;
    P.layer((g) => { wood(g, 10, gy - 22, 122, gy - 14); for (const x of [30, 102]) wheelIcon(g, x, gy - 10, 10); }, 2.6);
    P.layer((g) => {
      for (const x of [16, 64, 114]) wood(g, x - 3, gy - 64, x + 3, gy - 22, true);
      g.fillStyle = lin(g, 0, gy - 80, 0, gy - 58, [[0, L.light], [1, L.dark]]); g.beginPath(); g.moveTo(6, gy - 58); g.lineTo(66, gy - 82); g.lineTo(126, gy - 58); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(30,16,6,0.6)'; g.lineWidth = 1; for (let x = 20; x < 120; x += 14) { g.beginPath(); g.moveTo(x, gy - 62); g.lineTo(x + 4, gy - 74); g.stroke(); }
    }, 2.6);
    P.layer((g) => { wood(g, 4, gy - 44, 116, gy - 34); g.fillStyle = lin(g, 0, gy - 48, 0, gy - 30, [[0, I.light], [1, I.deep]]); g.fillRect(112, gy - 47, 16, 16); g.strokeStyle = I.mid; g.lineWidth = 2; g.beginPath(); g.arc(122, gy - 50, 5, Math.PI, TAU); g.stroke(); g.strokeStyle = I.light; g.lineWidth = 1; g.beginPath(); g.moveTo(40, gy - 64); g.lineTo(40, gy - 44); g.moveTo(88, gy - 64); g.lineTo(88, gy - 44); g.stroke(); }, 2.6);
  });
}
function towerIcon() {
  return spritePx(96, 150, (g, P) => {
    const gy = 144;
    P.layer((g) => { wood(g, 12, gy - 18, 84, gy - 10); wheelIcon(g, 22, gy - 9, 9); wheelIcon(g, 74, gy - 9, 9); }, 2.6);
    P.layer((g) => {
      g.fillStyle = lin(g, 0, gy - 128, 0, gy - 18, [[0, W.light], [1, W.dark]]); g.fillRect(16, gy - 126, 64, 108);
      g.strokeStyle = W.deep; g.lineWidth = 1; for (let x = 22; x < 80; x += 8) { g.beginPath(); g.moveTo(x, gy - 126); g.lineTo(x, gy - 18); g.stroke(); }
      for (const y of [gy - 90, gy - 54]) wood(g, 12, y - 3, 84, y + 3);
      g.fillStyle = L.mid; g.fillRect(16, gy - 60, 64, 30); g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(16, gy - 60, 64, 3);
      wood(g, 12, gy - 130, 18, gy - 18, true); wood(g, 78, gy - 130, 84, gy - 18, true);
      for (const x of [14, 34, 54, 74]) wood(g, x, gy - 142, x + 8, gy - 128);
      wood(g, 22, gy - 124, 74, gy - 98); g.strokeStyle = W.deep; g.lineWidth = 1; for (let y = gy - 120; y < gy - 98; y += 5) { g.beginPath(); g.moveTo(22, y); g.lineTo(74, y); g.stroke(); }
    }, 2.6);
  });
}
function shopIcon() {
  return spritePx(140, 96, (g, P) => {
    const gy = 90;
    P.layer((g) => { for (const x of [14, 50]) wood(g, x - 3, gy - 26, x + 3, gy, true); wood(g, 6, gy - 30, 62, gy - 24); for (let k = 0; k < 3; k++) wood(g, 76, gy - 8 - k * 7, 132, gy - 2 - k * 7); }, 2.6);
    P.layer((g) => { wood(g, 96, gy - 70, 101, gy - 24, true); wood(g, 126, gy - 70, 131, gy - 24, true); wood(g, 92, gy - 74, 135, gy - 68); g.strokeStyle = R.mid; g.lineWidth = 1.4; g.beginPath(); g.moveTo(113, gy - 68); g.lineTo(113, gy - 46); g.stroke(); g.fillStyle = I.mid; g.fillRect(110, gy - 48, 7, 6); wheelIcon(g, 70, gy - 22, 18); }, 2.6);
    P.layer((g) => { g.fillStyle = lin(g, 0, gy - 44, 0, gy - 34, [[0, '#8a6a46'], [1, '#4a3420']]); g.fillRect(10, gy - 44, 50, 10); g.fillStyle = I.light; g.fillRect(28, gy - 52, 3, 10); g.fillStyle = W.mid; g.fillRect(24, gy - 56, 11, 5); }, 2.6);
  });
}
// the stones: icons and in flight
function stoneShape(g, cx, cy, r, s = 1) {
  g.fillStyle = lin(g, cx - r, cy - r, cx + r, cy + r, [[0, ST.hi], [0.55, ST.light], [1, ST.dark]]);
  g.beginPath(); for (let k = 0; k < 9; k++) { const a = (k / 9) * TAU, rr = r * (0.88 + 0.12 * Math.sin(k * 2.7)); k ? g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr) : g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } g.closePath(); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.ellipse(cx - r * 0.3, cy - r * 0.35, r * 0.35, r * 0.22, -0.5, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(40,36,30,0.45)'; g.lineWidth = 0.8 * s; g.beginPath(); g.moveTo(cx - r * 0.2, cy + r * 0.1); g.lineTo(cx + r * 0.35, cy + r * 0.3); g.stroke();
}
const stoneIcon = (big) => () => spritePx(48, 48, (g, P) => P.layer((g) => { if (big) stoneShape(g, 24, 25, 18); else { stoneShape(g, 17, 28, 11); stoneShape(g, 31, 22, 11); } }, 2.2));
const stoneProj = (r) => () => spritePx(r * 2 + 8, r * 2 + 8, (g, P) => P.layer((g) => stoneShape(g, r + 4, r + 4, r), 1.6));

lazyDef('siege_uv', siegeUV, 0, 0);
lazyDef('trebuchet', trebIcon, 0.5, 112 / 120);
lazyDef('catapult', catIcon, 0.5, 78 / 84);
lazyDef('battering_ram', ramIcon, 0.5, 86 / 92);
lazyDef('siege_tower', towerIcon, 0.5, 144 / 150);
lazyDef('siege_workshop', shopIcon, 0.5, 90 / 96);
lazyDef('item_treb_stone', stoneIcon(true), 0.5, 0.5);
lazyDef('item_cat_stone', stoneIcon(false), 0.5, 0.5);
lazyDef('proj_treb_stone', stoneProj(13), 0.5, 0.5);
lazyDef('proj_cat_stone', stoneProj(8), 0.5, 0.5);

// ---------------- the per-frame rig: oriented boxes, wheels, balls, ropes as faces in a model frame ----------------
const U = SIEGE_UV;
const RG = { F: null, S: null, ox: 0, oy: 0, c: 1, s: 0, h0: 0, tr: 1, tg: 1, tb: 1, a: 1 };
const UVT = [0, 0, 0, 0];
function uvOf(r) {
  const S = RG.S, du = (S.u1 - S.u0) / S.pw, dv = (S.v1 - S.v0) / S.ph;
  UVT[0] = S.u0 + du * (r[0] + 0.5); UVT[1] = S.v0 + dv * (r[1] + 0.5); UVT[2] = S.u0 + du * (r[2] - 0.5); UVT[3] = S.v0 + dv * (r[3] - 0.5);
  return UVT;
}
// start drawing in a frame: origin (ox, oy) world, θ = the angle local +x is turned by (local +y = the front), h0 lift
function rig(B, A, FS, ox, oy, th, h0) {
  const S = RG.S = archSprite(A, 'siege_uv');
  RG.F = B.faces;
  if (!RG.F || !S) return false;
  RG.ox = ox; RG.oy = oy; RG.c = Math.cos(th); RG.s = Math.sin(th); RG.h0 = h0;
  RG.tr = FS ? FS.tr : 1; RG.tg = FS ? FS.tg : 1; RG.tb = FS ? FS.tb : 1; RG.a = FS ? FS.a : 1;
  return true;
}
const WX = (x, y) => RG.ox + RG.c * x - RG.s * y, WY = (x, y) => RG.oy + RG.s * x + RG.c * y;
// shade a face of local normal (nx, ny, nh): culled when it looks away (false), else the light on it
function lightOf(nx, ny, nh) {
  const wx = RG.c * nx - RG.s * ny, wy = RG.s * nx + RG.c * ny;
  if (-CAMV.s * wx + CAMV.c * wy + nh <= 0.005) return 0;
  const hz = Math.hypot(wx, wy);
  const side = hz > 1e-4 ? shade(wx / hz, wy / hz) : 1;
  return nh >= 0 ? side * (1 - nh) + 1.04 * nh : side * (1 + nh) + 0.55 * -nh;
}
const QA = new Float64Array(12);
function face4(lit, rect) {
  if (lit <= 0) return;
  const F = RG.F, uv = uvOf(rect);
  for (let k = 0; k < 4; k++) { const x = QA[k * 3], y = QA[k * 3 + 1]; QA[k * 3] = WX(x, y); QA[k * 3 + 1] = WY(x, y); QA[k * 3 + 2] = RG.h0 + QA[k * 3 + 2]; }
  F.quad(QA[0], QA[1], QA[2], QA[3], QA[4], QA[5], QA[6], QA[7], QA[8], QA[9], QA[10], QA[11], uv, RG.tr * lit, RG.tg * lit, RG.tb * lit, RG.a);
}
// an oriented box: centre c, unit axes a1 (length), a2, a3 = a1 × a2, half sizes e1, e2, e3; rects { L (faces ±a2),
// T (faces ±a3), E (the ends ±a1) } — the texture's width runs along a1 on the long faces
const FACES = [[1, 2, 3, 'E'], [-1, -2, 3, 'E'], [2, -1, 3, 'L'], [-2, 1, 3, 'L'], [3, 1, 2, 'T'], [-3, 1, -2, 'T']];
function obox(c, a1, a2, a3, e1, e2, e3, rc, tint = 1) {
  const AX = [null, a1, a2, a3], E = [0, e1, e2, e3];
  const ax = (i) => AX[Math.abs(i)], sg = (i) => (i < 0 ? -1 : 1);
  for (const [n, u, up, rk] of FACES) {
    const N = ax(n), sn = sg(n), Uu = ax(u), su = sg(u), Up = ax(up), sp = sg(up);
    const lit = lightOf(N[0] * sn, N[1] * sn, N[2] * sn) * tint;
    if (lit <= 0) continue;
    const hn = E[Math.abs(n)], hu = E[Math.abs(u)], hp = E[Math.abs(up)];
    const fx = c[0] + N[0] * sn * hn, fy = c[1] + N[1] * sn * hn, fh = c[2] + N[2] * sn * hn;
    const ux = Uu[0] * su * hu, uy = Uu[1] * su * hu, uh = Uu[2] * su * hu, px = Up[0] * sp * hp, py = Up[1] * sp * hp, ph = Up[2] * sp * hp;
    QA[0] = fx - ux + px; QA[1] = fy - uy + py; QA[2] = fh - uh + ph;
    QA[3] = fx + ux + px; QA[4] = fy + uy + py; QA[5] = fh + uh + ph;
    QA[6] = fx + ux - px; QA[7] = fy + uy - py; QA[8] = fh + uh - ph;
    QA[9] = fx - ux - px; QA[10] = fy - uy - py; QA[11] = fh - uh - ph;
    face4(lit, rc[rk]);
  }
}
const X = [1, 0, 0], Y = [0, 1, 0], Z = [0, 0, 1];
const BEAM = { L: U.beamS, T: U.beamT, E: U.end }, RAIL = { L: U.railS, T: U.railT, E: U.end }, POST = { L: U.post, T: U.post, E: U.end };
const IRON = { L: U.iron, T: U.ironT, E: U.iron }, ROPE = { L: U.rope, T: U.rope, E: U.rope }, STONE = { L: U.stone, T: U.stone, E: U.stone };
const LOG = { L: U.ramS, T: U.ramS, E: U.ramE }, HEAD = { L: U.ramH, T: U.ramH, E: U.ironD }, CUP = { L: U.cup, T: U.cup, E: U.cup };
const PLANK = { L: U.plank, T: U.floor, E: U.end }, DECK = { L: U.beamS, T: U.floor, E: U.end };
// an axis-aligned box in local tiles
const abox = (x0, x1, y0, y1, h0, h1, rc, tint) => obox([(x0 + x1) / 2, (y0 + y1) / 2, (h0 + h1) / 2], X, Y, Z, (x1 - x0) / 2, (y1 - y0) / 2, (h1 - h0) / 2, rc, tint);
const V1 = [0, 0, 0], V2 = [0, 0, 0], V3 = [0, 0, 0], VC = [0, 0, 0];
// a beam from p0 to p1 (local [x, y, h]), w wide (sideways), t thick
function beam(p0, p1, w, t, rc = BEAM, tint = 1) {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dh = p1[2] - p0[2], Lb = Math.hypot(dx, dy, dh) || 1;
  V1[0] = dx / Lb; V1[1] = dy / Lb; V1[2] = dh / Lb;
  // a2 = Z × a1 (horizontal) — a vertical beam: X
  let sx = -V1[1], sy = V1[0];
  const sl = Math.hypot(sx, sy);
  if (sl < 1e-4) { sx = 1; sy = 0; } else { sx /= sl; sy /= sl; }
  V2[0] = sx; V2[1] = sy; V2[2] = 0;
  V3[0] = V1[1] * V2[2] - V1[2] * V2[1]; V3[1] = V1[2] * V2[0] - V1[0] * V2[2]; V3[2] = V1[0] * V2[1] - V1[1] * V2[0];
  VC[0] = (p0[0] + p1[0]) / 2; VC[1] = (p0[1] + p1[1]) / 2; VC[2] = (p0[2] + p1[2]) / 2;
  obox(VC, V1, V2, V3, Lb / 2, w / 2, t / 2, rc, tint);
}
// a rope / chain between two points: two crossed strips (seen from every side)
function rope(p0, p1, w, rect = U.rope, lit = 0.92) {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dh = p1[2] - p0[2], Lr = Math.hypot(dx, dy, dh) || 1;
  let sx = -dy, sy = dx; const sl = Math.hypot(sx, sy) || 1; sx /= sl; sy /= sl;
  if (Math.hypot(dx, dy) < 1e-4) { sx = 1; sy = 0; }
  const ux = dx / Lr, uy = dy / Lr, uh = dh / Lr, vx = uy * 0 - uh * sy, vy = uh * sx - ux * 0, vh = ux * sy - uy * sx; // (the second strip: across both)
  for (const [ex, ey, eh] of [[sx, sy, 0], [vx, vy, vh]]) {
    QA[0] = p0[0] + ex * w; QA[1] = p0[1] + ey * w; QA[2] = p0[2] + eh * w;
    QA[3] = p1[0] + ex * w; QA[4] = p1[1] + ey * w; QA[5] = p1[2] + eh * w;
    QA[6] = p1[0] - ex * w; QA[7] = p1[1] - ey * w; QA[8] = p1[2] - eh * w;
    QA[9] = p0[0] - ex * w; QA[10] = p0[1] - ey * w; QA[11] = p0[2] - eh * w;
    face4(lit, rect);
  }
}
// a wheel: centre c, axis along local x (side = ±1 the outer cap first), radius r, width w, turned by ang
const WN = 10, WP = new Float64Array(15);
function wheel(c, r, w, ang) {
  const F = RG.F, S = RG.S, du = (S.u1 - S.u0) / S.pw, dv = (S.v1 - S.v0) / S.ph, R0 = U.wheelF, cu = (R0[0] + R0[2]) / 2, cv = (R0[1] + R0[3]) / 2, ru = (R0[2] - R0[0]) / 2 - 0.8;
  // the tread
  for (let k = 0; k < WN; k++) {
    const a0 = ang + (k / WN) * TAU, a1 = ang + ((k + 1) / WN) * TAU, am = (a0 + a1) / 2;
    const lit = lightOf(0, Math.cos(am), Math.sin(am));
    if (lit <= 0) continue;
    QA[0] = c[0] - w / 2; QA[1] = c[1] + Math.cos(a0) * r; QA[2] = c[2] + Math.sin(a0) * r;
    QA[3] = c[0] + w / 2; QA[4] = c[1] + Math.cos(a0) * r; QA[5] = c[2] + Math.sin(a0) * r;
    QA[6] = c[0] + w / 2; QA[7] = c[1] + Math.cos(a1) * r; QA[8] = c[2] + Math.sin(a1) * r;
    QA[9] = c[0] - w / 2; QA[10] = c[1] + Math.cos(a1) * r; QA[11] = c[2] + Math.sin(a1) * r;
    face4(lit * 0.9, U.wheelR);
  }
  // the two faces (spokes turn with it)
  for (const sd of [1, -1]) {
    const lit = lightOf(sd, 0, 0);
    if (lit <= 0) continue;
    const x = c[0] + sd * w / 2, wx0 = WX(x, c[1]), wy0 = WY(x, c[1]), h0 = RG.h0 + c[2];
    for (let k = 0; k < WN; k += 2) {
      const P = WP;
      for (let j = 0; j < 3; j++) {
        const q = (k + j) / WN * TAU, a = ang + q, y = c[1] + Math.cos(a) * r, h = c[2] + Math.sin(a) * r;
        P[j * 5] = WX(x, y); P[j * 5 + 1] = WY(x, y); P[j * 5 + 2] = RG.h0 + h; P[j * 5 + 3] = S.u0 + du * (cu + Math.cos(q) * ru); P[j * 5 + 4] = S.v0 + dv * (cv - Math.sin(q) * ru);
      }
      F.quad4(wx0, wy0, h0, S.u0 + du * cu, S.v0 + dv * cv, P[0], P[1], P[2], P[3], P[4], P[5], P[6], P[7], P[8], P[9], P[10], P[11], P[12], P[13], P[14], RG.tr * lit, RG.tg * lit, RG.tb * lit, RG.a);
    }
  }
  // the hub
  abox(c[0] - w / 2 - 0.05, c[0] + w / 2 + 0.05, c[1] - 0.06, c[1] + 0.06, c[2] - 0.06, c[2] + 0.06, IRON);
}
// a stone ball (8 sides, 3 bands)
const LAT = [-Math.PI / 2, -0.55, 0.55, Math.PI / 2];
function ballPt(c, r, t, a, o) { QA[o] = c[0] + r * Math.cos(t) * Math.cos(a); QA[o + 1] = c[1] + r * Math.cos(t) * Math.sin(a); QA[o + 2] = c[2] + r * Math.sin(t) * 0.92; }
function ball(c, r, spin = 0) {
  for (let b = 0; b < 3; b++) for (let k = 0; k < 8; k++) {
    const t0 = LAT[b], t1 = LAT[b + 1], a0 = spin + (k / 8) * TAU, a1 = spin + ((k + 1) / 8) * TAU, am = (a0 + a1) / 2, tm = (t0 + t1) / 2;
    const lit = lightOf(Math.cos(tm) * Math.cos(am), Math.cos(tm) * Math.sin(am), Math.sin(tm));
    if (lit <= 0) continue;
    ballPt(c, r, t1, a0, 0); ballPt(c, r, t1, a1, 3); ballPt(c, r, t0, a1, 6); ballPt(c, r, t0, a0, 9);
    face4(lit, U.boulder);
  }
}

// ---------------- kit helpers (local tiles → art numbers; align: false) ----------------
const flipH = (r) => [r[2], r[1], r[0], r[3]], turn = (r) => [...r, 1];
const kit = (D) => {
  const V = (y) => y + 1 - D / 2;
  return {
    V,
    box: (x0, x1, y0, y1, h0, h1, uv, ex = {}) => ({ box: [x0 * 64, x1 * 64, V(y0), V(y1), h0 * 64, h1 * 64], uv, ...ex }),
    quad: (pts, rect, ex = {}) => ({ quad: pts.map(([x, y, h]) => [x * 64, V(y), h * 64]), uv: { q: rect }, ...ex }),
  };
};
const across = (S = U.beamS, T = U.beamT) => ({ s: S, n: flipH(S), e: U.end, w: U.end, t: T });
const along = (S = U.beamS, T = U.beamT) => ({ s: U.end, n: U.end, e: S, w: flipH(S), t: turn(T) });
const upright = (P = U.post) => ({ s: P, n: P, e: P, w: P, t: U.end });
const allOf = (r, t = r) => ({ s: r, n: r, e: r, w: r, t });
const SHADOW = (b) => ({ ...b, vis: () => false });

// the model frame of an engine this frame (world origin, angle of local +x, lift) — with the slide of a step
const SL = [0, 0];
function slideOf(o) {
  if (!(o._slT > 0) || !(o._slD > 0)) { SL[0] = SL[1] = 0; return SL; }
  const k = o._slT / o._slD;
  SL[0] = o._slx * k; SL[1] = o._sly * k;
  return SL;
}
const bodyX = (o) => (o.tx ?? Math.floor(o.x)) + (o.fw || 1) / 2, bodyY = (o) => (o.ty ?? Math.floor(o.y)) + (o.fh || 1) / 2;
const liftOf = (o) => (o.lv | 0) * STORY_H + (o._dkh || 0);
const FACE_ANG = { s: Math.PI / 2, w: Math.PI, n: -Math.PI / 2, e: 0 };
const aimOf = (o) => o._aimD ?? o.aim ?? FACE_ANG[o.face || 's'] ?? Math.PI / 2;
const rotAng = (o) => (o.rot & 3) * Math.PI / 2;
const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
const MOVE = [0, 0, 0, 0, 0];
const move = (o) => { const s = slideOf(o); MOVE[0] = s[0]; MOVE[1] = s[1]; return MOVE; };

// ======================================================================================================================
// TREBUCHET (3 × 3): a square timber sole frame on the ground (kit, stays); everything above turns on the iron pivot
// toward the aim (per frame): two sole beams, cross ties, two A-frames up to the axle, the long arm with its iron bands,
// the hanging counterweight box of stones, the sling and its stone, the winch at the back.
// ======================================================================================================================
const TB = { ax: 1.92, Lb: 2.7, Ls: 0.95, sling: 1.25 };
const PHI_C = Math.PI + Math.asin((TB.ax - 0.22) / TB.Lb); // cocked: the long end down at the back
const PHI_F = 1.0;                                          // after the swing: forward-up, past the vertical
// the arm's angle (in the throw plane: 0 = forward, π/2 = up) and the sling's, from the shared shot / reload
function trebPose(o, t) {
  const S = ARTY.trebuchet, sw = 0.9;
  const r = o._reload > 0, ts = r && o._shotT != null ? t - o._shotT : 1e9;
  let phi = PHI_C, psi = 0, loaded = !r, flying = false;
  if (ts < sw) {
    const u = ts / sw, e = u * u;
    phi = PHI_C - (PHI_C - PHI_F + 0.12) * e;
    const s = u * u * u;
    psi = s * (phi + 1.25);
    loaded = ts < S.swing; flying = !loaded;
  } else if (ts < sw + 1.6) {
    const q = ts - sw;
    phi = PHI_F + 0.12 - 0.26 * Math.exp(-3 * q) * Math.cos(8 * q) - 0.12 * (1 - Math.exp(-3 * q));
    psi = -Math.PI / 2 + 0.6 * Math.exp(-2.2 * q) * Math.cos(6 * q);
  } else if (r) {
    const span = Math.max(1, S.reload - sw - 1.6 - 0.8), u = smooth((ts - sw - 1.6) / span);
    phi = PHI_F + (PHI_C - PHI_F) * u;
    psi = -Math.PI / 2 + (Math.PI / 2) * smooth((u - 0.85) / 0.15);
    loaded = u >= 1;
  }
  return { phi, psi, loaded, flying, winch: r && ts > sw + 1.6 ? ts * 2.4 : 0 };
}
function drawTreb(B, A, o, t, x0, y0, lift, a, FS) {
  const a0 = aimOf(o);
  if (!rig(B, A, FS, bodyX(o), bodyY(o), a0 - Math.PI / 2, liftOf(o))) return;
  const P = trebPose(o, t);
  // sole beams, cross ties
  for (const sx of [-0.46, 0.46]) abox(sx - 0.09, sx + 0.09, -1.28, 1.28, 0.2, 0.42, { L: U.beamS, T: U.beamT, E: U.end });
  for (const y of [-1.0, 0, 0.98]) abox(-0.62, 0.62, y - 0.08, y + 0.08, 0.24, 0.4, BEAM);
  abox(-0.3, 0.3, -0.3, 0.3, 0.18, 0.24, IRON); // (the pivot plate)
  // A-frames: legs to the axle, a brace, the apex block
  for (const sx of [-0.46, 0.46]) {
    beam([sx, 0.98, 0.4], [sx, 0.07, TB.ax + 0.04], 0.15, 0.15, BEAM);
    beam([sx, -1.0, 0.4], [sx, -0.07, TB.ax + 0.04], 0.15, 0.15, BEAM);
    beam([sx, -0.56, 1.05], [sx, 0.56, 1.05], 0.12, 0.1, BEAM);
    beam([sx, -0.2, 0.42], [sx, -0.2, 1.0], 0.1, 0.1, POST); // (a strut under the brace)
    abox(sx - 0.11, sx + 0.11, -0.13, 0.13, TB.ax - 0.06, TB.ax + 0.12, IRON);
  }
  abox(-0.62, 0.62, -0.06, 0.06, TB.ax - 0.06, TB.ax + 0.06, IRON); // the axle
  // the arm: from the counterweight end through the axle to the sling end
  const ca = Math.cos(P.phi), sa = Math.sin(P.phi);
  const tip = [0, ca * TB.Lb, TB.ax + sa * TB.Lb], back = [0, -ca * TB.Ls, TB.ax - sa * TB.Ls];
  beam(back, tip, 0.15, 0.18, RAIL);
  beam([0, -ca * 0.18, TB.ax - sa * 0.18], [0, ca * 0.18, TB.ax + sa * 0.18], 0.2, 0.22, IRON); // (bound at the axle)
  // the counterweight: a box of stones hanging from the short end (always plumb)
  const cw = [0, back[1], back[2] - 0.5];
  abox(-0.07, 0.07, back[1] - 0.05, back[1] + 0.05, back[2] - 0.2, back[2] + 0.08, IRON);
  for (const sx of [-0.3, 0.3]) beam([sx, back[1], back[2] - 0.02], [sx, cw[1], cw[2] + 0.28], 0.05, 0.05, IRON);
  beam([-0.36, back[1], back[2] - 0.02], [0.36, back[1], back[2] - 0.02], 0.06, 0.06, IRON);
  abox(-0.4, 0.4, cw[1] - 0.32, cw[1] + 0.32, cw[2] - 0.36, cw[2] + 0.28, STONE);
  abox(-0.43, 0.43, cw[1] - 0.35, cw[1] + 0.35, cw[2] + 0.22, cw[2] + 0.3, BEAM); // (its rim)
  // the sling: two ropes from the tip to the pouch, the stone in it until the release
  const cocked = P.phi > Math.PI;
  let pouch;
  if (cocked && P.loaded) pouch = [0, tip[1] + TB.sling * 0.98, 0.22];
  else pouch = [0, tip[1] + Math.cos(P.psi) * TB.sling, Math.max(0.12, tip[2] + Math.sin(P.psi) * TB.sling)];
  for (const sx of [-0.08, 0.08]) rope([sx * 0.2, tip[1], tip[2]], [sx, pouch[1], pouch[2] + 0.06], 0.02);
  abox(-0.13, 0.13, pouch[1] - 0.1, pouch[1] + 0.1, pouch[2] - 0.05, pouch[2] + 0.04, CUP);
  if (P.loaded || (!P.flying && o._reload > 0 && (t - (o._shotT ?? -9)) < ARTY.trebuchet.swing)) ball([0, pouch[1], pouch[2] + 0.17], 0.17, t * 0);
  // the winch at the back: posts, the drum (wound in the reload), its spokes
  for (const sx of [-0.3, 0.3]) beam([sx, -1.12, 0.38], [sx, -1.12, 0.78], 0.1, 0.1, POST);
  wheel([0, -1.12, 0.66], 0.11, 0.52, P.winch);
  for (let k = 0; k < 2; k++) { const w = P.winch + k * Math.PI / 2; for (const sx of [-0.34, 0.34]) beam([sx, -1.12 - Math.cos(w) * 0.26, 0.66 - Math.sin(w) * 0.26], [sx, -1.12 + Math.cos(w) * 0.26, 0.66 + Math.sin(w) * 0.26], 0.04, 0.04, BEAM); }
  rope([0, -1.12, 0.74], [0, tip[1] * 0.4 + back[1] * 0.0, cocked ? 0.5 : TB.ax * 0.5], 0.015, U.rope, 0.8);
}
{
  const k = kit(3);
  defineSolid('trebuchet', {
    ow: 0, uvS: 'siege_uv', align: false,
    parts: [
      // the ground frame: a square of sills, a cross through the middle, corner blocks, the iron pivot ring
      k.box(-1.45, 1.45, -1.42, -1.24, 0, 0.16, across()), k.box(-1.45, 1.45, 1.24, 1.42, 0, 0.16, across()),
      k.box(-1.42, -1.24, -1.24, 1.24, 0, 0.15, along()), k.box(1.24, 1.42, -1.24, 1.24, 0, 0.15, along()),
      k.box(-1.24, 1.24, -0.08, 0.08, 0, 0.12, across()), k.box(-0.08, 0.08, -1.24, 1.24, 0, 0.12, along()),
      ...[[-1.36, -1.36], [1.36, -1.36], [-1.36, 1.36], [1.36, 1.36]].map(([x, y]) => k.box(x - 0.12, x + 0.12, y - 0.12, y + 0.12, 0, 0.22, allOf(U.iron, U.ironT))),
      k.box(-0.42, 0.42, -0.42, 0.42, 0.1, 0.18, allOf(U.iron, U.ironT)),
      // shadow casters of the turning frame (the frame itself is drawn per frame)
      SHADOW(k.box(-0.55, 0.55, -1.0, 1.0, 0.4, 1.9, allOf(U.post))),
    ],
    fx: [{ at: [0, 1 - 1.5, 0], always: true, draw: drawTreb }],
    blob: false,
  });
}

// ======================================================================================================================
// CATAPULT (1 × 1, on a wall-walk or the ground): an iron turntable with four feet (kit); per frame, turning with the
// aim: the frame, the twisted rope skein across it, the throwing arm and its leather cup, the uprights with the padded
// stop bar, the winch at the back.
// ======================================================================================================================
const CT = { pv: [0, -0.18, 0.27], La: 0.82 };
const CPHI_C = Math.PI - 0.12, CPHI_F = 1.38;
function catPose(o, t) {
  const S = ARTY.catapult, sw = 0.16;
  const r = o._reload > 0, ts = r && o._shotT != null ? t - o._shotT : 1e9;
  let phi = CPHI_C, loaded = !r, winch = 0;
  if (ts < sw) { const u = ts / sw; phi = CPHI_C - (CPHI_C - CPHI_F) * u * u; loaded = ts < S.swing * 0.9; }
  else if (ts < sw + 0.7) { const q = ts - sw; phi = CPHI_F + 0.16 * Math.exp(-6 * q) * Math.sin(18 * q); }
  else if (r) { const span = Math.max(0.6, S.reload - sw - 0.7 - 0.5), u = smooth((ts - sw - 0.7) / span); phi = CPHI_F + (CPHI_C - CPHI_F) * u; loaded = u >= 1; winch = ts * 4; }
  return { phi, loaded, winch };
}
function drawCat(B, A, o, t, x0, y0, lift, a, FS) {
  const a0 = aimOf(o);
  if (!rig(B, A, FS, bodyX(o), bodyY(o), a0 - Math.PI / 2, liftOf(o))) return;
  const P = catPose(o, t);
  // the frame: side beams, cross beams
  for (const sx of [-0.3, 0.3]) abox(sx - 0.07, sx + 0.07, -0.62, 0.6, 0.1, 0.25, { L: U.beamS, T: U.beamT, E: U.end });
  for (const y of [-0.5, 0.45]) abox(-0.37, 0.37, y - 0.06, y + 0.06, 0.12, 0.24, BEAM);
  // the skein (twisted rope across, wound on iron ratchets)
  wheel([0, CT.pv[1], CT.pv[2]], 0.1, 0.56, 0);
  for (const sx of [-0.35, 0.35]) abox(sx - 0.04, sx + 0.04, CT.pv[1] - 0.12, CT.pv[1] + 0.12, CT.pv[2] - 0.12, CT.pv[2] + 0.12, IRON);
  // uprights, braces and the padded stop bar
  for (const sx of [-0.3, 0.3]) {
    beam([sx, 0.06, 0.25], [sx, 0.06, 1.0], 0.1, 0.1, POST);
    beam([sx, 0.45, 0.25], [sx, 0.08, 0.72], 0.07, 0.07, BEAM);
  }
  abox(-0.37, 0.37, 0.0, 0.12, 0.9, 1.02, BEAM);
  abox(-0.24, 0.24, -0.04, 0.0, 0.88, 1.0, CUP);
  // the arm and its cup
  const ca = Math.cos(P.phi), sa = Math.sin(P.phi), tip = [0, CT.pv[1] + ca * CT.La, CT.pv[2] + sa * CT.La];
  beam([0, CT.pv[1] - ca * 0.08, CT.pv[2] - sa * 0.08], tip, 0.1, 0.1, RAIL);
  const cu = [0, tip[1] + ca * 0.06, tip[2] + sa * 0.06];
  // (the cup: a little tray square to the arm)
  obox([cu[0], cu[1], cu[2]], [0, ca, sa], X, [0, -sa, ca], 0.12, 0.12, 0.05, CUP);
  if (P.loaded) ball([0, cu[1] - sa * 0.1, cu[2] + ca * 0.1], 0.1);
  // the winch at the back, its handles
  wheel([0, -0.56, 0.32], 0.07, 0.4, P.winch);
  for (const sx of [-0.23, 0.23]) beam([sx, -0.56 - Math.cos(P.winch) * 0.16, 0.32 - Math.sin(P.winch) * 0.16], [sx, -0.56 + Math.cos(P.winch) * 0.16, 0.32 + Math.sin(P.winch) * 0.16], 0.03, 0.03, BEAM);
  rope([0, -0.56, 0.38], [0, tip[1], tip[2]], 0.012, U.rope, 0.8);
}
{
  const k = kit(1);
  defineSolid('catapult', {
    ow: 0, uvS: 'siege_uv', align: false,
    parts: [
      k.box(-0.3, 0.3, -0.3, 0.3, 0, 0.1, allOf(U.iron, U.ironT)),
      ...[[-0.36, -0.36], [0.36, -0.36], [-0.36, 0.36], [0.36, 0.36]].map(([x, y]) => k.box(x - 0.08, x + 0.08, y - 0.08, y + 0.08, 0, 0.08, allOf(U.beamS, U.beamT))),
      SHADOW(k.box(-0.36, 0.36, -0.55, 0.5, 0.1, 0.95, allOf(U.post))),
    ],
    fx: [{ at: [0, 0.5, 0], always: true, draw: drawCat }],
    blob: [0.95, 0.7, 0.45, 0.4],
  });
}

// ======================================================================================================================
// BATTERING RAM (2 × 3): a wheeled shed (kit, moves with each step): chassis, posts, eaves, the ridge, a pitched roof of
// wet hides, hide skirts on the sides; per frame: the four wheels rolling, the iron-headed log swinging on its chains.
// ======================================================================================================================
const RAM = { ridge: 1.9, hang: 0.82, log: 0.74 };
function ramSwing(o, t) {
  const ts = o._swT != null ? t - o._swT : 1e9;
  if (ts < 0.45) return -0.5 * smooth(ts / 0.45);                       // pulled back
  if (ts < 0.6) return -0.5 + 0.88 * ((ts - 0.45) / 0.15) ** 2;          // driven forward
  if (ts < 2) { const q = ts - 0.6; return 0.38 * Math.exp(-3.2 * q) * Math.cos(7 * q); }
  return 0;
}
function drawRam(B, A, o, t, x0, y0, lift, a, FS) {
  const s = slideOf(o);
  if (!rig(B, A, FS, bodyX(o) + s[0], bodyY(o) + s[1], rotAng(o), liftOf(o))) return;
  const roll = (o._roll || 0) / 0.32;
  for (const sx of [-1.0, 1.0]) for (const y of [-0.9, 0.9]) wheel([sx, y, 0.32], 0.32, 0.13, -roll);
  // the log on two chains from the ridge
  const b = ramSwing(o, t), dy = Math.sin(b) * RAM.hang, dh = (1 - Math.cos(b)) * RAM.hang;
  const lh = RAM.log + dh;
  for (const y of [-0.75, 0.75]) for (const sx of [-0.07, 0.07]) rope([sx, y, RAM.ridge - 0.06], [sx, y + dy, lh + 0.12], 0.025, U.chain, 0.95);
  beam([0, -1.62 + dy, lh], [0, 1.25 + dy, lh], 0.26, 0.26, LOG);
  for (const y of [-0.75, 0.75]) abox(-0.15, 0.15, y + dy - 0.05, y + dy + 0.05, lh - 0.15, lh + 0.15, IRON);
  // the iron head and its curled horns
  const hy = 1.25 + dy;
  abox(-0.19, 0.19, hy, hy + 0.36, lh - 0.19, lh + 0.19, HEAD);
  abox(-0.13, 0.13, hy + 0.36, hy + 0.46, lh - 0.13, lh + 0.13, HEAD);
  for (const sx of [-1, 1]) { beam([sx * 0.18, hy + 0.12, lh + 0.12], [sx * 0.3, hy + 0.02, lh + 0.02], 0.08, 0.08, HEAD); beam([sx * 0.3, hy + 0.02, lh + 0.02], [sx * 0.3, hy + 0.22, lh - 0.12], 0.07, 0.07, HEAD); }
}
{
  const k = kit(3);
  const H = RAM.ridge, E = 1.36;
  const parts = [
    // chassis: side beams, cross beams, axles
    k.box(-0.92, -0.74, -1.45, 1.45, 0.3, 0.48, along()), k.box(0.74, 0.92, -1.45, 1.45, 0.3, 0.48, along()),
    ...[-1.32, 0, 1.32].map((y) => k.box(-0.74, 0.74, y - 0.07, y + 0.07, 0.33, 0.46, across())),
    ...[-0.9, 0.9].map((y) => k.box(-1.0, 1.0, y - 0.05, y + 0.05, 0.27, 0.37, allOf(U.iron, U.ironT))),
    // posts and eaves
    ...[-1.32, 0, 1.32].flatMap((y) => [-0.83, 0.83].map((x) => k.box(x - 0.07, x + 0.07, y - 0.07, y + 0.07, 0.48, E, upright()))),
    k.box(-0.92, -0.74, -1.45, 1.45, E - 0.04, E + 0.1, along()), k.box(0.74, 0.92, -1.45, 1.45, E - 0.04, E + 0.1, along()),
    // the ridge beam on two king posts
    k.box(-0.08, 0.08, -1.5, 1.5, H - 0.04, H + 0.1, along()),
    ...[-1.32, 1.32].map((y) => k.box(-0.06, 0.06, y - 0.06, y + 0.06, E + 0.1, H - 0.04, upright())),
    ...[-1.32, 1.32].map((y) => k.box(-0.83, 0.83, y - 0.05, y + 0.05, E + 0.02, E + 0.12, across())),
    // hide skirts on the upper sides (the log shows under them)
    k.box(-0.95, -0.9, -1.4, 1.4, 0.86, E, { s: U.hide, n: U.hide, e: U.hide, w: U.hide, t: U.hide }),
    k.box(0.9, 0.95, -1.4, 1.4, 0.86, E, { s: U.hide, n: U.hide, e: U.hide, w: U.hide, t: U.hide }),
    // the roof: two slopes of wet hides from the eaves up to the ridge (both sides of each slope)
    k.quad([[-1.02, -1.55, E + 0.06], [0, -1.55, H + 0.14], [0, 1.55, H + 0.14], [-1.02, 1.55, E + 0.06]], U.shingle),
    k.quad([[0, -1.55, H + 0.14], [1.02, -1.55, E + 0.06], [1.02, 1.55, E + 0.06], [0, 1.55, H + 0.14]], U.shingle),
    // gables: a triangle of planks over the front and the back openings
    k.quad([[-0.86, 1.36, E + 0.1], [0.86, 1.36, E + 0.1], [0.02, 1.36, H], [-0.02, 1.36, H]], U.plank),
    k.quad([[0.86, -1.36, E + 0.1], [-0.86, -1.36, E + 0.1], [-0.02, -1.36, H], [0.02, -1.36, H]], U.plank),
    // the push bars at the back (the crew's handles)
    k.box(-0.6, 0.6, -1.62, -1.5, 0.78, 0.88, across(U.railS, U.railT)),
    ...[-0.5, 0.5].map((x) => k.box(x - 0.05, x + 0.05, -1.55, -1.42, 0.46, 0.84, upright())),
    SHADOW(k.box(-0.15, 0.15, -1.6, 1.6, 0.6, 0.9, allOf(U.post))),
  ];
  defineSolid('battering_ram', { ow: 0, uvS: 'siege_uv', align: false, parts, move, fx: [{ at: [0, k.V(0), 0], always: true, draw: drawRam }], blob: false });
}

// ======================================================================================================================
// SIEGE TOWER (2 × 2, 1–3 stories: o.v): corner posts, a belt at every story, plank walls (wet hides on the front), the
// deck at the top story with a crenellated parapet, a ladder up the back, four wheels; per frame: the wheels rolling
// and the drawbridge ramp hinged at the deck's front edge — up it closes the front of the deck, down it lies on the
// wall-walk in front (game/siege.js: o._rampK).
// ======================================================================================================================
const towerN = (o) => Math.max(1, Math.min(3, o.v | 0 || 1));
function drawTower(B, A, o, t, x0, y0, lift, a, FS) {
  const s = slideOf(o), n = towerN(o);
  if (!rig(B, A, FS, bodyX(o) + s[0], bodyY(o) + s[1], rotAng(o), liftOf(o))) return;
  const roll = (o._roll || 0) / 0.34;
  for (const sx of [-1.02, 1.02]) for (const y of [-0.62, 0.62]) wheel([sx, y, 0.34], 0.34, 0.14, -roll);
  // the ramp: hinged at (y 0.9, h n), 1.05 long; up = standing, down = flat on the wall-walk
  const k = smooth(o._rampK ?? (o.ramp ? 1 : 0)), g = (Math.PI / 2) * (1 - k), Lr = 1.08;
  const ux = Math.cos(g), uh = Math.sin(g); // (its direction from the hinge: forward / up)
  const p0 = [0, 0.9, n + 0.02], p1 = [0, 0.9 + ux * Lr, n + 0.02 + uh * Lr];
  obox([0, (p0[1] + p1[1]) / 2 + uh * 0.04, (p0[2] + p1[2]) / 2 - ux * 0.04], [0, ux, uh], X, [0, -uh, ux], Lr / 2, 0.84, 0.045, { L: U.beamS, T: U.floor, E: U.end });
  for (const sx of [-0.62, 0, 0.62]) obox([sx, (p0[1] + p1[1]) / 2 + uh * 0.09, (p0[2] + p1[2]) / 2 - ux * 0.09], [0, ux, uh], X, [0, -uh, ux], Lr / 2 - 0.04, 0.05, 0.03, BEAM); // (cleats underneath)
  // its lifting ropes from the tops of the front posts
  for (const sx of [-0.84, 0.84]) rope([sx, 0.88, n + 0.72], [sx * 0.95, p1[1] - ux * 0.06, p1[2] + 0.03], 0.018);
}
const TOWER_V = Object.create(null);
function towerParts(n) {
  const k = kit(2), H = n, top = H + 0.72;
  const P = [
    // base chassis and axles
    k.box(-0.95, -0.78, -0.95, 0.95, 0.28, 0.46, along()), k.box(0.78, 0.95, -0.95, 0.95, 0.28, 0.46, along()),
    ...[-0.62, 0.62].map((y) => k.box(-1.04, 1.04, y - 0.05, y + 0.05, 0.29, 0.39, allOf(U.iron, U.ironT))),
    // corner posts up past the deck
    ...[[-0.86, -0.86], [0.86, -0.86], [-0.86, 0.86], [0.86, 0.86]].map(([x, y]) => k.box(x - 0.08, x + 0.08, y - 0.08, y + 0.08, 0.46, top, upright())),
  ];
  // walls: planks on the sides and the back, wet hides on the front (the ladder side is the back)
  P.push(k.box(-0.9, -0.84, -0.86, 0.86, 0.46, H, { s: U.plank, n: U.plank, e: U.plank, w: U.plank, t: U.end }));
  P.push(k.box(0.84, 0.9, -0.86, 0.86, 0.46, H, { s: U.plank, n: U.plank, e: U.plank, w: U.plank, t: U.end }));
  P.push(k.box(-0.86, 0.86, -0.9, -0.84, 0.46, H, { s: U.plank, n: U.plank, e: U.plank, w: U.plank, t: U.end }));
  P.push(k.box(-0.86, 0.86, 0.84, 0.9, 0.46, H, { s: U.hide, n: U.hide, e: U.hide, w: U.hide, t: U.end }));
  // a belt at each story and an arrow slit band
  for (let s = 1; s <= n; s++) {
    const h = s - 0.06;
    P.push(k.box(-0.96, 0.96, 0.86, 0.96, h - 0.05, h + 0.07, across()), k.box(-0.96, 0.96, -0.96, -0.86, h - 0.05, h + 0.07, across()));
    P.push(k.box(-0.96, -0.86, -0.86, 0.86, h - 0.05, h + 0.07, along()), k.box(0.86, 0.96, -0.86, 0.86, h - 0.05, h + 0.07, along()));
    if (s < n) for (const x of [-0.3, 0.3]) P.push(k.box(x - 0.05, x + 0.05, 0.9, 0.93, s + 0.35, s + 0.62, allOf(U.dark)));
  }
  // the deck (the floor people stand on: the levels story n while the ramp is down) and the parapet
  P.push(k.box(-0.86, 0.86, -0.86, 0.86, H - 0.07, H, { s: U.beamS, n: U.beamS, e: U.beamS, w: U.beamS, t: U.floor }));
  P.push(k.box(-0.9, -0.82, -0.86, 0.86, H, H + 0.5, { s: U.plank, n: U.plank, e: U.plank, w: U.plank, t: U.beamT }));
  P.push(k.box(0.82, 0.9, -0.86, 0.86, H, H + 0.5, { s: U.plank, n: U.plank, e: U.plank, w: U.plank, t: U.beamT }));
  P.push(k.box(-0.86, 0.86, -0.9, -0.82, H, H + 0.5, { s: U.plank, n: U.plank, e: U.plank, w: U.plank, t: U.beamT }));
  for (const x of [-0.55, 0, 0.55]) P.push(k.box(x - 0.13, x + 0.13, -0.92, -0.8, H + 0.5, H + 0.7, allOf(U.plank, U.beamT)));
  for (const y of [-0.45, 0.25]) for (const x of [-0.92, 0.8]) P.push(k.box(x, x + 0.12, y - 0.13, y + 0.13, H + 0.5, H + 0.7, allOf(U.plank, U.beamT)));
  // the ladder up the back (outside)
  P.push(k.box(-0.24, 0.24, -1.0, -0.95, 0.12, H + 0.12, { s: U.ladder, n: U.ladder, e: U.post, w: U.post, t: U.end }));
  P.push(k.box(-0.24, -0.18, -1.08, -0.95, 0.06, 0.16, upright()), k.box(0.18, 0.24, -1.08, -0.95, 0.06, 0.16, upright()));
  // the push bars at the back
  P.push(k.box(-0.95, 0.95, -1.12, -1.02, 0.78, 0.88, across(U.railS, U.railT)));
  return P;
}
defineSolid('siege_tower', {
  ow: 0, uvS: 'siege_uv', align: false,
  state: (o) => 'n' + towerN(o),
  variant: (st) => TOWER_V[st] || (TOWER_V[st] = { parts: towerParts(+st.slice(1) || 1) }),
  parts: towerParts(1),
  move,
  fx: [{ at: [0, 0, 0], always: true, draw: drawTower }],
  blob: false,
});

// ======================================================================================================================
// OFICINA DE CERCO (3 × 2): the siege carpenters' yard — a heavy bench with a vice, a squared log on two trestles with
// an adze stuck in it, a stack of beams, a little shear-leg hoist with a pulley, a spare wheel leaning on the bench.
// ======================================================================================================================
function drawShop(B, A, o, t, x0, y0, lift, a, FS) {
  if (!rig(B, A, FS, bodyX(o), bodyY(o), rotAng(o), liftOf(o))) return;
  // the hoist: shear legs, a cross beam, a rope with a pulley block swinging gently
  for (const sx of [-0.2, 0.2]) beam([1.0 + sx, -0.75, 0], [1.0 + sx * 0.2, -0.45, 1.55], 0.09, 0.09, POST);
  beam([0.85, -0.5, 1.5], [1.15, -0.5, 1.5], 0.08, 0.08, BEAM);
  const sw = Math.sin(t * 0.9) * 0.05;
  rope([1.0, -0.5, 1.46], [1.0 + sw, -0.5, 0.86], 0.016);
  abox(0.94 + sw, 1.06 + sw, -0.55, -0.45, 0.72, 0.88, IRON);
  // the spare wheel leaning on the bench (axis across, leaning back)
  wheel([-0.15, 0.62, 0.42], 0.4, 0.1, 0.3);
}
{
  const k = kit(2);
  const parts = [
    // the bench: top, legs, a vice
    k.box(-1.35, -0.05, -0.05, 0.35, 0.5, 0.62, across(U.beamS, U.floor)),
    ...[[-1.28, 0.02], [-0.12, 0.02], [-1.28, 0.28], [-0.12, 0.28]].map(([x, y]) => k.box(x - 0.05, x + 0.05, y - 0.04, y + 0.04, 0, 0.5, upright())),
    k.box(-1.3, -0.1, 0.0, 0.3, 0.12, 0.18, across()),
    k.box(-0.42, -0.3, 0.3, 0.4, 0.4, 0.66, allOf(U.iron, U.ironT)),
    // the log on trestles, an adze in it
    k.box(-1.4, 0.4, -0.78, -0.48, 0.42, 0.7, { s: U.ramS, n: U.ramS, e: U.ramE, w: U.ramE, t: U.ramS }),
    ...[-1.1, 0.1].flatMap((x) => [k.box(x - 0.04, x + 0.04, -0.85, -0.41, 0, 0.42, upright()), k.box(x - 0.18, x + 0.18, -0.68, -0.58, 0.32, 0.42, across())]),
    k.box(-0.62, -0.58, -0.66, -0.6, 0.7, 1.0, upright()), k.box(-0.68, -0.52, -0.67, -0.59, 0.94, 1.0, allOf(U.iron, U.ironT)),
    // the stack of beams
    ...[0, 1, 2].map((r) => k.box(0.3, 1.42, 0.25 + r * 0.03, 0.75 - r * 0.03, r * 0.13, r * 0.13 + 0.12, along(U.beamS, U.beamT))),
    k.box(0.32, 1.4, 0.4, 0.58, 0.39, 0.5, across()),
    // the hoist's feet and a mallet on the bench
    k.box(0.72, 1.28, -0.85, -0.65, 0, 0.08, allOf(U.beamS, U.beamT)),
    k.box(-0.9, -0.62, 0.08, 0.2, 0.62, 0.72, allOf(U.end, U.beamT)), k.box(-0.62, -0.3, 0.12, 0.16, 0.64, 0.68, allOf(U.post)),
    SHADOW(k.box(0.85, 1.15, -0.75, -0.45, 0, 1.5, allOf(U.post))),
  ];
  defineSolid('siege_workshop', { ow: 0, uvS: 'siege_uv', align: false, parts, fx: [{ at: [0, 0, 0], always: true, draw: drawShop }], decal: [0, 0.5, 52, 30, 0.35] });
}

// (tests / gallery: a model's moving poses)
export const SIEGE_POSE = { trebPose, catPose, ramSwing };
