// Camera rotation / 3D — defense pieces (art/faces/solid.js kit, format at the top of that file): the ballista.
// A real 3D object at every camera angle (0° too) made of boxes and ribbons with its own face art (uv: 'ballista_uv',
// each face in true proportions, like the chest). The base (a cross of heavy beams, an iron turntable, the post) stays;
// the top (yoke, stock, the front frame with its two rope skeins, the swept-back arms, the bowstring, the windlass and
// the loaded bolt) turns about the post to the aim angle (spin parts: o._aimD, eased on every peer by game/ballista.js;
// the operator's own copy turns at once). After a shot the bolt is gone and the string hangs straight until reloaded
// (vis parts: o._reload > 0). Art numbers: x px from the centre, v = ground row in tiles (v 1 = the front edge of the
// tile when it faces south), h px above the ground (64 px = 1 tile).
//   lazy art: ballista (front view: icon, build menu, fallback), ballista_uv (the face art), item_ballista_bolt (icon),
//   proj_ballista_bolt (the bolt in flight, pointing east)
import { defineSolid } from './solid.js';
import { lazyDef } from '../lazyDefs.js';
import { spritePx, lin, rng, circle, TAU } from '../paint.js';
import { CAMV } from '../archCompose.js';

// ---------------- palette ----------------
const W = { hi: '#d3a56c', light: '#b98a55', mid: '#956638', dark: '#6c4524', deep: '#47290f', grain: 'rgba(60,34,14,0.42)' };
const I = { hi: '#c4cad3', light: '#8d939d', mid: '#61666f', dark: '#3c3f46', deep: '#24262b' };
const R = { hi: '#e7d39c', light: '#cdb277', mid: '#a88d55', dark: '#6f5a30' };

// ---------------- face art (uv rects, px; a 1 px empty border keeps the crop exact, as chest_uv) ----------------
export const BALLISTA_UV = {
  beamS: [1, 1, 49, 9], beamT: [1, 11, 49, 19], end: [51, 1, 59, 9], iron: [61, 1, 77, 9], ironT: [61, 11, 77, 19],
  rope: [79, 1, 91, 25], railS: [1, 21, 57, 29], railT: [1, 31, 57, 39], post: [93, 1, 105, 25], frame: [107, 1, 119, 25],
  string: [121, 1, 125, 9], boltS: [59, 21, 103, 25], boltH: [105, 27, 119, 33], fletch: [121, 11, 135, 17],
  baseS: [1, 41, 61, 51], baseT: [1, 53, 61, 61], winch: [63, 41, 87, 51], dark: [89, 41, 99, 51], armS: [137, 1, 159, 7], armT: [137, 9, 159, 15],
};
const UW = 160, UH = 63;
function ballistaUV() {
  const U = BALLISTA_UV, rand = rng(9271);
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
    const knots = (r, n) => { for (let i = 0; i < n; i++) { g.fillStyle = 'rgba(58,32,12,0.5)'; g.beginPath(); g.ellipse(r[0] + 3 + rand() * (r[2] - r[0] - 6), r[1] + 2 + rand() * (r[3] - r[1] - 4), 1.3, 0.8, 0, 0, TAU); g.fill(); } };
    const band = (x, r, w = 3) => { g.fillStyle = I.mid; g.fillRect(x, r[1], w, r[3] - r[1]); g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x, r[1], 0.8, r[3] - r[1]); g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + w - 0.7, r[1], 0.7, r[3] - r[1]); g.fillStyle = I.hi; g.fillRect(x + w / 2 - 0.5, r[1] + 1, 1, 1); g.fillRect(x + w / 2 - 0.5, r[3] - 2, 1, 1); };
    const rivets = (r, step) => { for (let x = r[0] + 2; x < r[2] - 1; x += step) for (const y of [r[1] + 1.8, r[3] - 2.4]) { g.fillStyle = I.deep; g.beginPath(); circle(g, x + 0.3, y + 0.3, 0.8); g.fill(); g.fillStyle = I.hi; g.beginPath(); circle(g, x, y, 0.55); g.fill(); } };
    // beams: side (grain, a lit upper edge), top (lighter), end grain (rings)
    box(U.beamS, [[0, W.light], [0.5, W.mid], [1, W.dark]]); grain(U.beamS, 5); knots(U.beamS, 2);
    g.fillStyle = 'rgba(255,236,200,0.3)'; g.fillRect(U.beamS[0], U.beamS[1], 48, 1); edge(U.beamS);
    box(U.beamT, [[0, W.hi], [1, W.light]]); grain(U.beamT, 5); edge(U.beamT, 0.5);
    box(U.end, [[0, W.light], [1, W.dark]]);
    for (let k = 3; k > 0; k--) { g.strokeStyle = 'rgba(70,40,16,0.55)'; g.lineWidth = 0.6; g.beginPath(); g.ellipse(55, 5, k * 1.2, k * 1.1, 0, 0, TAU); g.stroke(); }
    edge(U.end);
    // iron plates (sides, tops)
    box(U.iron, [[0, I.light], [0.45, I.mid], [1, I.dark]]); rivets(U.iron, 5); edge(U.iron, 0.9);
    box(U.ironT, [[0, I.hi], [1, I.light]]); rivets(U.ironT, 5); edge(U.ironT, 0.8);
    box(U.dark, [[0, I.mid], [1, I.deep]]); edge(U.dark, 0.9);
    // rope skein: twisted strands running up
    box(U.rope, [[0, R.light], [0.5, R.mid], [1, R.dark]], true);
    g.strokeStyle = 'rgba(80,60,26,0.6)'; g.lineWidth = 0.9;
    for (let y = U.rope[1] - 2; y < U.rope[3] + 2; y += 2.2) { g.beginPath(); g.moveTo(U.rope[0], y); g.lineTo(U.rope[2], y + 3); g.stroke(); }
    g.strokeStyle = 'rgba(255,240,200,0.35)'; g.lineWidth = 0.5;
    for (let y = U.rope[1] - 1; y < U.rope[3] + 2; y += 2.2) { g.beginPath(); g.moveTo(U.rope[0] + 2, y); g.lineTo(U.rope[2] - 3, y + 2.2); g.stroke(); }
    band(U.rope[0], [U.rope[0], U.rope[1], U.rope[2], U.rope[1] + 3], 12); band(U.rope[0], [U.rope[0], U.rope[3] - 3, U.rope[2], U.rope[3]], 12);
    edge(U.rope, 0.6);
    // the stock: side with iron bands, top with the groove the bolt runs in
    box(U.railS, [[0, W.light], [0.5, W.mid], [1, W.dark]]); grain(U.railS, 4); band(U.railS[0] + 6, U.railS); band(U.railS[0] + 26, U.railS); band(U.railS[0] + 47, U.railS); edge(U.railS);
    box(U.railT, [[0, W.hi], [1, W.light]]); grain(U.railT, 3);
    g.fillStyle = W.deep; g.fillRect(U.railT[0], U.railT[1] + 3, 56, 2); g.fillStyle = 'rgba(255,230,190,0.35)'; g.fillRect(U.railT[0], U.railT[1] + 5, 56, 0.7);
    band(U.railT[0] + 6, U.railT); band(U.railT[0] + 26, U.railT); band(U.railT[0] + 47, U.railT); edge(U.railT, 0.5);
    // posts (vertical grain) and the frame posts (bands)
    box(U.post, [[0, W.light], [0.5, W.mid], [1, W.dark]], true); grain(U.post, 4, true); edge(U.post);
    box(U.frame, [[0, W.light], [0.5, W.mid], [1, W.dark]], true); grain(U.frame, 3, true);
    for (const y of [U.frame[1] + 2, U.frame[3] - 5]) { g.fillStyle = I.mid; g.fillRect(U.frame[0], y, 12, 3); g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(U.frame[0], y, 12, 0.8); }
    edge(U.frame);
    // bowstring, bolt shaft / head, leather fletching
    box(U.string, [[0, '#4a3b26'], [1, '#2a2116']], true);
    box(U.boltS, [[0, '#d7b07a'], [1, '#8a6034']]); g.fillStyle = '#5a3f22'; g.fillRect(U.boltS[0] + 30, U.boltS[1], 4, 4); edge(U.boltS, 0.5);
    box(U.boltH, [[0, I.hi], [0.5, I.light], [1, I.dark]]); edge(U.boltH, 0.8);
    box(U.fletch, [[0, '#a8452e'], [1, '#6a2416']]); g.strokeStyle = 'rgba(255,200,170,0.4)'; g.lineWidth = 0.6; for (let x = U.fletch[0] + 2; x < U.fletch[2]; x += 3) { g.beginPath(); g.moveTo(x, U.fletch[1]); g.lineTo(x - 2, U.fletch[3]); g.stroke(); } edge(U.fletch, 0.6);
    // base beams (heavier, darker, iron feet at the ends)
    box(U.baseS, [[0, W.mid], [0.6, W.dark], [1, W.deep]]); grain(U.baseS, 6); knots(U.baseS, 3);
    for (const x of [U.baseS[0], U.baseS[2] - 6]) { g.fillStyle = I.dark; g.fillRect(x, U.baseS[1], 6, 10); g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(x, U.baseS[1], 6, 0.8); }
    g.fillStyle = 'rgba(255,236,200,0.22)'; g.fillRect(U.baseS[0], U.baseS[1], 60, 1); edge(U.baseS);
    box(U.baseT, [[0, W.light], [1, W.mid]]); grain(U.baseT, 6);
    for (const x of [U.baseT[0], U.baseT[2] - 6]) { g.fillStyle = I.mid; g.fillRect(x, U.baseT[1], 6, 8); }
    edge(U.baseT, 0.6);
    // the windlass: a drum wrapped in rope
    box(U.winch, [[0, W.light], [0.5, W.mid], [1, W.deep]]);
    g.fillStyle = R.mid; g.fillRect(U.winch[0] + 4, U.winch[1] + 1, 16, 8);
    g.strokeStyle = 'rgba(80,60,26,0.7)'; g.lineWidth = 0.8; for (let x = U.winch[0] + 4; x < U.winch[0] + 20; x += 1.6) { g.beginPath(); g.moveTo(x, U.winch[1] + 1); g.lineTo(x + 0.8, U.winch[1] + 9); g.stroke(); }
    edge(U.winch);
    // the arms: smoothed, lighter wood with a leather wrap
    box(U.armS, [[0, W.hi], [0.6, W.light], [1, W.mid]]); grain(U.armS, 2); g.fillStyle = '#5a3a20'; g.fillRect(U.armS[0] + 2, U.armS[1], 4, 6); edge(U.armS, 0.6);
    box(U.armT, [[0, W.hi], [1, W.light]]); grain(U.armT, 2); edge(U.armT, 0.5);
  });
}

// ---------------- the front view (build menu icon, fallback until the model is ready) ----------------
function ballistaFront() {
  return spritePx(124, 84, (g, P) => {
    const cx = 62, gy = 78;
    // base: the cross of beams (seen from the front: the long beam, the front beam's end), feet
    P.layer((g) => {
      g.fillStyle = lin(g, 0, gy - 9, 0, gy, [[0, W.mid], [1, W.deep]]); g.fillRect(cx - 34, gy - 9, 68, 9);
      g.fillStyle = 'rgba(255,236,200,0.25)'; g.fillRect(cx - 34, gy - 9, 68, 1.2);
      g.fillStyle = I.dark; g.fillRect(cx - 36, gy - 10, 6, 10); g.fillRect(cx + 30, gy - 10, 6, 10);
      g.fillStyle = lin(g, 0, gy - 12, 0, gy, [[0, W.light], [1, W.dark]]); g.fillRect(cx - 6, gy - 12, 12, 12);
      g.fillStyle = lin(g, cx - 12, 0, cx + 12, 0, [[0, I.light], [1, I.dark]]); g.fillRect(cx - 12, gy - 15, 24, 4);
      g.fillStyle = lin(g, cx - 6, 0, cx + 6, 0, [[0, W.light], [1, W.dark]]); g.fillRect(cx - 5, gy - 34, 10, 20);
      g.fillStyle = I.mid; g.fillRect(cx - 9, gy - 40, 18, 7);
    }, 2.6);
    // the stock coming toward the viewer (foreshortened), the bolt head in the middle
    P.layer((g) => {
      g.fillStyle = lin(g, cx - 6, 0, cx + 6, 0, [[0, W.hi], [1, W.mid]]);
      g.beginPath(); g.moveTo(cx - 4, gy - 44); g.lineTo(cx + 4, gy - 44); g.lineTo(cx + 6, gy - 36); g.lineTo(cx - 6, gy - 36); g.closePath(); g.fill();
      g.fillStyle = W.deep; g.fillRect(cx - 1.5, gy - 44, 3, 8);
    }, 2.2);
    // the frame with its two rope skeins, the arms swept back, the string to the claw
    P.layer((g) => {
      g.fillStyle = lin(g, 0, gy - 64, 0, gy - 40, [[0, W.light], [1, W.dark]]);
      g.fillRect(cx - 16, gy - 62, 32, 4); g.fillRect(cx - 16, gy - 44, 32, 4); g.fillRect(cx - 16, gy - 62, 5, 22); g.fillRect(cx + 11, gy - 62, 5, 22);
      for (const s of [-1, 1]) {
        const x0 = cx + s * 8;
        g.fillStyle = lin(g, x0 - 3, 0, x0 + 3, 0, [[0, R.light], [1, R.dark]]); g.fillRect(x0 - 3, gy - 60, 6, 18);
        g.strokeStyle = 'rgba(80,60,26,0.6)'; g.lineWidth = 0.8; for (let y = gy - 59; y < gy - 42; y += 2.2) { g.beginPath(); g.moveTo(x0 - 3, y); g.lineTo(x0 + 3, y + 2); g.stroke(); }
        // arm: from the skein out and back, an iron tip
        g.fillStyle = lin(g, 0, gy - 56, 0, gy - 50, [[0, W.hi], [1, W.mid]]);
        g.beginPath(); g.moveTo(x0, gy - 55); g.lineTo(cx + s * 44, gy - 59); g.lineTo(cx + s * 45, gy - 54); g.lineTo(x0, gy - 50); g.closePath(); g.fill();
        g.fillStyle = I.mid; g.fillRect(cx + s * 44 - 3, gy - 60, 6, 7);
      }
      g.strokeStyle = '#2f2518'; g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(cx - 44, gy - 56); g.lineTo(cx, gy - 47); g.lineTo(cx + 44, gy - 56); g.stroke();
      g.fillStyle = lin(g, 0, gy - 50, 0, gy - 44, [[0, I.hi], [1, I.dark]]);
      g.beginPath(); g.moveTo(cx, gy - 52); g.lineTo(cx + 4, gy - 47); g.lineTo(cx, gy - 43); g.lineTo(cx - 4, gy - 47); g.closePath(); g.fill();
    }, 2.6);
  });
}

// the bolt as an icon (diagonal) and in flight (pointing east)
function boltShape(g, x0, x1, cy, s = 1) {
  g.fillStyle = lin(g, 0, cy - 1.6 * s, 0, cy + 1.6 * s, [[0, '#ddb67e'], [1, '#84592f']]); g.fillRect(x0 + 8 * s, cy - 1.5 * s, x1 - x0 - 18 * s, 3 * s);
  g.fillStyle = '#5a3f22'; g.fillRect(x0 + (x1 - x0) * 0.55, cy - 1.7 * s, 3 * s, 3.4 * s);
  g.fillStyle = lin(g, 0, cy - 4 * s, 0, cy + 4 * s, [[0, I.hi], [0.5, I.light], [1, I.dark]]);
  g.beginPath(); g.moveTo(x1, cy); g.lineTo(x1 - 12 * s, cy - 4 * s); g.lineTo(x1 - 10 * s, cy); g.lineTo(x1 - 12 * s, cy + 4 * s); g.closePath(); g.fill();
  g.fillStyle = '#a8452e';
  g.beginPath(); g.moveTo(x0, cy - 5 * s); g.lineTo(x0 + 13 * s, cy - 1.2 * s); g.lineTo(x0 + 4 * s, cy - 1.2 * s); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(x0, cy + 5 * s); g.lineTo(x0 + 13 * s, cy + 1.2 * s); g.lineTo(x0 + 4 * s, cy + 1.2 * s); g.closePath(); g.fill();
}
function boltIcon() {
  return spritePx(48, 48, (g, P) => P.layer((g) => { g.translate(24, 24); g.rotate(-Math.PI / 4); g.translate(-24, -24); boltShape(g, 1, 47, 24, 0.95); }, 2.2));
}
function boltProj() { return spritePx(80, 14, (g, P) => P.layer((g) => boltShape(g, 2, 78, 7, 1), 1.6)); }

lazyDef('ballista', ballistaFront, 0.5, 78 / 84);
lazyDef('ballista_uv', ballistaUV, 0, 0);
lazyDef('item_ballista_bolt', boltIcon, 0.5, 0.5);
lazyDef('proj_ballista_bolt', boltProj, 0.5, 0.5);

// ---------------- the model ----------------
const U = BALLISTA_UV, flipH = (r) => [r[2], r[1], r[0], r[3]], turn = (r) => [...r, 1];
const loaded = (o) => !(o._reload > 0);
const fired = (o) => o._reload > 0;
// the world angle the top points to: the eased shared aim (game/ballista.js), else the way the piece was built facing
const FACE_ANG = { s: Math.PI / 2, w: Math.PI, n: -Math.PI / 2, e: 0 };
const aimOf = (o) => o._aimD ?? o.aim ?? FACE_ANG[o.face || 's'] ?? Math.PI / 2;
// a beam across (along x) / along the stock (along y)
const across = (b, uvS = U.beamS, uvT = U.beamT, extra = {}) => ({ box: b, uv: { s: uvS, n: flipH(uvS), e: U.end, w: U.end, t: uvT }, ...extra });
const along = (b, uvS = U.railS, uvT = U.railT, extra = {}) => ({ box: b, uv: { s: U.end, n: U.end, e: uvS, w: flipH(uvS), t: turn(uvT) }, ...extra });
const ironBox = (b, extra = {}) => ({ box: b, uv: { s: U.iron, n: U.iron, e: U.iron, w: U.iron, t: U.ironT }, ...extra });
const upright = (b, uv, extra = {}) => ({ box: b, uv: { s: uv, n: uv, e: uv, w: uv, t: U.end }, ...extra });
// a ribbon (the bowstring) between two points, seen from both sides: two quads
const ribbon = (a, b, th, extra) => [
  { quad: [[a[0], a[1], a[2] + th], [b[0], b[1], b[2] + th], [b[0], b[1], b[2] - th], [a[0], a[1], a[2] - th]], uv: { q: U.string }, sh: false, ...extra },
  { quad: [[b[0], b[1], b[2] + th], [a[0], a[1], a[2] + th], [a[0], a[1], a[2] - th], [b[0], b[1], b[2] - th]], uv: { q: U.string }, sh: false, ...extra },
];
const SP = { spin: true };                 // (turning parts cast their sun shadow turned with them: art/faces/solid.js)
const SPN = { spin: true, sh: false };     // (thin / vanishing ones do not)

defineSolid('ballista', {
  ow: 0, uvS: 'ballista_uv',
  spin: aimOf, spinAt: [0, 0.5, 0],
  parts: [
    // ---- base (stays): a cross of heavy beams, iron feet, the turntable, the post ----
    across([-34, 34, 0.42, 0.58, 0, 8], U.baseS, U.baseT),
    along([-6, 6, 0.0, 1.0, 0, 8.8], U.baseS, U.baseT),
    ironBox([-36, -30, 0.4, 0.6, 0, 9.6]), ironBox([30, 36, 0.4, 0.6, 0, 9.6]),
    ironBox([-7.5, 7.5, -0.02, 0.06, 0, 10.2]), ironBox([-7.5, 7.5, 0.94, 1.02, 0, 10.2]),
    { box: [-13, 13, 0.3, 0.7, 8.8, 12.4], uv: { s: U.dark, n: U.dark, e: U.dark, w: U.dark, t: U.ironT } },
    upright([-5.5, 5.5, 0.41, 0.59, 12.4, 28], U.post),
    // ---- the top (turns with the aim) ----
    ironBox([-9.5, 9.5, 0.37, 0.63, 26.5, 34], SP),                          // yoke
    along([-6.5, 6.5, -0.08, 1.12, 33, 40], U.railS, U.railT, SP),          // the stock
    across([-18, 18, 0.85, 0.99, 31, 35.5], U.beamS, U.beamT, SP),          // frame: bottom / top beams, posts
    across([-18, 18, 0.85, 0.99, 56, 60.5], U.beamS, U.beamT, SP),
    upright([-18, -12.5, 0.85, 0.99, 35.5, 56], U.frame, SP), upright([12.5, 18, 0.85, 0.99, 35.5, 56], U.frame, SP),
    upright([-12, -5.5, 0.865, 0.975, 35.5, 56], U.rope, SP), upright([5.5, 12, 0.865, 0.975, 35.5, 56], U.rope, SP), // rope skeins
    // the arms: heavy beams out of the skeins, swept back, bound with iron where they leave the frame and at the tips
    across([-34, -11, 0.85, 0.985, 39.5, 52.5], U.armS, U.armT, SP), across([11, 34, 0.85, 0.985, 39.5, 52.5], U.armS, U.armT, SP),
    across([-52, -31, 0.785, 0.905, 41, 51], U.armS, U.armT, SP), across([31, 52, 0.785, 0.905, 41, 51], U.armS, U.armT, SP),
    ironBox([-23, -19.5, 0.84, 0.995, 38.8, 53.2], SPN), ironBox([19.5, 23, 0.84, 0.995, 38.8, 53.2], SPN),
    ironBox([-35, -31, 0.78, 0.99, 39.5, 52.5], SPN), ironBox([31, 35, 0.78, 0.99, 39.5, 52.5], SPN),   // (the elbow joint)
    ironBox([-58, -49, 0.755, 0.92, 39.5, 52.5], SP), ironBox([49, 58, 0.755, 0.92, 39.5, 52.5], SP),  // iron tips
    ironBox([-3.5, 3.5, 0.12, 0.25, 39.5, 43.5], SPN),                        // the claw that holds the string
    along([-11, 11, -0.12, 0.02, 32, 39], U.winch, U.winch, SP),               // windlass
    ironBox([-14.5, -11, -0.1, -0.01, 21, 43], SP), ironBox([11, 14.5, -0.1, -0.01, 21, 43], SP),
    // the operator's grips: two handles running back from the windlass brackets at hand height (game/ballista.js
    // seat: the operator stands 0.98 behind the post and holds them; art/compose.js 'operate' pose)
    along([-14.2, -10.4, -0.36, -0.08, 21.5, 25.5], U.armS, U.armT, SP), along([10.4, 14.2, -0.36, -0.08, 21.5, 25.5], U.armS, U.armT, SP),
    ironBox([-15, -9.6, -0.42, -0.34, 20.5, 26.5], SPN), ironBox([9.6, 15, -0.42, -0.34, 20.5, 26.5], SPN),
    // ---- loaded: the string pulled back to the claw and a bolt in the groove; fired: the string straight ----
    ...ribbon([-53, 0.83, 46.2], [0, 0.18, 41.5], 1.0, { ...SPN, vis: loaded }),
    ...ribbon([0, 0.18, 41.5], [53, 0.83, 46.2], 1.0, { ...SPN, vis: loaded }),
    ...ribbon([-53, 0.83, 46.2], [53, 0.83, 46.2], 1.0, { ...SPN, vis: fired }),
    along([-1.7, 1.7, 0.2, 1.22, 39.5, 42.6], U.boltS, U.boltS, { ...SPN, vis: loaded }),
    ironBox([-3, 3, 1.18, 1.38, 39, 43.2], { ...SPN, vis: loaded }),
    { box: [-0.6, 0.6, 0.22, 0.42, 39.5, 46], uv: { s: U.fletch, n: U.fletch, e: U.fletch, w: U.fletch, t: U.fletch }, ...SPN, vis: loaded },
  ],
  // a faint contact shade under the arms on the ground, turning with them (the sun shadow is the parts' own)
  fx: [{ at: [0, 0.5, 0], always: true, draw(B, A, o, t, x, y, lift, a) {
    const T = A.has('fx_blob') ? A.get('fx_blob') : null;
    if (!T || !B.blob || lift > 0.05) return;
    const g = aimOf(o), c = Math.cos(g), s = Math.sin(g), yaw = Math.atan2(CAMV.s, CAMV.c); // (screen angle = world angle − yaw)
    B.blob.add(T, x + c * 0.36, y + s * 0.36, 1.7, 0.34, 1, 1, 1, 0.16 * a, 0, g + Math.PI / 2 - yaw);
  } }],
  blob: [1.15, 0.78, 0.5, 0.42],
});
