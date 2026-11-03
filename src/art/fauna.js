// Wild fauna art (docs/FAUNA.md): the animals of the planet's biomes, from the livestock's small 3D model kit
// (art/livestock.js MODEL3D: ellipsoids ray-cast with cel shading, fur noise, body-space patterns and the painters'
// outline), so every view is the real animal seen from that side — the 3/4 views (se / ne; sw / nw mirrored) too.
//
// Body space: x forward, y left, z up; px (64 per tile, ~36 px per metre); origin = the ground under the body.
// Sprite names (anchor = the ground point under the body; art key = species, 'lion_m' for a male lion):
//   <key>_<v>               standing · v: e (side, facing right), se, s (front), ne, n (back); w / sw / nw mirrored
//   <key>_<v>_<frame>       frames of the body plan (FRAMES below): w0..w3 walk / trot, graze, atk, rest, sit,
//                           fly0..fly2 / glide (birds), s0..s3 (snakes slither), coil, swim (cut at the water line),
//                           jump (dolphins), dive (whale flukes)
//   <key>_dead              lying on its side (legs out, belly showing; scorpion, crab: on the back), one for every view
// Baked in the game atlas: <key>_e / _s / _n standing (the art contract, the corpses and the first frame); everything
// else is painted on demand into the lazy texture (art/lazyDefs.js, art/look/lazy.js), like the livestock frames.

import { lazyDef } from './lazyDefs.js';
import { MODEL3D } from './livestock.js';

const { E, seg, leg, boxOf, modelSprite, axesPYR, axesAlong, add3, sub3, mul3, mv, nrm3, col3, fbm3, vnoise, mixv, smooth, YAW } = MODEL3D;
const PI = Math.PI;
const fr = (v) => v - Math.floor(v);

// ---------- materials ----------
// M(col, { belly, fur, gloss, rough, bump, cool, tex }) — colours as '#hex' (cool: blue-grey shade, white fur)
function M(col, o = {}) {
  const m = { col: col3(col), fur: o.fur ?? 0.08 };
  if (o.belly) m.belly = col3(o.belly);
  if (o.gloss) m.gloss = o.gloss;
  if (o.rough) { m.rough = o.rough; m.bump = o.bump ?? 0.2; }
  if (o.cool) m.cool = true;
  if (o.tex) m.tex = o.tex;
  return m;
}
// patterns (body space: the same on every view and frame)
const stripes = (dark, w = 0.45) => (v) => (fr(v) < w ? dark : null);
function rosettes(dark, mid, sc = 5.5, seed = 0) {
  return (Pb) => {
    const n = fbm3(Pb[0] / sc + seed, Pb[1] / sc + 3.3, Pb[2] / sc + 1.1);
    return n > 0.66 ? dark : n > 0.6 ? null : n > 0.57 ? dark : n > 0.5 && fbm3(Pb[0] / 2.4, Pb[1] / 2.4, Pb[2] / 2.4) > 0.62 ? mid : null;
  };
}
const spots = (dark, sc = 3, th = 0.68) => (Pb) => (fbm3(Pb[0] / sc + 9.1, Pb[1] / sc, Pb[2] / sc + 4.4) > th ? dark : null);

// ---------- model helpers ----------
// a model = [parts, feats]; whole-model transforms (a rear, a pounce) keep both in step
function rotY(v, a) { const c = Math.cos(a), s = Math.sin(a); return [v[0] * c - v[2] * s, v[1], v[0] * s + v[2] * c]; } // pitch: + nose up
function pitchAbout(P, F, ang, pv) {
  if (!ang) return;
  for (const p of P) {
    p.c = add3(rotY(sub3(p.c, pv), ang), pv);
    p.R = p.R.map((ax) => rotY(ax, ang));
  }
  for (const f of F) f.c = add3(rotY(sub3(f.c, pv), ang), pv);
}
function shiftModel(P, F, d) { for (const p of P) p.c = add3(p.c, d); for (const f of F) f.c = add3(f.c, d); }
// a chain of beads along points (tails, trunks, necks, snakes): radius r0 → r1
function chainPts(P, pts, r0, r1, m, o = {}) {
  const n = pts.length - 1;
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0, r = r0 + (r1 - r0) * t;
    P.push(seg(pts[i], pts[i + 1], r, m, { g: o.g ?? 'chain', br: o.br ?? 2.4, edge: o.edge, wy: o.wy, wz: o.wz }));
  }
}
// a Bézier-ish curve through p0 → p1 → p2 (quadratic), n points
function curve(p0, p1, p2, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
    out.push([p0[0] * a + p1[0] * b + p2[0] * c, p0[1] * a + p1[1] * b + p2[1] * c, p0[2] * a + p1[2] * b + p2[2] * c]);
  }
  return out;
}
const eyeF = (c, r, col = '#15100c') => ({ c, r, col: col3(col), hl: true, on: 'head' });

// ---------- gaits ----------
// per leg [swing (rad, + forward), knee bend, lift px]; pairs A = (front left, hind right), B = (front right, hind left)
const WALK = {
  stand: { A: [0, 0, 0], B: [0, 0, 0] },
  w0: { A: [0.36, -0.05, 0], B: [-0.32, 0.12, 0] },
  w1: { A: [0.02, 0, 0], B: [0.14, 0.9, 4] },
  w2: { A: [-0.32, 0.12, 0], B: [0.36, -0.05, 0] },
  w3: { A: [0.14, 0.9, 4], B: [0.02, 0, 0] },
};

// =====================================================================================================================
// Quadrupeds — one builder, a spec per species
//   H barrel centre height · masses [[x, dz, ax, ay, az, mat?, pitch?]] (barrel, chest, rump, hump…; dz from H)
//   neck { b: [x, dz], t: [x, dz], r, r1, g: [x, z] (graze: the neck's top, z absolute), mid?: [x, dz] (a curved neck) }
//   head { a: [ax, ay, az], p (pitch, + nose up), gp (graze), o: [dx, dz] from the neck top, mz?: { o: [dx, dz], a, m },
//          eye: [dx, dy, dz, r, col?], ear?: { o: [dx, dy, dz], a, p, roll, m? }, nose?: [dx, dz, r] }
//   legs { f: { x, y, dz, ru, rl, k }, h: {…}, foot: { rx, ry, h, fx }, m: { u, l, h } }
//   tail { b: [x, dz], m: [x, dz], t: [x, dz], r, r1, tuft?: [ax, ay, az, mat], g?: [x, z] (graze / rest tip) }
//   coat, headM · atk: 'bite' | 'butt' | 'rear' | 'swipe' | 'tusk' · extras(P, F, ctx) (horns, manes, trunks…)
// =====================================================================================================================
function quad(S0, pose) {
  const S = S0.wide ? widen(S0) : S0;
  const P = [], F = [];
  const rest = pose.f === 'rest', sit = pose.f === 'sit';
  const atk = pose.f === 'atk' ? S.atk || 'bite' : null, dead = pose.f === 'dead';
  const graze = pose.f === 'graze';
  const fold = rest ? (S.restDrop ?? S.H * 0.55) : 0;
  const H = S.H - fold;
  for (const m of S.masses) {
    const [x, dz, ax, ay, az, mat, pt] = m;
    P.push(E([x, 0, H + dz], [ax, ay, az], mat || S.coat, { R: pt ? axesPYR(pt) : undefined, id: 'body' }));
  }
  // neck + head
  const N = S.neck, Hd = S.head;
  const nb = [N.b[0], 0, H + N.b[1]];
  let nt = graze ? [N.g[0], 0, N.g[1]] : [N.t[0], 0, H + N.t[1]];
  let hp = graze ? Hd.gp ?? -1.2 : Hd.p;
  if (atk === 'bite' || atk === 'swipe') { nt = [nt[0] + 3, 0, nt[2] - 3]; hp += 0.12; }
  else if (atk === 'butt') { nt = [nt[0] + 2, 0, nt[2] - (N.t[1] + 4) * 0.7]; hp = -1.35; }
  else if (atk === 'tusk') { hp -= 0.25; nt = [nt[0] + 2, 0, nt[2] - 4]; }
  if (rest && !S.restHeadUp) { nt = [nt[0] + 2, 0, Math.max(nt[2] - 4, 10)]; }
  if (dead) { nt = [nt[0] + 6, 0, H + N.b[1] * 0.6]; hp = -0.1; } // (stretched out along the ground)
  if (N.mid && !graze) {
    const md = [N.mid[0], 0, H + N.mid[1]];
    P.push(seg(nb, md, N.r, S.coat, { g: 'body', id: 'neck' }));
    P.push(seg(md, nt, N.r1 ?? N.r, S.coat, { g: 'body', id: 'neck' }));
  } else P.push(seg(nb, nt, N.r, S.coat, { g: 'body', id: 'neck', wy: N.wy, wz: N.wz }));
  const HA = axesPYR(hp);
  const hc = add3(nt, mv(HA, [Hd.o[0], 0, Hd.o[1]]));
  const headM = S.headM || S.coat;
  P.push(E(hc, Hd.a, headM, { R: HA, g: 'head', id: 'head', br: Hd.br ?? 2.6 }));
  let mzc = null;
  if (Hd.mz) {
    const ja = atk === 'bite' || atk === 'swipe' ? 1 : 0;
    mzc = add3(hc, mv(HA, [Hd.mz.o[0], 0, Hd.mz.o[1]]));
    P.push(E(mzc, Hd.mz.a, Hd.mz.m || headM, { R: HA, g: 'head', id: 'muzzle', br: 2 }));
    if (Hd.jaw) {
      // lower jaw: closed under the muzzle, dropped open when biting
      const JA = axesPYR(hp - 0.5 * ja);
      const jc = add3(hc, mv(JA, [Hd.jaw.o[0], 0, Hd.jaw.o[1]]));
      P.push(E(jc, Hd.jaw.a, Hd.jaw.m || headM, { R: JA, g: ja ? 'jaw' : 'head', id: 'jaw', br: 1.6 }));
      if (ja) P.push(E(add3(hc, mv(HA, [Hd.jaw.o[0] * 0.8, 0, (Hd.jaw.o[1] + Hd.mz.o[1]) * 0.5])), [Hd.jaw.a[0] * 0.7, Hd.jaw.a[1] * 0.75, 1.4], M('#5a1c1c', { fur: 0 }), { R: HA, g: 'mouth', br: 0.6 }));
    }
    if (Hd.nose) F.push({ c: add3(mzc, mv(HA, [Hd.nose[0], 0, Hd.nose[1]])), r: Hd.nose[2], col: col3(Hd.nose[3] || '#1c1512'), on: 'muzzle' });
  }
  const e = Hd.eye;
  for (const s of [1, -1]) F.push(eyeF(add3(hc, mv(HA, [e[0], s * e[1], e[2]])), e[3], e[4]));
  if (Hd.ear) {
    const Er = Hd.ear;
    for (const s of [1, -1]) {
      const c = add3(hc, mv(HA, [Er.o[0], s * Er.o[1], Er.o[2]]));
      P.push(E(c, Er.a, Er.m || headM, { R: axesPYR(hp * (Er.k ?? 0.3) + (Er.p || 0), 0, s * (Er.roll || 0)), g: 'ear', br: 1 }));
    }
  }
  // tail
  const T = S.tail;
  if (T) {
    const tb = [T.b[0], 0, H + T.b[1]];
    const tm = [T.m[0], 0, H + T.m[1]];
    let tt = [T.t[0], 0, H + T.t[1]];
    if ((rest || sit) && T.g) tt = [T.g[0], T.g[1], Math.max(2, T.g[2] - fold * 0.2)];
    if (atk && T.up) tt = [T.t[0] + 2, 0, H + T.t[1] + T.up];
    const pts = curve(tb, tm, tt, T.n || 3);
    chainPts(P, pts, T.r, T.r1 ?? T.r, T.mat || S.coat, { g: 'tail', br: 1.4 });
    if (T.tuft) P.push(E(tt, T.tuft.slice(0, 3), T.tuft[3], { R: axesAlong(sub3(tt, pts[pts.length - 2])), g: 'tail', br: 1.4 }));
  }
  // legs
  const L = S.legs, G = WALK[pose.f] || WALK.stand;
  for (const [front, side] of [[1, 1], [1, -1], [0, 1], [0, -1]]) {
    const D = front ? L.f : L.h;
    const hip = [D.x, side * D.y, H + D.dz];
    if (rest) {
      // folded: front legs forward along the ground, hind legs tucked under the haunch
      const z0 = Math.max(L.foot.h + 1, D.rl * 0.9);
      if (front) {
        const knee = [D.x + 2, side * (D.y + 1), z0 + 2], paw = [D.x + 12 + D.ru, side * D.y * 0.9, z0];
        P.push(seg(hip, knee, D.ru, L.m.u || S.coat, { g: 'legf' + side }));
        P.push(seg(knee, paw, D.rl, L.m.l || S.coat, { g: 'legf' + side }));
        P.push(E(add3(paw, [L.foot.fx + 1, 0, -z0 * 0.4]), [L.foot.rx, L.foot.ry, L.foot.h], L.m.h || L.m.l || S.coat, { g: 'foot', br: 0.6 }));
      } else {
        P.push(E([D.x + 2, side * (D.y + 3), z0 + D.ru * 1.2], [D.ru * 2.2, D.ru * 1.15, D.ru * 1.5], L.m.u || S.coat, { g: 'body' }));
        P.push(E([D.x + 10, side * (D.y + 2), z0 * 0.7], [D.rl * 2.6, D.rl, D.rl * 0.9], L.m.l || S.coat, { g: 'legh' + side }));
      }
      continue;
    }
    let pr = G[(front && side > 0) || (!front && side < 0) ? 'A' : 'B'];
    if (dead) pr = front ? [0.7 + side * 0.12, -0.15, 0] : [-0.75 - side * 0.1, 0.2, 0]; // (stiff legs splayed out)
    if (sit && !front) pr = [1.2, -2.0, 0];
    if (atk === 'rear' && front) pr = side > 0 ? [0.9, 1.4, 14] : [0.6, 1.2, 10];
    if (atk === 'swipe' && front && side > 0) pr = [1.1, 0.6, 9];
    const Lt = hip[2] - L.foot.h, ku = D.k ?? 0.5;
    leg(P, hip, Lt * ku, Lt * (1 - ku), D.ru, D.rl, pr[0] * (front ? 1 : 0.9), pr[1], pr[2], { u: L.m.u || S.coat, l: L.m.l || S.coat, h: L.m.h || L.m.l || S.coat }, !!front, L.foot);
  }
  if (S.extras) S.extras(P, F, { H, hc, HA, hp, nt, nb, pose, atk, graze, rest, mzc });
  // whole-body poses: rear (on the hind legs), a cat's sit
  if (atk === 'rear') pitchAbout(P, F, 0.38, [S.legs.h.x, 0, 0]);
  if (sit) pitchAbout(P, F, 0.55, [S.legs.h.x, 0, S.legs.h.ru]);
  return [P, F];
}

// S.wide: the body seen from the front / back made broader (chest, rump, legs apart; the head a bit) — a slender
// animal read as a sliver at the game's scale (the hand-painted deer / wolf front views are broad too)
const WIDE = new WeakMap();
function widen(S) {
  let o = WIDE.get(S);
  if (o) return o;
  const k = S.wide, hk = 1 + (k - 1) * 0.6, Hd = S.head;
  const y = (a, f) => (a ? [a[0], a[1] * f, a[2]] : a);
  o = {
    ...S,
    masses: S.masses.map((m) => [m[0], m[1], m[2], m[3] * k, m[4], m[5], m[6]]),
    neck: { ...S.neck, wy: (S.neck.wy ?? 1) * (1 + (k - 1) * 0.8) },
    head: { ...Hd, a: y(Hd.a, hk), eye: [Hd.eye[0], Hd.eye[1] * hk, ...Hd.eye.slice(2)], mz: Hd.mz && { ...Hd.mz, a: y(Hd.mz.a, hk) }, jaw: Hd.jaw && { ...Hd.jaw, a: y(Hd.jaw.a, hk) },
      ear: Hd.ear && { ...Hd.ear, o: y(Hd.ear.o, hk) } },
    legs: { ...S.legs, f: { ...S.legs.f, y: S.legs.f.y * k }, h: { ...S.legs.h, y: S.legs.h.y * k } },
  };
  WIDE.set(S, o);
  return o;
}
// a few fur tufts along an outline (soft shag at the edges instead of a bumpy coat): [x, y, z] points
function tufts(P, pts, m, a = [2.6, 2.2, 3]) {
  for (const p of pts) P.push(E(p, a, m, { R: axesPYR(p[3] || 0), g: 'body', br: 2.4, edge: false }));
}

// horns / antlers along a list of [x, y, z] points relative to the head (head axes)
function hornPts(P, ctx, pts, r0, r1, m, mirror = true) {
  for (const s of mirror ? [1, -1] : [1]) {
    const W = pts.map((p) => add3(ctx.hc, mv(ctx.HA, [p[0], s * p[1], p[2]])));
    chainPts(P, W, r0, r1, m, { g: 'horn', br: 0.8 });
  }
}

// ---------- colours ----------
const C = {
  tan: '#c49a62', sand: '#d8b27a', cream: '#efe7d6', white: '#f1eee6', grey: '#8f8c86', dark: '#2b2420', black: '#1c1816',
  horn: '#d9cfb5', hornD: '#3b3129', hoof: '#2e2620', pink: '#d99a90',
};
const HOOF = (c = C.hoof) => M(c, { fur: 0, gloss: 0.25 });

// =====================================================================================================================
// species (quadrupeds)
// =====================================================================================================================
const Q = {};

// --- wild horse (Przewalski-like: dun coat, dark legs and mane) ---
{
  const coat = M('#b98a52', { belly: '#e2c9a0', fur: 0.07 }), legD = M('#b98a52', { fur: 0.05, tex: (Pb) => (Pb[2] < 22 ? col3('#3a2c22') : null) }), mane = M('#3a2a20', { rough: 1.6, bump: 0.3, fur: 0.15 });
  Q.wild_horse = {
    wide: 1.25,
    H: 40, coat, atk: 'rear',
    masses: [[0, 0, 30, 12.5, 13], [19, 2, 14, 12, 14.5], [-20, 2, 14.5, 13, 14]],
    neck: { b: [24, 6], t: [38, 24], r: 8.2, g: [44, 12] },
    head: { a: [13, 5.6, 6.6], p: -1.05, gp: -1.5, o: [6, 0], mz: { o: [10, -1.5], a: [6.5, 5, 5.6], m: M('#e8d7bb', { fur: 0.04 }) }, nose: [5.5, 0, 1.3], eye: [-3.5, 5, 2.5, 1.6], ear: { o: [-10, 3.2, 5.5], a: [2, 1.4, 4.6], p: 0.5, roll: 0.2 } },
    legs: { f: { x: 20, y: 7, dz: -6, ru: 5, rl: 2.9 }, h: { x: -22, y: 7, dz: -4, ru: 6.2, rl: 3 }, foot: { rx: 3.4, ry: 3, h: 2.6, fx: 0.6 }, m: { u: legD, l: legD, h: HOOF() } },
    tail: { b: [-33, 8], m: [-39, 0], t: [-40, -14], r: 3.2, r1: 2.6, mat: mane, tuft: [4, 3.4, 9, mane] },
    extras(P, F, c) {
      // upright mane along the neck's top
      for (let i = 0; i <= 5; i++) { const t = i / 5, p = add3(add3(c.nb, mul3(sub3(c.nt, c.nb), t)), [-1.5, 0, 7 - t * 1.5]); P.push(E(p, [3.2, 1.4, 3], mane, { R: axesAlong(sub3(c.nt, c.nb)), g: 'mane', br: 1.6 })); }
    },
  };
}
// --- zebra (stripes in body space: vertical on the body, rings on the legs, along the neck) ---
{
  const K = col3('#1f1b19');
  const body = M('#f2efe8', { fur: 0.05, tex: (Pb) => (fr((Pb[0] + Math.sin(Pb[2] / 7) * 4) / 6.5) < 0.42 ? K : null) });
  const legM = M('#f2efe8', { fur: 0.05, tex: (Pb) => (fr(Pb[2] / 4.2) < 0.45 ? K : null) });
  const neckM = M('#f2efe8', { fur: 0.05, tex: (Pb) => (fr((Pb[0] * 0.8 - Pb[2] * 0.6) / 5.2) < 0.45 ? K : null) });
  const headM = M('#f2efe8', { fur: 0.04, tex: (Pb) => (fr((Pb[2] + Pb[0] * 0.25) / 3.4) < 0.4 ? K : null) });
  const mane = M('#f2efe8', { fur: 0.1, tex: (Pb) => (fr(Pb[0] / 2.6) < 0.5 ? K : null) });
  Q.zebra = {
    wide: 1.3,
    H: 36, coat: body, headM, atk: 'rear',
    masses: [[0, 0, 28, 12, 12.5], [18, 2, 13, 11.5, 13.5], [-19, 2, 14, 12.5, 13.5]],
    neck: { b: [22, 6], t: [35, 22], r: 7.8, g: [41, 11] },
    head: { a: [12, 5.2, 6.2], p: -1.0, gp: -1.5, o: [6, 0], mz: { o: [9.5, -1.5], a: [6, 4.8, 5.2], m: M('#2a2421', { fur: 0.03 }) }, nose: [5, 0, 1.2], eye: [-3, 4.6, 2.5, 1.5], ear: { o: [-9.5, 3, 5.5], a: [2.2, 1.5, 5.2], p: 0.5, roll: 0.25 } },
    legs: { f: { x: 18, y: 6.6, dz: -6, ru: 4.6, rl: 2.7 }, h: { x: -20, y: 6.6, dz: -4, ru: 5.8, rl: 2.8 }, foot: { rx: 3.2, ry: 2.8, h: 2.4, fx: 0.5 }, m: { u: legM, l: legM, h: HOOF() } },
    tail: { b: [-31, 8], m: [-36, 0], t: [-36, -12], r: 1.6, r1: 1.3, mat: M('#f2efe8', { fur: 0.05 }), tuft: [2.4, 2.4, 5, M('#1f1b19', { rough: 1.2 })] },
    extras(P, F, c) {
      for (let i = 0; i <= 5; i++) { const t = i / 5, p = add3(add3(c.nb, mul3(sub3(c.nt, c.nb), t)), [-1.5, 0, 6.6 - t * 1.4]); P.push(E(p, [3, 1.2, 3.2], mane, { R: axesAlong(sub3(c.nt, c.nb)), g: 'mane', br: 1.4 })); }
    },
  };
}
// --- gazelle (Thomson's: tan back, dark side band, white belly, lyre horns) ---
{
  const T0 = col3('#c98b4e'), Kb = col3('#2c211b'), Wb = col3('#f3ece0');
  const coat = M('#c98b4e', { fur: 0.06, tex: (Pb, p, a0, a1, a2) => (p.id === 'body' ? (a2 < -0.32 ? Wb : a2 < -0.12 && Math.abs(a1) > 0.5 ? Kb : null) : null) });
  Q.gazelle = {
    wide: 1.4,
    H: 23, coat, atk: 'butt',
    masses: [[0, 0, 17, 7, 7.5], [11, 1, 8.5, 6.6, 8.4], [-12, 1.5, 8.6, 7, 8.4]],
    neck: { b: [14, 4], t: [21, 15], r: 3.6, g: [26, 7] },
    head: { a: [7, 3.4, 4], p: -0.75, gp: -1.4, o: [3.5, 0], mz: { o: [5.5, -1.2], a: [3.6, 2.6, 2.8] }, nose: [3.1, 0, 0.7], eye: [-1, 3.1, 1.6, 1.15], ear: { o: [-5, 2.4, 3], a: [1.3, 0.9, 3.4], p: 0.2, roll: 0.75 } },
    legs: { f: { x: 11, y: 4.2, dz: -4, ru: 2.6, rl: 1.4 }, h: { x: -12, y: 4.2, dz: -3, ru: 3.6, rl: 1.5 }, foot: { rx: 1.8, ry: 1.5, h: 1.6, fx: 0.4 }, m: { l: M('#c98b4e', { fur: 0.04 }), h: HOOF() } },
    tail: { b: [-19, 5], m: [-22, 2], t: [-22, -3], r: 1.2, r1: 1.1, mat: M('#2c211b') },
    extras(P, F, c) {
      hornPts(P, c, [[-3, 1.6, 3], [-6, 2.6, 9], [-6.5, 2, 15], [-5, 1.4, 19]], 1.1, 0.6, M('#2a241f', { fur: 0.2, gloss: 0.2, tex: (Pb) => (fr(Pb[2] / 1.6) < 0.3 ? col3('#5a4c40') : null) }));
      // white rump and face blaze
      P.push(E([-21.5, 0, c.H + 2], [1.6, 5.4, 5.6], M('#f3ece0'), { g: 'body' }));
    },
  };
}
// --- reindeer (grey-brown, pale neck and belly, big branched antlers) ---
{
  const coat = M('#7d6a55', { belly: '#d9d0c0', fur: 0.1, tex: (Pb, p, a0, a1, a2) => (p.id === 'neck' ? col3('#d8cfbf') : null) });
  const pale = M('#d9d0c0', { rough: 1.6, fur: 0.12 });
  const antler = M('#c9b48c', { fur: 0.08, gloss: 0.15 });
  Q.reindeer = {
    wide: 1.25,
    H: 30, coat, atk: 'butt',
    masses: [[0, 0, 22, 10, 10.5], [14, 2, 10.5, 9.6, 11.5], [-15, 1.5, 11, 10, 11]],
    neck: { b: [17, 6], t: [27, 16], r: 6.2, g: [33, 8] },
    head: { a: [9, 4.5, 5.2], p: -0.6, gp: -1.4, o: [4, 0], mz: { o: [6.5, -1.2], a: [4.4, 3.8, 3.8], m: M('#9a8a77') }, nose: [3.6, 0, 1], eye: [-2, 4, 2.2, 1.3], ear: { o: [-6, 3.3, 3], a: [1.6, 1, 3.4], p: -0.1, roll: 0.9 } },
    legs: { f: { x: 14, y: 5.6, dz: -5, ru: 3.8, rl: 2.2 }, h: { x: -15, y: 5.6, dz: -3, ru: 4.8, rl: 2.3 }, foot: { rx: 3, ry: 2.8, h: 2, fx: 0.5 }, m: { l: M('#5e5044'), h: HOOF() } },
    tail: { b: [-25, 6], m: [-27, 4], t: [-27, 0], r: 2.2, r1: 1.8, mat: pale },
    extras(P, F, c) {
      // pale mane under the neck
      P.push(E(add3(c.nb, mul3(sub3(c.nt, c.nb), 0.45)), [5, 5.5, 6], pale, { R: axesAlong(sub3(c.nt, c.nb)), g: 'body' }));
      // antlers: a main beam back and up, then forward, with tines; a brow tine over the face
      const beam = [[-4, 2, 4], [-9, 6, 12], [-10, 9, 22], [-6, 10, 31], [0, 8, 36]];
      hornPts(P, c, beam, 1.2, 0.7, antler);
      for (const [a, b] of [[[-9.5, 7.5, 18], [-15, 9, 24]], [[-8, 10, 27], [-12, 13, 34]], [[-3, 9.5, 33], [-2, 13, 40]], [[-3, 3, 5], [6, 1.5, 8]]]) hornPts(P, c, [a, b], 0.75, 0.5, antler);
    },
  };
}
// --- moose (dark brown, humped shoulders, long drooping muzzle, bell, palmate antlers) ---
{
  const coat = M('#4a3528', { belly: '#3a2a20', fur: 0.1 });
  const legM = M('#9a8a78', { fur: 0.06 });
  const antler = M('#b39d78', { fur: 0.12, gloss: 0.1 });
  Q.moose = {
    wide: 1.12,
    H: 50, coat, atk: 'rear',
    masses: [[0, 0, 30, 13.5, 15], [17, 5, 16, 13, 18], [-20, 1, 14, 13.5, 15]],
    neck: { b: [27, 9], t: [40, 15], r: 9.5, g: [48, 14] },
    head: { a: [14, 6, 7.2], p: -0.55, gp: -1.3, o: [7, -1], mz: { o: [10, -3], a: [8, 5.6, 6.4], m: M('#3d2c22') }, nose: [6, -0.5, 1.6], eye: [-4, 5.4, 3, 1.6], ear: { o: [-10, 4, 5], a: [2.6, 1.5, 5], p: 0.1, roll: 0.9 } },
    legs: { f: { x: 19, y: 7.6, dz: -7, ru: 5.4, rl: 3.1 }, h: { x: -21, y: 7.6, dz: -4, ru: 6.6, rl: 3.1 }, foot: { rx: 3.8, ry: 3.4, h: 2.8, fx: 0.6 }, m: { u: coat, l: legM, h: HOOF() } },
    tail: { b: [-33, 8], m: [-35, 6], t: [-35, 2], r: 2.4, r1: 2, mat: coat },
    extras(P, F, c) {
      // bell (dewlap) under the throat
      P.push(E(add3(c.hc, mv(c.HA, [-4, 0, -9])), [2.2, 1.4, 6], coat, { R: c.HA, g: 'head', br: 1 }));
      // palmate antlers: a flat palm out to each side with points along the rim
      for (const s of [1, -1]) {
        const base = add3(c.hc, mv(c.HA, [-7, s * 3.5, 5])), out = add3(c.hc, mv(c.HA, [-8, s * 13, 9]));
        chainPts(P, [base, out], 1.6, 1.4, antler, { g: 'horn', br: 1 });
        const pc = add3(c.hc, mv(c.HA, [-9, s * 18, 13]));
        P.push(E(pc, [9, 7.5, 1.4], antler, { R: axesPYR(0.35, 0, s * 0.75), g: 'horn', br: 1 }));
        for (let i = 0; i < 5; i++) { const a = -1.1 + i * 0.5, b0 = add3(pc, [Math.cos(a) * 6.5, s * 3, 4 + Math.sin(a) * 5]); P.push(seg(b0, add3(b0, [Math.cos(a) * 4.5, s * 2.5, 3 + Math.sin(a) * 3]), 0.9, antler, { g: 'horn', br: 0.6 })); }
      }
    },
  };
}
// --- bison (huge shaggy front, small hindquarters, low head, short horns) ---
{
  const shag = M('#3a2a1e', { rough: 2.6, bump: 0.12, fur: 0.16 }), coat = M('#5b4231', { belly: '#4a3626', fur: 0.12 });
  Q.bison = {
    H: 34, coat, atk: 'butt',
    masses: [[0, 1, 30, 13, 14, coat], [16, 8, 18, 14.5, 20, shag, 0.2], [-19, 0, 13, 12, 13, coat], [24, -2, 10, 12, 14, shag]],
    neck: { b: [28, 2], t: [36, -2], r: 11, g: [40, 9], wz: 1.2 },
    head: { a: [11, 9, 10], p: -1.25, gp: -1.45, o: [4, -2], mz: { o: [8, -1], a: [5.4, 6.4, 5.6], m: M('#2a2019') }, nose: [4.5, 0, 1.5], eye: [0, 7.6, 2.6, 1.5], ear: { o: [-2, 8.6, 3], a: [2.2, 1.4, 3], p: -0.3, roll: 1.2, m: shag } },
    legs: { f: { x: 20, y: 7.6, dz: -6, ru: 5.6, rl: 3.4 }, h: { x: -20, y: 7, dz: -3, ru: 5.4, rl: 3 }, foot: { rx: 3.6, ry: 3.4, h: 2.4, fx: 0.6 }, m: { u: shag, l: M('#33261c'), h: HOOF() } },
    tail: { b: [-31, 6], m: [-34, 2], t: [-34, -8], r: 1.5, r1: 1.2, mat: coat, tuft: [2.2, 2.2, 4, shag] },
    extras(P, F, c) {
      hornPts(P, c, [[-3, 7, 5], [-2, 12, 7], [0, 13, 11]], 1.6, 0.8, M('#cfc4ae', { fur: 0, gloss: 0.3, tex: (Pb) => (Math.abs(Pb[1]) > 10 ? col3('#2a221c') : null) }));
      P.push(E(add3(c.hc, mv(c.HA, [-1, 0, 7])), [8, 9, 6], shag, { R: c.HA, g: 'head', br: 2 })); // shaggy crown
      P.push(E(add3(c.hc, mv(c.HA, [4, 0, -9])), [4, 4, 6], shag, { R: c.HA, g: 'head', br: 2 })); // beard
    },
  };
}
// --- yak (long dark hair skirt, wide horns, white face variant via tint) ---
{
  const hair = M('#2e2622', { rough: 3, bump: 0.12, fur: 0.16 }), coat = M('#3a302a', { fur: 0.12 });
  Q.yak = {
    H: 33, coat: hair, atk: 'butt',
    masses: [[0, 0, 28, 13, 13], [16, 5, 15, 12.5, 16, hair, 0.2], [-18, 1, 14, 13, 13.5], [0, -9, 27, 14.5, 7, hair]],
    neck: { b: [24, 4], t: [33, 4], r: 9.5, g: [39, 9] },
    head: { a: [10.5, 7, 8], p: -0.95, gp: -1.4, o: [4, -1], mz: { o: [7.5, -1.5], a: [5, 5.4, 5], m: M('#cfc6b8', { fur: 0.05 }) }, nose: [4, 0, 1.3], eye: [-1, 6.2, 2.4, 1.4], ear: { o: [-4, 7, 1.5], a: [2.2, 1.3, 3], p: -0.4, roll: 1.3, m: coat } },
    legs: { f: { x: 18, y: 7.6, dz: -6, ru: 5.4, rl: 3.2 }, h: { x: -19, y: 7.6, dz: -3, ru: 5.8, rl: 3.1 }, foot: { rx: 3.4, ry: 3.2, h: 2.4, fx: 0.6 }, m: { u: hair, l: coat, h: HOOF() } },
    tail: { b: [-29, 6], m: [-34, 0], t: [-34, -12], r: 3.4, r1: 3.6, mat: hair },
    extras(P, F, c) {
      hornPts(P, c, [[-4, 5, 4], [-2, 12, 6], [1, 16, 11], [0, 15, 16]], 1.8, 0.7, M('#e0d6c2', { fur: 0, gloss: 0.25 }));
      for (const s of [1, -1]) for (let i = 0; i < 4; i++) P.push(E([14 - i * 10, s * 12, c.H - 12], [6, 2.5, 6], hair, { g: 'body', br: 3, edge: false }));
    },
  };
}
// --- camel (dromedary: one hump, long curved neck, long legs) ---
{
  const coat = M('#c99e6a', { belly: '#dcbf96', fur: 0.07 });
  Q.camel = {
    wide: 1.2,
    H: 50, coat, atk: 'bite', restDrop: 34, restHeadUp: true,
    masses: [[0, 0, 24, 11, 11], [13, 1, 12, 10, 12], [-15, 1, 12, 10.5, 11.5], [-1, 13, 13, 9, 12]],
    neck: { b: [18, 0], mid: [32, 6], t: [36, 22], r: 6.2, r1: 4.8, g: [40, 8] },
    head: { a: [9, 4.2, 5], p: -0.15, gp: -1.2, o: [5, 0], mz: { o: [7, -1], a: [5, 3.6, 3.8] }, jaw: { o: [5, -3.5], a: [4.5, 2.8, 1.6] }, nose: [4.5, 0, 0.9], eye: [-1.5, 3.8, 2.2, 1.3], ear: { o: [-6.5, 3, 3], a: [1.4, 1, 2.4], p: 0.1, roll: 0.6 } },
    legs: { f: { x: 14, y: 5.6, dz: -6, ru: 4, rl: 2.2, k: 0.48 }, h: { x: -15, y: 5.6, dz: -4, ru: 4.8, rl: 2.2 }, foot: { rx: 3.8, ry: 3.4, h: 1.8, fx: 0.4 }, m: { l: M('#bc9260'), h: M('#7a6248', { fur: 0.05 }) } },
    tail: { b: [-26, 4], m: [-29, -2], t: [-28, -14], r: 1.6, r1: 1.2, tuft: [2, 2, 4, M('#6b4f35', { rough: 1.2 })] },
  };
}
// --- mountain goat (shaggy white, beard, short black horns) ---
{
  const wool = M('#ece6da', { fur: 0.14, cool: true }), dark = M('#2a2420', { fur: 0, gloss: 0.3 });
  Q.mountain_goat = {
    wide: 1.2,
    H: 28, coat: wool, atk: 'butt',
    masses: [[0, 0, 18, 8.6, 9], [11, 3, 9.5, 8.2, 11], [-12, 1, 9, 8.2, 9]],
    neck: { b: [15, 5], t: [21, 13], r: 5.8, g: [26, 7] },
    head: { a: [7.4, 4, 5], p: -0.55, gp: -1.35, o: [3.5, 0], mz: { o: [5.2, -1.2], a: [3.6, 2.8, 3] }, nose: [3, 0, 0.8], eye: [-1, 3.6, 1.7, 1.1], ear: { o: [-4.5, 3.2, 2.2], a: [1.3, 0.9, 2.8], p: -0.2, roll: 1.1 } },
    legs: { f: { x: 12, y: 4.6, dz: -4, ru: 3.6, rl: 2.1 }, h: { x: -12, y: 4.6, dz: -3, ru: 4, rl: 2.1 }, foot: { rx: 2.4, ry: 2.2, h: 1.6, fx: 0.4 }, m: { l: M('#ece6da', { fur: 0.08 }), h: dark } },
    tail: { b: [-20, 4], m: [-21, 3], t: [-21, 0], r: 1.8, r1: 1.6 },
    extras(P, F, c) {
      hornPts(P, c, [[-2.5, 1.8, 3.5], [-5, 2.4, 8.5], [-8.5, 2.4, 11]], 1.2, 0.5, dark);
      P.push(E([5, 0, c.H + 5], [8, 8, 7], wool, { g: 'body', br: 3 })); // shoulder hump
      tufts(P, [[-8, 0, c.H - 8, 0.2], [0, 0, c.H - 8.5, 0], [8, 0, c.H - 8, -0.2], [13, 0, c.H - 4, -0.5]], wool, [2.6, 8.6, 3]); // the long hair under the belly
      P.push(E(add3(c.hc, mv(c.HA, [2.5, 0, -5])), [1.8, 1.8, 4], wool, { R: c.HA, g: 'head', br: 1 })); // beard
    },
  };
}
// --- elephant (African: big ears, trunk, tusks, wrinkled grey skin) ---
{
  const skin = M('#8a8580', { fur: 0.1, tex: (Pb) => (fr(Pb[2] / 3.2 + vnoise(Pb[0] / 6, Pb[1] / 6, 0) * 0.8) < 0.12 ? col3('#77726d') : null) });
  const tusk = M('#efe6d0', { fur: 0, gloss: 0.3 });
  Q.elephant = {
    H: 78, coat: skin, atk: 'tusk',
    masses: [[0, 2, 38, 22, 23], [24, 6, 21, 21, 24], [-24, 2, 20, 21, 22]],
    neck: { b: [36, 12], t: [46, 12], r: 15, g: [52, 30] },
    head: { a: [20, 16, 21], p: -0.2, gp: -0.55, o: [7, 4], br: 4, eye: [7, 13, 3, 1.8, '#2a1c14'] },
    legs: { f: { x: 26, y: 12, dz: -14, ru: 10, rl: 8.6 }, h: { x: -27, y: 12, dz: -12, ru: 10.8, rl: 8.6 }, foot: { rx: 9, ry: 8.8, h: 3, fx: 0.4 }, m: { h: M('#b8b0a2', { fur: 0.04 }) } },
    tail: { b: [-44, 14], m: [-48, 6], t: [-47, -16], r: 1.4, r1: 1.2, tuft: [2, 2, 5, M('#2b2622', { rough: 1.2 })] },
    extras(P, F, c) {
      // ears: big flat flaps from the side of the head, out wide when threatening
      const wide = c.atk ? 0.75 : 0.25;
      for (const s of [1, -1]) {
        const ec = add3(c.hc, mv(c.HA, [-10, s * 18, 2]));
        P.push(E(ec, [18, 3.2, 26], M('#7c7772', { fur: 0.08 }), { R: axesPYR(-0.1, s * (wide + 0.15), s * 0.2), g: 'ear', br: 1.5 }));
      }
      // trunk: down from the face, curled up when threatening / reaching to the ground when grazing
      const t0 = add3(c.hc, mv(c.HA, [14, 0, -4]));
      const tip = c.atk ? add3(t0, [16, 0, 18]) : c.graze ? [t0[0] + 8, 0, 3] : add3(t0, [6, 0, -62]);
      const mid = c.atk ? add3(t0, [16, 0, -10]) : c.graze ? [t0[0] + 10, 0, t0[2] * 0.4] : add3(t0, [7, 0, -24]);
      chainPts(P, curve(t0, mid, tip, 12), 7.5, 3.4, skin, { g: 'trunk', br: 4 });
      // tusks
      for (const s of [1, -1]) chainPts(P, curve(add3(c.hc, mv(c.HA, [10, s * 6, -10])), add3(c.hc, mv(c.HA, [22, s * 7, -22])), add3(c.hc, mv(c.HA, [32, s * 5, -16])), 3), 2.6, 1.6, tusk, { g: 'tusk', br: 0.8 });
    },
  };
}
// --- lion (tawny; the male with a dark mane: art key lion_m) ---
function lionSpec(male) {
  const coat = M('#c49556', { belly: '#e1c49a', fur: 0.08 });
  const mane = M(male ? '#5e3a1e' : '#c49556', { rough: 2, fur: 0.18 });
  return {
    wide: 1.15,
    H: 30, coat, atk: 'swipe', restDrop: 19,
    masses: [[0, 0, 26, 10.5, 10.5], [16, 1, 12, 10, 12], [-17, 1, 12, 10, 11]],
    neck: { b: [22, 3], t: [30, 10], r: 7.5, g: [36, 8] },
    head: { a: [8.4, 7.4, 7.6], p: -0.15, gp: -0.9, o: [4, 0], mz: { o: [6.5, -2.2], a: [4.6, 4.8, 4], m: M('#e6d2b0') }, jaw: { o: [5, -5.4], a: [4, 3.8, 1.6] }, nose: [4, 1, 1.4, '#3a2622'], eye: [3, 4.4, 2.6, 1.4, '#3a2a10'], ear: { o: [-3, 5.4, 6], a: [2.4, 1.4, 2.6], p: -0.3, roll: 0.6 } },
    legs: { f: { x: 16, y: 6.4, dz: -4, ru: 5, rl: 3.6 }, h: { x: -18, y: 6.4, dz: -3, ru: 5.8, rl: 3.4 }, foot: { rx: 4.6, ry: 3.8, h: 2.2, fx: 1.4 }, m: { h: M('#c49556', { fur: 0.05 }) } },
    tail: { b: [-27, 5], m: [-38, 0], t: [-44, -8], r: 1.8, r1: 1.4, tuft: [2.6, 2.6, 3.6, M('#3a2618', { rough: 1.2 })], g: [-36, -10, 2], up: 6, n: 4 },
    extras(P, F, c) {
      if (!male) return;
      // the mane: around the head and down the neck and chest
      P.push(E(add3(c.hc, mv(c.HA, [-3, 0, 0.5])), [9, 12, 12], mane, { R: c.HA, g: 'mane', br: 3 }));
      P.push(E(add3(c.nb, mul3(sub3(c.nt, c.nb), 0.55)), [9, 10.5, 11], mane, { R: axesAlong(sub3(c.nt, c.nb)), g: 'mane', br: 3 }));
      P.push(E([17, 0, c.H - 4], [7, 8, 10], mane, { g: 'mane', br: 3 }));
    },
  };
}
Q.lion = lionSpec(false);
Q.lion_m = lionSpec(true);
// --- jaguar (stocky, rosettes) ---
{
  const coat = M('#d39a48', { belly: '#f0e2c6', fur: 0.07, tex: rosettes(col3('#2a1c12'), col3('#9a6328'), 5) });
  const headM = M('#d39a48', { fur: 0.06, tex: spots(col3('#2a1c12'), 1.6, 0.66) });
  Q.jaguar = {
    wide: 1.15,
    H: 21, coat, headM, atk: 'swipe', restDrop: 13,
    masses: [[0, 0, 20, 8.5, 8.5], [12, 1, 9.5, 8, 9.5], [-13, 1, 9.5, 8, 9]],
    neck: { b: [17, 2], t: [23, 6], r: 6.2, g: [28, 6] },
    head: { a: [7, 6.4, 6], p: -0.15, gp: -0.9, o: [3.5, 0], mz: { o: [5.4, -1.8], a: [3.6, 4, 3.2], m: M('#efdcbc') }, jaw: { o: [4, -4.4], a: [3.2, 3.2, 1.3] }, nose: [3.2, 0.8, 1.1, '#3a2622'], eye: [2.4, 3.8, 2.2, 1.2, '#5a4a10'], ear: { o: [-2.5, 4.6, 4.6], a: [1.8, 1.1, 2], p: -0.2, roll: 0.55 } },
    legs: { f: { x: 13, y: 5.4, dz: -3, ru: 4.4, rl: 3.2 }, h: { x: -14, y: 5.4, dz: -2, ru: 5, rl: 3 }, foot: { rx: 4, ry: 3.4, h: 2, fx: 1.2 }, m: { h: M('#d39a48', { fur: 0.05 }) } },
    tail: { b: [-21, 4], m: [-31, -2], t: [-36, -10], r: 2.2, r1: 1.7, mat: coat, g: [-30, -10, 2], up: 5, n: 4 },
  };
}
// --- lynx (grey-tan, long legs, bobtail, ear tufts, ruff) ---
{
  const coat = M('#a8937a', { belly: '#e6ddcf', fur: 0.12, tex: spots(col3('#6a5642'), 2.4, 0.7) });
  Q.lynx = {
    wide: 1.25,
    H: 19, coat, atk: 'swipe', restDrop: 11,
    masses: [[0, 0, 15, 7, 7.2], [9, 1, 7.6, 6.8, 8], [-10, 1.5, 8, 7, 8]],
    neck: { b: [13, 2], t: [18, 7], r: 5, g: [22, 5] },
    head: { a: [5.6, 5.4, 5], p: -0.1, gp: -0.9, o: [3, 0], mz: { o: [4.2, -1.6], a: [2.8, 3.2, 2.6], m: M('#e8e0d2') }, jaw: { o: [3.2, -3.6], a: [2.6, 2.6, 1.1] }, nose: [2.6, 0.6, 0.9, '#3a2622'], eye: [2, 3.2, 1.8, 1.05, '#8a7a20'], ear: { o: [-1.8, 3.6, 4.4], a: [1.4, 0.9, 2.6], p: 0, roll: 0.35 } },
    legs: { f: { x: 9.5, y: 4.4, dz: -3, ru: 3.2, rl: 2.4 }, h: { x: -10, y: 4.4, dz: -2, ru: 3.8, rl: 2.4 }, foot: { rx: 3.6, ry: 3, h: 1.8, fx: 1 }, m: { h: M('#c8b8a2', { fur: 0.1 }) } },
    tail: { b: [-16, 4], m: [-19, 4], t: [-21, 2], r: 2, r1: 1.8, tuft: [1.6, 1.6, 1.6, M('#1e1a16')] },
    extras(P, F, c) {
      for (const s of [1, -1]) P.push(seg(add3(c.hc, mv(c.HA, [-1.8, s * 3.7, 6.8])), add3(c.hc, mv(c.HA, [-1.6, s * 3.5, 10.5])), 0.45, M('#1e1a16', { fur: 0 }), { g: 'tuft', br: 0.3 }));
      for (const s of [1, -1]) P.push(E(add3(c.hc, mv(c.HA, [0.5, s * 4.6, -2.2])), [2.6, 2, 3], M('#e2d8c8', { rough: 1, fur: 0.12 }), { R: c.HA, g: 'head', br: 1.4 })); // ruff
    },
  };
}
// --- polar bear (cream white, long neck, small head, big paws) ---
{
  const fur = M('#efebe0', { belly: '#e2dccd', fur: 0.12, cool: true });
  Q.polar_bear = {
    H: 33, coat: fur, atk: 'rear', restDrop: 20,
    masses: [[0, 1, 30, 14, 14.5], [17, 0, 14, 13, 14.5], [-19, 2, 15, 14, 15]],
    neck: { b: [24, 2], t: [35, 5], r: 9.4, g: [42, 10] },
    head: { a: [10.5, 7.8, 7.6], p: -0.25, gp: -1, o: [6, 0], mz: { o: [8.5, -1.5], a: [6, 5, 4.6], m: fur }, jaw: { o: [7, -4.2], a: [5, 4, 1.6] }, nose: [5.6, 0.4, 1.9, '#141010'], eye: [1, 6, 3, 1.35, '#141010'], ear: { o: [-4.5, 5.6, 5.8], a: [2.2, 1.4, 2.2], p: 0, roll: 0.5 } },
    legs: { f: { x: 19, y: 8.4, dz: -6, ru: 6.6, rl: 5.4 }, h: { x: -21, y: 8.4, dz: -3, ru: 7.4, rl: 5.4 }, foot: { rx: 6.4, ry: 5, h: 2.4, fx: 1.4 }, m: { h: M('#e2dccb', { rough: 1.4 }) } },
    tail: { b: [-33, 6], m: [-35, 5], t: [-35, 3], r: 2.4, r1: 2.2 },
    wide: 1.1,
    extras(P, F, c) {
      // shaggy edges: the belly fringe, behind the legs, the neck
      const H = c.H;
      tufts(P, [[-28, 0, H + 8, 0.8], [26, 0, H + 9, -0.6]], fur, [3.2, 9.5, 2.6]);
    },
  };
}
// --- arctic fox (white winter coat, bushy tail, small ears) ---
{
  const fur = M('#f2efe8', { belly: '#e8e4dc', fur: 0.12, cool: true });
  Q.arctic_fox = {
    H: 13, coat: fur, atk: 'bite', restDrop: 7,
    masses: [[0, 0, 11, 5.2, 5.4], [7, 1, 5.6, 5, 6], [-7, 1, 5.8, 5, 5.6]],
    neck: { b: [9, 2], t: [13, 6], r: 3.8, g: [17, 4] },
    head: { a: [4.2, 3.6, 3.4], p: -0.05, gp: -0.9, o: [2.4, 0], mz: { o: [3.6, -1.1], a: [2.6, 1.7, 1.6] }, jaw: { o: [2.8, -2.2], a: [2.4, 1.4, 0.8] }, nose: [2.5, 0, 0.8, '#141010'], eye: [1.4, 2.4, 1.3, 0.9], ear: { o: [-1.6, 2.4, 3.2], a: [1.1, 0.8, 1.7], p: 0, roll: 0.3 } },
    legs: { f: { x: 7, y: 3, dz: -2, ru: 2.2, rl: 1.5 }, h: { x: -7.5, y: 3, dz: -1, ru: 2.6, rl: 1.5 }, foot: { rx: 2, ry: 1.7, h: 1, fx: 0.7 }, m: {} },
    tail: { b: [-11, 2], m: [-17, 1], t: [-21, -3], r: 3.2, r1: 3.6, n: 3, g: [-12, -9, 2] },
    wide: 1.4,
    extras(P, F, c) { tufts(P, [[-6, 0, c.H - 5.5, 0.3], [2, 0, c.H - 5.8, 0], [9, 0, c.H - 1, -0.6]], fur, [1.8, 4.6, 1.8]); },
  };
}
// --- monkey (a macaque-like troop monkey: brown, pink face, long tail; walks on all fours, sits) ---
{
  const coat = M('#7a5a3a', { belly: '#a88a68', fur: 0.12 }), face = M('#d9a088', { fur: 0.02 });
  Q.monkey = {
    wide: 1.2,
    H: 14, coat, atk: 'bite', restDrop: 6,
    masses: [[0, 1, 9, 5, 5.6, coat, 0.35], [5, 3, 5.6, 5, 6, coat, 0.3], [-6, 0, 5.4, 5, 5.4]],
    neck: { b: [7, 6], t: [9.5, 9], r: 3, g: [13, 5] },
    head: { a: [4.4, 4.2, 4.4], p: 0, gp: -0.7, o: [1.8, 1], mz: { o: [3.2, -1.4], a: [2, 2.6, 2], m: face }, eye: [3, 1.5, 0.8, 0.8], ear: { o: [-0.5, 4.1, 0.6], a: [1, 0.6, 1.3], m: face, roll: 1.2 } },
    legs: { f: { x: 6, y: 3.2, dz: -1, ru: 1.8, rl: 1.4, k: 0.52 }, h: { x: -6, y: 3.2, dz: -1, ru: 2.4, rl: 1.5 }, foot: { rx: 1.8, ry: 1.3, h: 0.9, fx: 0.6 }, m: { h: M('#5a4030') } },
    tail: { b: [-10, 2], m: [-18, 8], t: [-20, 16], r: 1.2, r1: 0.9, n: 4, g: [-12, -6, 1] },
    extras(P, F, c) {
      F.push({ c: add3(c.hc, mv(c.HA, [3.6, 0, 1.6])), r: 2.8, col: col3('#d9a088'), on: 'head' }); // face mask
      for (const s of [1, -1]) F.push(eyeF(add3(c.hc, mv(c.HA, [4.1, s * 1.4, 1.4])), 0.75));
    },
  };
}

// =====================================================================================================================
// Birds — body pitched, neck, head + beak, wings folded or spread (3 flap phases + glide), tail fan, thin legs
//   B: { body: [ax, ay, az], z, pitch, neck: [len, r], head: r, beak: [len, r, droop, col], wing: [span (one side), chord],
//        tail: [len, w], legs: [len, col], colours… }
// =====================================================================================================================
function bird(B, pose) {
  const P = [], F = [];
  const f = pose.f;
  const fly = f === 'fly0' || f === 'fly1' || f === 'fly2' || f === 'glide';
  const peck = f === 'graze', atk = f === 'atk';
  const bodyM = B.bodyM, wingM = B.wingM || bodyM, headM = B.headM || bodyM;
  const z0 = fly ? B.body[2] + 6 : B.z;
  const bp = fly ? 0.05 : B.pitch;
  const BA = axesPYR(bp);
  P.push(E([0, 0, z0], B.body, bodyM, { R: BA, id: 'body', br: 2.4 }));
  if (B.chest) P.push(E(add3([0, 0, z0], mv(BA, [B.body[0] * 0.45, 0, -B.body[2] * 0.15])), B.chest, B.chestM || bodyM, { R: BA, br: 2.4 }));
  // neck + head
  const [nl, nr] = B.neck;
  const nb = add3([0, 0, z0], mv(BA, [B.body[0] * 0.7, 0, B.body[2] * 0.35]));
  let hc;
  if (fly) hc = add3(nb, [nl * (B.flyNeck ?? 0.9) + B.head * 0.6, 0, nl * 0.15]);
  else if (peck) hc = [nb[0] + nl * 0.6 + B.head, 0, Math.max(B.head + 1, z0 * 0.25)];
  else if (atk) hc = add3(nb, [nl * 0.9 + B.head, 0, nl * 0.3]);
  else hc = add3(nb, [nl * (B.neckFwd ?? 0.3), 0, nl * 0.95]);
  if (B.sNeck && !fly && !peck) { const md = add3(nb, [nl * 0.55, 0, nl * 0.45]); P.push(seg(nb, md, nr, B.neckM || bodyM, { g: 'neck', br: 1.6 })); P.push(seg(md, hc, nr * 0.85, B.neckM || headM, { g: 'neck', br: 1.6 })); }
  else P.push(seg(nb, hc, nr, B.neckM || headM, { g: 'neck', br: 1.6 }));
  const hp = peck ? -1.1 : atk ? -0.25 : fly ? -0.1 : 0;
  const HA = axesPYR(hp);
  P.push(E(hc, [B.head * 1.15, B.head * 0.9, B.head], headM, { R: HA, g: 'head', id: 'head', br: 1.4 }));
  const [bl, br, droop, bcol] = B.beak;
  const bb = add3(hc, mv(HA, [B.head * 0.8, 0, -B.head * 0.15]));
  const BAk = axesPYR(hp - droop);
  P.push(E(add3(bb, mv(BAk, [bl * 0.5, 0, 0])), [bl * 0.55, br, br * 0.85], M(bcol, { fur: 0, gloss: 0.3 }), { R: BAk, g: 'beak', br: 0.5 }));
  if (B.hook) P.push(E(add3(bb, mv(BAk, [bl * 0.95, 0, -br * 0.6])), [br * 0.7, br * 0.6, br * 0.9], M(bcol, { fur: 0, gloss: 0.3 }), { R: BAk, g: 'beak', br: 0.4 }));
  for (const s of [1, -1]) F.push(eyeF(add3(hc, mv(HA, [B.head * 0.35, s * B.head * 0.78, B.head * 0.25])), Math.max(0.7, B.head * 0.22), B.eye || '#120e0c'));
  if (B.extras) B.extras(P, F, { hc, HA, z0, BA, nb, fly, peck });
  // tail
  const [tl, tw] = B.tail;
  const tb = add3([0, 0, z0], mv(BA, [-B.body[0] * 0.85, 0, B.body[2] * 0.1]));
  const TA = axesPYR(bp + (fly ? 0 : B.tailUp ?? 0.25));
  P.push(E(add3(tb, mv(TA, [-tl * 0.5, 0, 0])), [tl * 0.55, tw, 1.2], B.tailM || wingM, { R: TA, g: 'tail', br: 0.8 }));
  // wings
  const [span, chord] = B.wing;
  const sh = add3([0, 0, z0], mv(BA, [B.body[0] * 0.25, 0, B.body[2] * 0.45]));
  for (const s of [1, -1]) {
    if (!fly) {
      // folded along the flank (raised a little when threatening)
      const wc = add3([0, 0, z0], mv(BA, [-B.body[0] * 0.15, s * B.body[1] * 0.8, B.body[2] * 0.2 + (atk ? 3 : 0)]));
      const R = axesPYR(bp - 0.15 + (atk ? 0.5 : 0), 0, s * (atk ? -0.6 : 0.1));
      P.push(E(wc, [B.body[0] * 0.95, 1.3, B.body[2] * 0.75], wingM, { R, g: 'wing', br: 0.8 }));
      continue;
    }
    // spread: inner + outer panels from the shoulder, dihedral by phase (+ up)
    const dh = f === 'fly0' ? 0.85 : f === 'fly1' ? 0.1 : f === 'fly2' ? -0.55 : 0.08;
    const dho = f === 'fly0' ? 0.35 : f === 'fly2' ? 0.25 : 0;
    const dir = [0, s * Math.cos(dh), Math.sin(dh)];
    const ib = add3(sh, [0, s * B.body[1] * 0.6, 0]);
    const ie = add3(ib, mul3(dir, span * 0.48));
    P.push(E(mul3(add3(ib, ie), 0.5), [chord * 0.55, span * 0.26, 1.3], wingM, { R: [[1, 0, 0], nrm3(dir), nrm3([0, -s * Math.sin(dh), Math.cos(dh)])], g: 'wing' + s, br: 0.8 }));
    const d2 = [0, s * Math.cos(dh + dho * (f === 'fly2' ? -1 : 1)), Math.sin(dh + dho * (f === 'fly2' ? -1 : 1))];
    const oe = add3(ie, mul3(d2, span * 0.52));
    P.push(E(mul3(add3(ie, oe), 0.5), [chord * 0.45, span * 0.28, 1.1], B.tipM || wingM, { R: [[1, 0, 0], nrm3(d2), nrm3([0, -s * d2[2], d2[1] * s])], g: 'wing' + s, br: 0.8 }));
  }
  // legs: thin, two (tucked back in flight)
  const [ll, lc] = B.legs;
  const legM = M(lc, { fur: 0, gloss: 0.2 });
  for (const [s, ph] of [[1, 'A'], [-1, 'B']]) {
    const g = WALK[f]?.[ph] || [0, 0, 0];
    const hip = add3([0, 0, z0], mv(BA, [0, s * B.body[1] * 0.4, -B.body[2] * 0.6]));
    if (fly) { P.push(seg(hip, add3(hip, [-ll * 0.9, 0, -2]), 0.8, legM, { g: 'leg', br: 0.3 })); continue; }
    const foot = [hip[0] + Math.sin(g[0] * 1.2) * ll * 0.6, hip[1], g[2] * 0.6];
    const knee = [hip[0] - 1.5, hip[1], hip[2] * 0.45 + g[2] * 0.4];
    P.push(seg(hip, knee, B.thigh ?? 1.6, B.thighM || bodyM, { g: 'thigh', br: 0.6 }));
    P.push(seg(knee, foot, 0.75, legM, { g: 'leg', br: 0.3 }));
    P.push(E(add3(foot, [1.6, 0, 0.3]), [2.6, 1.6, 0.5], legM, { g: 'foot', br: 0.3 }));
  }
  return [P, F];
}
const BIRDS = {};
// vulture (griffon-like: brown, pale ruff, bald pinkish head, hooked beak, huge wings)
BIRDS.vulture = {
  body: [13, 8, 8.5], z: 16, pitch: 0.55, neck: [9, 2.2], head: 3.4, beak: [5, 1.4, 0.2, '#d8cbb0'], hook: true, neckFwd: 0.6, flyNeck: 0.4,
  wing: [44, 15], tail: [9, 6], legs: [12, '#8a8278'], thigh: 2.6,
  bodyM: M('#6b5440', { rough: 1.4, fur: 0.14 }), wingM: M('#5a4634', { fur: 0.14 }), tipM: M('#2e241c', { fur: 0.1 }), headM: M('#d6b5a4', { fur: 0.05 }), neckM: M('#d6b5a4', { fur: 0.05 }),
  extras(P) { P.push(E([9, 0, 25], [4.5, 6, 3.5], M('#ece2cf', { rough: 1.2, fur: 0.1 }), { g: 'ruff', br: 1.4 })); },
};
// eagle (bald-eagle-like: dark brown, white head and tail, yellow hooked beak)
BIRDS.eagle = {
  body: [11, 6.6, 7], z: 14, pitch: 0.55, neck: [5, 3], head: 3.6, beak: [4.6, 1.4, 0.25, '#e8b23a'], hook: true, eye: '#c8a020',
  wing: [38, 13], tail: [9, 5], legs: [10, '#e8b23a'], thigh: 2.4,
  bodyM: M('#4a3424', { rough: 1.2, fur: 0.12 }), wingM: M('#3e2c1e', { fur: 0.12 }), tipM: M('#2a1e16'), headM: M('#f2efe6', { rough: 0.9, fur: 0.06 }), tailM: M('#f2efe6', { fur: 0.06 }),
};
// parrot (scarlet macaw: red, yellow and blue wings, long tail)
BIRDS.parrot = {
  body: [7, 4.4, 4.8], z: 9, pitch: 0.75, neck: [3, 2.2], head: 3, beak: [3, 1.6, 0.8, '#efe7d8'], hook: true,
  wing: [20, 8], tail: [16, 2.4], tailUp: 0.1, legs: [6, '#5a5250'], thigh: 1.2,
  bodyM: M('#d0261e', { fur: 0.05 }), headM: M('#d0261e', { fur: 0.04 }), wingM: M('#e8c02a', { fur: 0.04, tex: (Pb) => (Pb[0] < -2 ? col3('#2a5ac0') : null) }), tipM: M('#2a5ac0', { fur: 0.04 }), tailM: M('#c0241c', { fur: 0.04, tex: (Pb) => (Pb[0] < -14 ? col3('#2a5ac0') : null) }),
  extras(P, F, c) { F.push({ c: add3(c.hc, mv(c.HA, [1.6, 2.3, 0.8])), r: 1.5, col: col3('#f3eee6'), on: 'head' }); F.push({ c: add3(c.hc, mv(c.HA, [1.6, -2.3, 0.8])), r: 1.5, col: col3('#f3eee6'), on: 'head' }); },
};
// seagull (white, grey back and wings, black wing tips, yellow beak)
BIRDS.seagull = {
  body: [8, 4.6, 4.8], z: 8, pitch: 0.18, neck: [3, 2.4], head: 2.8, beak: [3.4, 0.9, 0.05, '#e8c040'],
  wing: [24, 8], tail: [6, 3.6], tailUp: 0.15, legs: [6, '#d8a060'], thigh: 1.4,
  bodyM: M('#f4f3ef', { fur: 0.04 }), wingM: M('#a9b0b6', { fur: 0.04 }), tipM: M('#1e1e22', { fur: 0.03 }), tailM: M('#f4f3ef', { fur: 0.04 }),
};
// heron (grey heron: long legs and S-neck, dagger beak, black crest)
BIRDS.heron = {
  body: [9, 5, 6], z: 26, pitch: 0.45, neck: [16, 1.8], sNeck: true, neckFwd: 0.25, head: 2.4, beak: [7, 1, 0.05, '#d8a838'],
  wing: [30, 11], tail: [5, 4], legs: [24, '#a89060'], thigh: 1.6, flyNeck: 0.45,
  bodyM: M('#9aa2aa', { fur: 0.05 }), wingM: M('#8a929c', { fur: 0.05 }), tipM: M('#2a2a30'), headM: M('#f0eee8', { fur: 0.03 }), neckM: M('#ecebe6', { fur: 0.03 }),
  extras(P, F, c) { P.push(seg(add3(c.hc, mv(c.HA, [-1, 0, 1.6])), add3(c.hc, mv(c.HA, [-7, 0, 2.4])), 0.6, M('#1e1e22', { fur: 0 }), { g: 'crest', br: 0.3 })); },
};

// =====================================================================================================================
// Snakes, crocodiles, arthropods
// =====================================================================================================================
// rattlesnake: a chain of beads in an S on the ground; slither phases move the waves back; coil = a resting coil
function snake(S, pose) {
  const P = [], F = [];
  const f = pose.f, n = 18, Lg = S.len;
  const ph = f === 's1' ? 0.25 : f === 's2' ? 0.5 : f === 's3' ? 0.75 : 0;
  const skin = S.skin;
  let pts = [];
  if (f === 'coil') {
    for (let i = 0; i <= n; i++) { const t = i / n, a = t * PI * 3.4, r = 3 + 7 * (1 - t); pts.push([Math.cos(a) * r, Math.sin(a) * r, S.r + (1 - t) * S.r * 1.6]); }
    pts.reverse();
  } else {
    for (let i = 0; i <= n; i++) {
      const t = i / n, x = Lg * (0.5 - t);
      const amp = S.amp * (0.3 + 0.7 * smooth(0, 0.35, t)) * (1 - 0.3 * t);
      let z = S.r, y = Math.sin((t * 1.6 + ph) * PI * 2) * amp;
      if (f === 'atk' && t < 0.35) { const u = 1 - t / 0.35; z = S.r + u * 12; y *= 1 - u; }
      if (f === 'stand' && t < 0.18) { const u = 1 - t / 0.18; z = S.r + u * 6; }
      pts.push([x + (f === 'atk' ? 6 : 0), y, z]);
    }
  }
  for (let i = 0; i < n; i++) {
    const t = i / n, r = S.r * (t < 0.1 ? 0.75 + t * 2.5 : 1 - 0.55 * smooth(0.6, 1, t));
    P.push(seg(pts[i], pts[i + 1], r, skin, { g: 'body', br: 2, wz: 0.8 }));
  }
  const h0 = pts[0], h1 = pts[1];
  const dir = nrm3(sub3(h0, h1));
  const HA = axesAlong(dir);
  const hc = add3(h0, mul3(dir, S.r * 0.8));
  P.push(E(hc, [S.r * 1.7, S.r * 1.25, S.r * 0.8], S.headM || skin, { R: HA, g: 'body', id: 'head', br: 1.2 }));
  for (const s of [1, -1]) F.push(eyeF(add3(hc, mv(HA, [S.r * 0.6, s * S.r * 1.05, S.r * 0.35])), 0.7, '#2a1c0c'));
  if (f === 'atk') P.push(E(add3(hc, mv(HA, [S.r * 1.6, 0, -0.4])), [1.4, 0.4, 0.4], M('#c03a3a', { fur: 0 }), { R: HA, g: 'tongue', br: 0.2 }));
  // the rattle at the tail tip
  const tl = pts[n], tp = pts[n - 1], td = nrm3(sub3(tl, tp));
  for (let i = 0; i < 4; i++) P.push(E(add3(tl, mul3(td, 0.9 + i * 1.3)), [0.9, 1.3 - i * 0.12, 1.2 - i * 0.1], M('#d8c8a0', { fur: 0, gloss: 0.15 }), { R: axesAlong(td), g: 'rattle', br: 0.4 }));
  return [P, F];
}
const SNAKES = {
  rattlesnake: { len: 54, r: 2.6, amp: 4.5, skin: M('#a68a5c', { fur: 0.03, gloss: 0.15, tex: (Pb) => { const v = fr((Pb[0] + Math.abs(Pb[1]) * 0.9) / 7); return v < 0.32 ? col3('#5a4430') : v < 0.4 ? col3('#e2d2a8') : null; } }), headM: M('#8a7048', { fur: 0.03, gloss: 0.15 }) },
};
// crocodile: a low chain (snout, head, neck, body, tail) with scutes, four sprawled legs
function croc(S, pose) {
  const P = [], F = [];
  const f = pose.f, atk = f === 'atk';
  const skin = S.skin, belly = S.belly;
  const sw = f === 'w0' ? 1 : f === 'w2' ? -1 : 0;
  const yaw = (x) => Math.sin(x / 26 + sw) * (sw ? 2.4 : 0) + (f === 'swim' ? Math.sin(x / 18) * 2 : 0);
  const z0 = S.z;
  // body
  P.push(E([4, yaw(4), z0], [24, 12, 7.5], skin, { id: 'body', br: 3 }));
  P.push(E([-20, yaw(-20), z0 - 0.5], [14, 9, 6.2], skin, { br: 3 }));
  // tail: tapering beads swinging
  const tail = [];
  for (let i = 0; i <= 6; i++) tail.push([-30 - i * 9, yaw(-30 - i * 9) * (1 + i * 0.4), z0 - 1 - i * 0.6]);
  chainPts(P, tail, 6.4, 1.6, skin, { g: 'body', br: 2.4, wz: 0.75 });
  // head: lifted and jaws open in an attack
  const hp = atk ? 0.32 : 0;
  const HA = axesPYR(hp);
  const hc = [32, yaw(32), z0 + (atk ? 3 : 0)];
  P.push(E(hc, [9, 8.4, 5.4], skin, { R: HA, g: 'body', id: 'head', br: 2.2 }));
  P.push(E(add3(hc, mv(HA, [15, 0, -0.8])), [11, 4.6, 2.8], skin, { R: HA, g: 'body', id: 'snout', br: 1.6 }));
  const JA = axesPYR(atk ? -0.32 : -0.04);
  P.push(E(add3(hc, mv(JA, [14, 0, -4.2])), [12, 4.4, 1.8], belly, { R: JA, g: atk ? 'jaw' : 'body', br: 1.2 }));
  if (atk) { P.push(E(add3(hc, mv(HA, [12, 0, -3.4])), [9, 3.6, 1.2], M('#e8b0a0', { fur: 0 }), { R: HA, g: 'mouth', br: 0.4 })); for (let i = 0; i < 5; i++) for (const s of [1, -1]) P.push(E(add3(hc, mv(HA, [5 + i * 4, s * 3.8, -2.6])), [0.6, 0.5, 1.2], M('#f4eedc', { fur: 0 }), { R: HA, g: 'tooth', br: 0.2 })); }
  for (const s of [1, -1]) {
    P.push(E(add3(hc, mv(HA, [-3, s * 4.4, 4.6])), [2.4, 2, 1.8], skin, { R: HA, g: 'body', id: 'brow', br: 1 }));
    F.push({ c: add3(hc, mv(HA, [-2.4, s * 4.6, 6.1])), r: 1.2, col: col3('#c8b030'), hl: true, on: 'brow' });
    F.push({ c: add3(hc, mv(HA, [-1.8, s * 4.8, 6.25])), r: 0.5, col: col3('#141008'), on: 'brow' });
  }
  for (const s of [1, -1]) F.push({ c: add3(hc, mv(HA, [24, s * 1.6, 1.8])), r: 0.8, col: col3('#141210'), on: 'snout' });
  // scutes: two rows of bumps down the back and tail
  for (let i = 0; i < 10; i++) { const x = 22 - i * 7.5; for (const s of [1, -1]) P.push(E([x, yaw(x) + s * 3.2, z0 + (i < 6 ? 6.4 : 4.6 - (i - 6) * 0.8)], [1.8, 1.2, 1.4], S.scute || skin, { g: 'scute', br: 0.8, edge: false })); }
  // sprawled legs (left / right pairs alternate)
  const legM = skin;
  for (const [x, front] of [[18, 1], [-14, 0]]) for (const s of [1, -1]) {
    const ph = (front && s > 0) || (!front && s < 0) ? sw : -sw;
    const hip = [x, yaw(x) + s * 9, z0 - 1];
    const knee = [x + ph * 4 + (front ? 2 : -2), yaw(x) + s * 15, z0 - 1];
    const foot = [x + ph * 6 + (front ? 4 : -1), yaw(x) + s * 16, 1.2];
    if (f === 'swim') { P.push(seg(hip, [x - 6, s * 13, z0 + 1], 2.6, legM, { g: 'leg', br: 1 })); continue; }
    P.push(seg(hip, knee, 3.2, legM, { g: 'leg', br: 1.2 }));
    P.push(seg(knee, foot, 2.4, legM, { g: 'leg', br: 1 }));
    P.push(E(add3(foot, [2, 0, -0.4]), [3.4, 2.4, 0.9], legM, { g: 'foot', br: 0.6 }));
  }
  return [P, F];
}
const CROCS = {
  crocodile: { z: 8.5, skin: M('#4e5a36', { fur: 0.1, gloss: 0.1, tex: (Pb) => (fr(Pb[0] / 4.2) < 0.18 || vnoise(Pb[0] / 2, Pb[1] / 2, Pb[2] / 2) > 0.74 ? col3('#343e24') : null) }), belly: M('#c8bf92', { fur: 0.05 }), scute: M('#3c4628', { fur: 0.12 }) },
};
// arthropods: crab (carapace, sideways legs, two claws, eye stalks; it walks sideways: its face is on −y, toward the
// camera when it goes east) · scorpion (segments, pincers, tail curled over the back with the sting)
function crab(S, pose) {
  const P = [], F = [];
  const f = pose.f, atk = f === 'atk';
  const shell = S.shell, legM = S.legM || shell;
  const z0 = S.z;
  const ph = f === 'w0' || f === 'w2' ? (f === 'w0' ? 1 : -1) : 0;
  P.push(E([0, 0, z0], [10.5, 7.5, 3.8], shell, { id: 'body', br: 2 }));
  P.push(E([0, -1, z0 - 1.4], [9, 6, 2.6], S.belly || shell, { br: 2 }));
  for (const s of [1, -1]) for (let i = 0; i < 4; i++) {
    // legs fan out along ±x (the crab's sides), knees up
    const lp = (i % 2 ? 1 : -1) * ph * 0.25;
    const hx = s * (6 - i * 0.5), hy = 3 - i * 2.4;
    const knee = [s * (13 + i), hy + lp * 8 - 1, z0 + 3.5];
    const tip = [s * (17 + i * 1.2), hy + lp * 10 - 2, 0.6];
    P.push(seg([hx, hy, z0], knee, 1.15, legM, { g: 'leg', br: 0.5 }));
    P.push(seg(knee, tip, 0.85, legM, { g: 'leg', br: 0.4 }));
  }
  // claws (front = −y)
  for (const s of [1, -1]) {
    const up = atk ? 9 : 0;
    const arm0 = [s * 5, -5, z0], arm1 = [s * 8, -10, z0 + 2 + up * 0.6];
    P.push(seg(arm0, arm1, 1.6, shell, { g: 'claw', br: 0.6 }));
    const cl = add3(arm1, [s * 1.5, -4, 1 + up * 0.4]);
    P.push(E(cl, [2.6, 4.4, 2.4], S.clawM || shell, { R: axesPYR(0, -PI / 2 + s * 0.3), g: 'claw', br: 0.6 }));
    P.push(E(add3(cl, [s * -1.6, -3.6, atk ? 2.2 : 0.4]), [0.9, 2.8, 0.9], S.clawM || shell, { R: axesPYR(atk ? 0.6 : 0, -PI / 2), g: 'claw', br: 0.4 }));
  }
  for (const s of [1, -1]) { const e = [s * 2.6, -6.6, z0 + 4.4]; P.push(seg([s * 2.2, -5.4, z0 + 2], e, 0.6, shell, { g: 'eye', br: 0.3 })); F.push({ c: e, r: 1, col: col3('#141010'), hl: true }); P.push(E(e, [0.9, 0.9, 0.9], M('#141010', { fur: 0, gloss: 0.5 }), { g: 'eyeb', br: 0.2 })); }
  return [P, F];
}
const CRABS = { crab: { z: 4.5, shell: M('#c4502c', { fur: 0.04, gloss: 0.2, tex: spots(col3('#a83c22'), 2, 0.66) }), belly: M('#e8c8a0', { fur: 0.02 }), legM: M('#b84828', { fur: 0.03 }), clawM: M('#d45a30', { fur: 0.03, gloss: 0.25 }) } };
function scorpion(S, pose) {
  const P = [], F = [];
  const f = pose.f, atk = f === 'atk';
  const sk = S.shell, z0 = S.z;
  const ph = f === 'w0' ? 1 : f === 'w2' ? -1 : 0;
  // cephalothorax + abdomen segments
  P.push(E([5, 0, z0], [5, 4.2, 2.2], sk, { id: 'body', br: 1.4 }));
  for (let i = 0; i < 4; i++) P.push(E([-1 - i * 3.4, 0, z0 - 0.1], [2.2, 4.4 - i * 0.3, 2.1], sk, { br: 1 }));
  // tail: 5 segments curling up and over, the sting forward (struck further forward in an attack)
  const pts = [];
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * (atk ? 1.15 : 0.95) * PI;
    pts.push([-12 - Math.sin(a) * 6 + (atk ? i * 1.6 : 0), 0, z0 + (1 - Math.cos(a)) * 6.5]);
  }
  chainPts(P, pts, 1.7, 1.3, sk, { g: 'tail', br: 0.8 });
  const st = pts[6], sd = nrm3(sub3(st, pts[5]));
  P.push(E(add3(st, mul3(sd, 1.6)), [2, 1.4, 1.4], S.sting || sk, { R: axesAlong(sd), g: 'sting', br: 0.5 }));
  P.push(seg(add3(st, mul3(sd, 3)), add3(st, add3(mul3(sd, 3.4), [1.5, 0, -1.6])), 0.45, M('#1a1410', { fur: 0 }), { g: 'sting', br: 0.2 }));
  // pincers forward
  for (const s of [1, -1]) {
    const a0 = [8, s * 3, z0], a1 = [12, s * 6.5, z0 + (atk ? 2 : 0.5)], cl = [16.5, s * 6, z0 + (atk ? 2.5 : 0.6)];
    P.push(seg(a0, a1, 1, sk, { g: 'arm', br: 0.4 }));
    P.push(E(cl, [3.4, 2, 1.6], S.claw || sk, { R: axesPYR(0, s * -0.2), g: 'arm', br: 0.4 }));
  }
  // 8 legs
  for (const s of [1, -1]) for (let i = 0; i < 4; i++) {
    const lp = (i % 2 ? 1 : -1) * ph * s;
    const hx = 5 - i * 3, knee = [hx + lp * 1.5 - i * 0.6, s * 8, z0 + 2.4], tip = [hx + lp * 2.5 - i * 1.6, s * 11, 0.4];
    P.push(seg([hx, s * 3, z0], knee, 0.7, sk, { g: 'leg', br: 0.3 }));
    P.push(seg(knee, tip, 0.55, sk, { g: 'leg', br: 0.3 }));
  }
  for (const s of [1, -1]) F.push({ c: [8.4, s * 1.2, z0 + 2.1], r: 0.6, col: col3('#0c0a08'), hl: true });
  return [P, F];
}
const SCORPS = { scorpion: { z: 3.2, shell: M('#b88a3a', { fur: 0.03, gloss: 0.3 }), claw: M('#c8964a', { fur: 0.02, gloss: 0.3 }), sting: M('#6a3a1a', { fur: 0, gloss: 0.4 }) } };

// =====================================================================================================================
// Sea animals — fusiform body (2–3 ellipsoids), fins, flukes; seal lying / swimming
// =====================================================================================================================
// S: { len, r, z, skin, belly, dorsal: [x, h, l, lean], pect: [x, l, w], tail: 'shark' | 'fluke', beak?, k (whale scale) }
function swimmer(S, pose) {
  const P = [], F = [];
  const f = pose.f, k = S.k || 1;
  const sway = f === 'swim1' ? 0.32 : f === 'swim2' ? -0.32 : 0;
  const z0 = S.z * k;
  const skin = S.skin;
  const L = S.len * k, R = S.r * k;
  const yawAt = (x) => (x < 0 ? Math.sin(sway) * (x / L) * (x / L) * L * 0.5 : 0);
  P.push(E([L * 0.08, 0, z0], [L * 0.32, R, R * (S.flat ?? 1)], skin, { id: 'body', br: 3 * k }));
  P.push(E([-L * 0.18, yawAt(-L * 0.18), z0], [L * 0.24, R * 0.74, R * 0.8 * (S.flat ?? 1)], skin, { R: axesPYR(0, -sway * 0.3), br: 3 * k }));
  P.push(E([-L * 0.36, yawAt(-L * 0.36), z0 + R * 0.05], [L * 0.12, R * 0.32, R * 0.42], skin, { R: axesPYR(0, -sway * 0.6), br: 2 * k }));
  // head
  const hc = [L * 0.33, 0, z0 - R * 0.05];
  P.push(E(hc, [L * 0.13, R * 0.78, R * 0.78 * (S.flat ?? 1)], S.headM || skin, { id: 'head', br: 2.4 * k }));
  if (S.beak) P.push(E([L * 0.45, 0, z0 - R * 0.2], [L * 0.07, R * 0.26, R * 0.22], skin, { g: 'head', br: 1 * k }));
  for (const s of [1, -1]) F.push(eyeF([L * 0.38, s * R * 0.62, z0 + R * 0.05], Math.max(0.9, R * 0.1)));
  if (S.gills) for (let i = 0; i < 4; i++) for (const s of [1, -1]) F.push({ c: [L * 0.24 - i * 2.2 * k, s * R * 0.92, z0], r: 0.6 * k, col: col3('#4a5258') });
  // fins
  const [dx, dh, dl, lean] = S.dorsal;
  if (dh) P.push(E([dx * L, yawAt(dx * L), z0 + R * 0.85 + dh * k * 0.45], [dl * k, 0.9 * k, dh * k * 0.62], S.finM || skin, { R: axesPYR(lean ?? 0.5, -sway * 0.2), g: 'fin', br: 0.8 * k }));
  const [px, pl, pw] = S.pect;
  for (const s of [1, -1]) P.push(E([px * L, s * R * 0.95, z0 - R * 0.45], [pw * k, pl * k, 0.9 * k], S.finM || skin, { R: axesPYR(0.2, s * 0.6, s * 0.5), g: 'fin', br: 0.6 * k }));
  // tail
  const tx = -L * 0.48, ty = yawAt(tx) * 1.2;
  if (S.tail === 'shark') {
    P.push(E([tx - 2 * k, ty, z0 + R * 0.7], [3.4 * k, 0.8 * k, R * 1.2], S.finM || skin, { R: axesPYR(-0.7, -sway), g: 'fin', br: 0.6 * k }));
    P.push(E([tx - 1 * k, ty, z0 - R * 0.45], [2.4 * k, 0.8 * k, R * 0.7], S.finM || skin, { R: axesPYR(0.75, -sway), g: 'fin', br: 0.6 * k }));
  } else {
    const up = f === 'dive' ? 1 : 0;
    P.push(E([tx - R * 0.2, ty, z0 + up * R * 0.4], [R * 0.4, R * 1.5, 0.9 * k], S.flukeM || skin, { R: axesPYR(-sway * 0.5 + up * 0.6, -sway), g: 'fin', br: 0.6 * k }));
  }
  if (S.extras) S.extras(P, F, { L, R, z0, k, hc, sway });
  // dive: the tail up out of the water (whale), the head deep
  if (f === 'dive') pitchAbout(P, F, -0.32, [-L * 0.12, 0, z0]);
  if (f === 'jump') pitchAbout(P, F, 0.35, [0, 0, z0]);
  if (f === 'atk') pitchAbout(P, F, 0.12, [0, 0, z0]);
  return [P, F];
}
const SWIM = {
  shark: { len: 104, r: 12, z: 14, skin: M('#7b8792', { belly: '#e8ece8', fur: 0.03, gloss: 0.18 }), finM: M('#6e7a86', { fur: 0.03, gloss: 0.15 }), dorsal: [0.02, 20, 7, 0.55], pect: [0.12, 16, 6], tail: 'shark', gills: true, flat: 0.95 },
  dolphin: { len: 86, r: 10, z: 12, skin: M('#7d8a98', { belly: '#e2e6ea', fur: 0.02, gloss: 0.3 }), dorsal: [0.0, 13, 6, 0.75], pect: [0.18, 10, 4], tail: 'fluke', beak: true },
  whale: { len: 90, r: 13, z: 14, k: 2.6, flat: 0.9, skin: M('#3e4a58', { belly: '#c8ccd2', fur: 0.05, gloss: 0.12, tex: (Pb) => (vnoise(Pb[0] / 3, Pb[1] / 3, Pb[2] / 3) > 0.88 ? col3('#8a929c') : null) }), dorsal: [-0.22, 4, 4, 0.6], pect: [0.12, 26, 6], tail: 'fluke',
    extras(P, F, c) { for (let i = 0; i < 5; i++) F.push({ c: [c.L * 0.38 - i * 4 * c.k, 0, c.z0 + c.R * 0.95], r: 1.4 * c.k, col: col3('#2c343e') }); } },
};
// seal: lying on the ground (head up), humping along, swimming (head out)
function seal(S, pose) {
  const P = [], F = [];
  const f = pose.f, hump = f === 'w0' ? 1 : f === 'w2' ? -1 : 0;
  const skin = S.skin;
  P.push(E([0, 0, 9 + hump * 1.5], [16, 9, 8.4], skin, { id: 'body', br: 3 }));
  P.push(E([-15, 0, 7], [12, 7.4, 6.6], skin, { br: 3 }));
  P.push(E([-27, 0, 4.6], [7, 4.4, 3.6], skin, { br: 2 }));
  const up = f === 'stand' || f === 'swim' ? 1 : 0.6;
  const nk = [15, 0, 12 + up * 3];
  P.push(seg([10, 0, 11], nk, 6.4, skin, { g: 'body', br: 2.4 }));
  const HA = axesPYR(-0.15);
  const hc = add3(nk, [5, 0, 3 * up]);
  P.push(E(hc, [6.4, 5.4, 5.2], skin, { R: HA, g: 'body', id: 'head', br: 2.2 }));
  P.push(E(add3(hc, mv(HA, [5, 0, -1.4])), [3, 3.4, 2.6], S.muzzle || skin, { R: HA, g: 'body', id: 'muzzle', br: 1.4 }));
  for (const s of [1, -1]) F.push(eyeF(add3(hc, mv(HA, [2.6, s * 3.6, 1.6])), 1.5, '#0c0a0a'));
  F.push({ c: add3(hc, mv(HA, [7.6, 0, -0.6])), r: 1, col: col3('#141010'), on: 'muzzle' });
  for (const s of [1, -1]) {
    P.push(E([7, s * 9, 3 - hump], [5, 2, 1.6], skin, { R: axesPYR(0.1, s * 0.5), g: 'flip', br: 0.8 }));
    P.push(E([-33, s * 3.4, 3], [4, 3, 1], skin, { R: axesPYR(0, s * 0.45), g: 'flip', br: 0.6 }));
  }
  return [P, F];
}
const SEALS = { seal: { skin: M('#7d7a74', { belly: '#b8b2a6', fur: 0.04, gloss: 0.25, tex: spots(col3('#4e4a46'), 2.2, 0.7) }), muzzle: M('#9a948a', { fur: 0.03 }) } };

// =====================================================================================================================
// registry: body plan, model, frames, baked size class
// =====================================================================================================================
const QUAD_F = ['stand', 'w0', 'w1', 'w2', 'w3', 'graze', 'atk'];
const CAT_F = [...QUAD_F, 'rest'];
const PLANS = {};
for (const k in Q) PLANS[k] = { model: (p) => quad(Q[k], p), frames: ['lion', 'lion_m', 'jaguar', 'lynx', 'arctic_fox', 'camel'].includes(k) ? CAT_F : k === 'polar_bear' ? [...CAT_F, 'swim'] : k === 'monkey' ? [...QUAD_F, 'sit'] : QUAD_F };
PLANS.polar_bear.cut = ['swim'];
for (const k in BIRDS) PLANS[k] = { model: (p) => bird(BIRDS[k], p), frames: ['stand', 'w0', 'w2', 'graze', 'atk', 'fly0', 'fly1', 'fly2', 'glide'] };
for (const k in SNAKES) PLANS[k] = { model: (p) => snake(SNAKES[k], p), frames: ['stand', 's0', 's1', 's2', 's3', 'atk', 'coil'] };
for (const k in CROCS) PLANS[k] = { model: (p) => croc(CROCS[k], p), frames: ['stand', 'w0', 'w1', 'w2', 'w3', 'atk', 'swim'] };
for (const k in CRABS) PLANS[k] = { model: (p) => crab(CRABS[k], p), frames: ['stand', 'w0', 'w1', 'w2', 'w3', 'atk'], flat: true };
for (const k in SCORPS) PLANS[k] = { model: (p) => scorpion(SCORPS[k], p), frames: ['stand', 'w0', 'w1', 'w2', 'w3', 'atk'], flat: true };
for (const k in SWIM) PLANS[k] = { model: (p) => swimmer(SWIM[k], p), frames: ['stand', 'swim1', 'swim2', 'atk', ...(k === 'dolphin' ? ['jump'] : []), ...(k === 'whale' ? ['dive'] : [])], cut: k === 'whale' ? ['stand', 'swim1', 'swim2', 'dive'] : ['stand', 'swim1', 'swim2'] };
for (const k in SEALS) PLANS[k] = { model: (p) => seal(SEALS[k], p), frames: ['stand', 'w0', 'w2', 'swim'], cut: ['swim'] };
// the croc swims with its eyes and back out: swim frames get a cut version too
PLANS.crocodile.cut = ['swim'];
// cut height (px above the water line) per art key: what shows of a swimmer
const CUT_Z = { shark: 22, dolphin: 18, whale: 60, crocodile: 12.5, seal: 15, polar_bear: 32 };
// frames that walk 1→1 for the kind of animal (drawing: art/faunaDraw.js)
export const FAUNA_ART = {};
for (const k in PLANS) FAUNA_ART[k] = { frames: PLANS[k].frames, cut: PLANS[k].cut || [], flat: !!PLANS[k].flat };
export const FAUNA_KEYS = Object.keys(PLANS);

const VIEWS = ['e', 'se', 's', 'ne', 'n'];
const name = (key, v, f) => key + '_' + v + (f === 'stand' ? '' : '_' + f);
// the model of a frame (cut: shifted down to the water line, only what is above drawn)
function modelOf(key, f, cut) {
  const m = PLANS[key].model({ f });
  if (cut) shiftModel(m[0], m[1], [0, 0, -CUT_Z[key]]);
  return m;
}
function paint(key, v, f, cut) {
  const [c] = modelSprite(modelOf(key, f, cut), YAW[v], undefined, cut ? { cut: 0, ow: 1.8 } : null);
  return c;
}
// lazily painted: every view of every frame (+ cut swimmers), the dead (flat ones)
for (const key of FAUNA_KEYS) {
  const Pl = PLANS[key];
  for (const f of Pl.frames) for (const v of VIEWS) {
    if (f === 'stand' && (v === 'e' || v === 's' || v === 'n')) continue; // (baked)
    const [, H, , top] = boxOf(modelOf(key, f, false), YAW[v]);
    lazyDef(name(key, v, f), () => paint(key, v, f, false), 0.5, top / H);
  }
  for (const f of Pl.cut || []) for (const v of VIEWS) {
    const [, H, , top] = boxOf(modelOf(key, f, true), YAW[v]);
    lazyDef(name(key, v, f) + '_cut', () => paint(key, v, f, true), 0.5, top / H);
  }
}
// top-down shapes of the swimmers (their body under the water: drawn flat, turned to where they swim)
for (const key of ['shark', 'dolphin', 'whale', 'crocodile', 'seal']) {
  const TOP = Math.PI / 2 - 0.001, [, H, , top] = boxOf(modelOf(key, 'stand', false), 0, TOP);
  lazyDef(key + '_top', () => modelSprite(modelOf(key, 'stand', false), 0, TOP, { ow: 1.2 })[0], 0.5, top / H);
}
// baked: standing e / s / n (the contract, the corpses), the flat ones on their back
export function addFauna(add) {
  for (const key of FAUNA_KEYS) {
    for (const v of ['e', 's', 'n']) {
      const [c, ay] = modelSprite(modelOf(key, 'stand', false), YAW[v]);
      add(key + '_' + v, c, 0.5, ay);
    }
    {
      // dead: rolled onto its side (legs out toward the camera, the belly showing; the flat ones on their back),
      // lying on the ground — one drawing for every view (the body on the ground is not turned: corpseDraw.js)
      const flat = PLANS[key].flat, m = modelOf(key, Q[key] ? 'dead' : 'stand', false);
      const roll = flat ? (v) => [v[0], -v[1], -v[2]] : (v) => [v[0], v[2], -v[1]];
      for (const p of m[0]) { p.c = roll(p.c); p.R = p.R.map(roll); }
      for (const q of m[1]) q.c = roll(q.c);
      let z0 = Infinity, yc = 0, n = 0;
      for (const p of m[0]) { z0 = Math.min(z0, p.c[2] - Math.hypot(p.R[0][2] * p.a[0], p.R[1][2] * p.a[1], p.R[2][2] * p.a[2])); yc += p.c[1]; n++; }
      shiftModel(m[0], m[1], [0, flat ? 0 : -yc / n, -z0]); // (centred on its ground point)
      const [c, ay] = modelSprite(m, YAW.e, flat ? undefined : (30 * Math.PI) / 180); // (seen a little more from above: it lies on the ground)
      add(key + '_dead', c, 0.5, ay);
    }
  }
}
