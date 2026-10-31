// Drawing of bodies on the ground (I · corpos e decomposição). Reads state only. Bodies lie flat, so they go to
// the decor batch (under everything standing, over the grass). age = days since death (shared world time):
//   0..1 fresh (falls when it appears) · 0.82..1 discolours · 1..2 rotten (green-grey, blotches, flies, sunken)
//   1.88..2 cross-fade to the skeleton · 2..5 skeleton (bleaches) · 4.9..5 fades out (the host then removes it).
// Pawns are drawn by the pawn rig itself (drawPawn dead pose) through a tinting batch wrapper, so look parts
// and gear follow the rig; animals use their side sprite with the same lying transform as drawAnimal.

import { drawPawn, viewPt, VX, VY } from './compose.js'; // viewPt: screen-space offsets → world (camera turned)

const HALF_PI = Math.PI / 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const sm = (a, b, x) => { const u = clamp01((x - a) / (b - a)); return u * u * (3 - 2 * u); };
const easeIn = (u) => u * u * u;
const lerp = (a, b, t) => a + (b - a) * t;

// batch wrapper: multiplies colour / alpha / scale and forces "receives shadows" (flat on the ground)
class Tint {
  constructor() { this.dst = null; this.r = 1; this.g = 1; this.b = 1; this.a = 1; this.sx = 1; this.sy = 1; }
  set(dst, r, g, b, a, sx = 1, sy = 1) { this.dst = dst; this.r = r; this.g = g; this.b = b; this.a = a; this.sx = sx; this.sy = sy; return this; }
  add(s, x, y, sx, sy, r, g, b, a, sway, rot, flash, flip, recv, lift) {
    if (this.dst) this.dst.add(s, x, y, sx * this.sx, sy * this.sy, r * this.r, g * this.g, b * this.b, a * this.a, sway, rot, flash, flip, 1, lift);
  }
  addRaw() {}
}
const WB = { main: new Tint(), blob: new Tint(), shadow: new Tint(), emissive: new Tint(), fx: new Tint(), decor: new Tint(), ground: new Tint(), light: new Tint() };

const CACHE = new WeakMap();
function tables(A) {
  let T = CACHE.get(A);
  if (T) return T;
  const opt = (n) => (A.has(n) ? A.get(n) : null);
  T = {
    skel: { s: opt('corpse_skel_s'), m: opt('corpse_skel_m'), l: opt('corpse_skel_l'), p: opt('corpse_skel_pawn') },
    carc: { s: opt('corpse_carcass_s'), m: opt('corpse_carcass_m'), l: opt('corpse_carcass_l') },
    rot: [opt('corpse_rot_0'), opt('corpse_rot_1') || opt('corpse_rot_0')],
    fly: opt('fx_fly') || opt('fx_spark'), blob: opt('fx_blob'), soft: opt('fx_soft'), side: {},
  };
  CACHE.set(A, T);
  return T;
}
function sideOf(T, A, key) {
  let s = T.side[key];
  if (s === undefined) {
    s = A.has(key + '_dead') ? { s: A.get(key + '_dead'), dead: true } : A.has(key + '_e') ? { s: A.get(key + '_e'), dead: false } : null;
    T.side[key] = s;
  }
  return s;
}

const SIZE = { rabbit: 's', fox: 's', spider: 's', deer: 'm', wolf: 'm', boar: 'm', bear: 'l' };
const FRESH_A = [0.82, 0.8, 0.78], ROT_A = [0.58, 0.66, 0.48], DRY_A = [0.42, 0.37, 0.32], RAW_A = [0.86, 0.42, 0.36];
const FRESH_P = [0.93, 0.92, 0.9], ROT_P = [0.66, 0.77, 0.56];
const BONE_OLD = [0.86, 0.8, 0.68], BONE_NEW = [1, 0.99, 0.95], ROT_RAW = [ROT_A[0] * 0.8, ROT_A[1] * 0.7, ROT_A[2] * 0.7];
// scratch colours (no per-frame allocation)
const bone = [1, 1, 1], tint = [1, 1, 1];
function mix3(out, a, b, t) { out[0] = lerp(a[0], b[0], t); out[1] = lerp(a[1], b[1], t); out[2] = lerp(a[2], b[2], t); return out; }

// visible gear of a pawn body (only what is still inside it; raiders keep their clothes)
function pawnProxy(c) {
  let px = c._px;
  if (!px) px = c._px = { isEntity: true, kind: 'pawn', dead: true, deadT: 0, flash: 0, x: 0, y: 0, facing: 'e', look: null, weapon: null, offhand: null, armor: { body: null, head: null }, id: 0, _ph: 0, _gv: -1 };
  px.x = c.x; px.y = c.y; px.facing = c.f === 'w' ? 'w' : 'e'; px.look = c.look; px._ph = c._ph || 0;
  const ver = c.store ? c.store.version : 0;
  if (px._gv !== ver) {
    px._gv = ver;
    const has = (id) => !!id && !!c.store && c.store.count(id) > 0;
    const g = c.gear || [];
    px.weapon = has(g[0]) ? g[0] : null;
    px.offhand = has(g[1]) ? g[1] : null;
    px.armor.body = c.owner ? (has(g[2]) ? g[2] : null) : g[2] || null;
    px.armor.head = c.owner ? (has(g[3]) ? g[3] : null) : g[3] || null;
  }
  return px;
}

// c: corpse record · age: days since death · tsince: seconds since it appeared here (fall) · t: game time
// gone: 0..1 removal animation (bones collected)
export function drawCorpse(B, A, c, age, tsince, t, gone = 0) {
  const T = tables(A);
  const rotK = sm(0.82, 1, age) * (1 - sm(1.88, 2, age));
  let bodyA = 1 - sm(1.88, 2, age);
  let skelA = sm(1.88, 2, age) * (1 - sm(4.9, 5, age));
  if (gone > 0) { bodyA *= 1 - gone; skelA *= 1 - gone; }
  const bleach = sm(2, 4.5, age);
  mix3(bone, BONE_OLD, BONE_NEW, bleach);
  const shrink = 1 - gone * 0.35;

  if (c.of === 'pawn') {
    const px = pawnProxy(c);
    px.deadT = tsince;
    const flip = px.facing === 'w' ? -1 : 1, side = -flip; // facing e/w → lies to the side it faced away from
    // blood under a fresh body
    if (T.soft && age < 0.6) viewPt(c.x, c.y, side * 0.3, 0.02);
    if (T.soft && age < 0.6) B.decor.add(T.soft, VX, VY, 1.3 / T.soft.w, 0.55 / T.soft.w, 0.32, 0.04, 0.04, 0.45 * (1 - sm(0.2, 0.6, age)) * clamp01(tsince * 1.5), 0, 0, 0, 1, 1, 0);
    if (bodyA > 0.01) {
      mix3(tint, FRESH_P, ROT_P, rotK);
      const sunk = 1 - 0.07 * rotK;
      const W = WB;
      W.main.set(B.decor, tint[0], tint[1], tint[2], bodyA, 1, sunk);
      W.blob.set(B.blob, 1, 1, 1, bodyA);
      W.shadow.dst = null; W.emissive.dst = null; W.fx.dst = null; W.light.dst = null;
      W.decor.set(B.decor, tint[0], tint[1], tint[2], bodyA); W.ground.set(B.ground, 1, 1, 1, bodyA);
      drawPawn(W, A, px, t);
      if (rotK > 0.05 && T.rot[0]) {
        viewPt(c.x, c.y, side * 0.28, -0.05);
        B.decor.add(T.rot[0], VX, VY, 0.95, 0.9, 1, 1, 1, 0.75 * rotK * bodyA, 0, side * 0.2, 0, flip, 1, 0.02);
        viewPt(c.x, c.y, side * 0.62, -0.08);
        B.decor.add(T.rot[1], VX, VY, 0.55, 0.55, 1, 1, 1, 0.6 * rotK * bodyA, 0, -side * 0.4, 0, -flip, 1, 0.04);
      }
    }
    const K = T.skel.p;
    if (K && skelA > 0.01) {
      viewPt(c.x, c.y, side * 0.35, 0);
      if (T.blob) B.blob.add(T.blob, VX, VY, 1.0, 0.45, 1, 1, 1, 0.3 * skelA);
      B.decor.add(K, c.x, c.y, shrink, shrink, bone[0], bone[1], bone[2], skelA, 0, side * HALF_PI, 0, flip, 1, gone * 0.25);
    }
    return;
  }

  // ---- animals ----
  let key = c.of;
  if (key === 'deer' && c.v === 1 && A.has('deer_doe_e')) key = 'deer_doe';
  const S = sideOf(T, A, key);
  if (!S) return;
  const sc = c.sc || 1;
  const flip = c.f === 'w' ? -1 : 1;
  const u = clamp01(tsince * 2.6);
  const k = u < 0.7 ? easeIn(u / 0.7) : 1 - Math.sin(((u - 0.7) / 0.3) * Math.PI) * 0.08;
  const s = S.s;
  const sz = SIZE[c.of] || 'm';
  if (S.dead) {
    // spiders: on their back, no rotation; the "skeleton" is a dry husk
    const dry = sm(1.88, 2.2, age);
    const fade = 1 - sm(4.9, 5, age);
    if (dry > 0) mix3(tint, ROT_A, DRY_A, dry); else mix3(tint, FRESH_A, ROT_A, rotK);
    const a = fade * (1 - gone);
    const shr = (1 - 0.12 * dry) * shrink;
    if (T.blob) B.blob.add(T.blob, c.x, c.y, s.w * 0.7 * sc, 0.6 * sc, 1, 1, 1, 0.45 * a);
    B.decor.add(s, c.x, c.y, sc * shr, sc * shr * (1 - 0.15 * dry), tint[0], tint[1], tint[2], a, 0, 0, 0, flip, 1, 0);
    return;
  }
  const rot = flip * HALF_PI * k;
  const off = s.h * s.ay * 0.45 * sc;
  viewPt(c.x, c.y, -flip * off * k, 0.05 * k);
  const x = VX, y = VY;
  // blood pool under a fresh body / carcass
  if (T.soft && (age < 0.6 || c.butchered) && age < 1.9) {
    const ba = (c.butchered ? 0.55 : 0.4) * (1 - sm(0.3, 1.9, age)) * clamp01(tsince * 1.5);
    viewPt(c.x, c.y, 0, 0.05);
    B.decor.add(T.soft, VX, VY, (s.h * s.ay * sc * 1.3) / T.soft.w, (s.w * sc * 0.85) / T.soft.w, 0.32, 0.04, 0.04, ba, 0, 0, 0, 1, 1, 0);
  }
  if (bodyA > 0.01) {
    if (T.blob) B.blob.add(T.blob, c.x, c.y, s.w * 0.8 * sc, 0.7 * sc, 1, 1, 1, 0.5 * bodyA);
    // butchered: the skinned body (raw tint) with its flank opened (ribs exposed)
    if (c.butchered) mix3(tint, RAW_A, ROT_RAW, rotK); else mix3(tint, FRESH_A, ROT_A, rotK);
    const sunk = 1 - 0.08 * rotK;
    B.decor.add(s, x, y, sc, sc * sunk, tint[0], tint[1], tint[2], bodyA, 0, rot, 0, flip, 1, 0);
    const K = c.butchered ? T.carc[sz] : null;
    if (K) {
      const ks = (s.w * sc) / K.w, kt = 1 - 0.35 * rotK;
      B.decor.add(K, x, y, ks, ks * sunk, kt, kt * (1 - 0.15 * rotK), kt * (1 - 0.3 * rotK), bodyA, 0, rot, 0, flip, 1, 0);
    }
    if (rotK > 0.05 && T.rot[0]) {
      const L = s.w * sc;
      viewPt(c.x, c.y, 0, -L * 0.08);
      B.decor.add(T.rot[0], VX, VY, L * 0.6, L * 0.55, 1, 1, 1, 0.7 * rotK * bodyA, 0, flip * 1.3, 0, flip, 1, 0.03);
      viewPt(c.x, c.y, flip * 0.08, L * 0.2);
      B.decor.add(T.rot[1], VX, VY, L * 0.34, L * 0.34, 1, 1, 1, 0.55 * rotK * bodyA, 0, -flip * 0.8, 0, -flip, 1, 0.05);
    }
  }
  const K = T.skel[sz];
  if (K && skelA > 0.01) {
    const ks = ((s.w * sc) / K.w) * shrink;
    if (T.blob) B.blob.add(T.blob, c.x, c.y, s.w * 0.6 * sc, 0.5 * sc, 1, 1, 1, 0.28 * skelA);
    B.decor.add(K, x, y, ks, ks, bone[0], bone[1], bone[2], skelA, 0, rot, 0, flip, 1, gone * 0.25);
  }
}

// flies over a rotten body (cosmetic): n flies on lissajous loops; amount 0..1
export function drawFlies(B, A, c, amount, t, n = 5) {
  const T = tables(A);
  if (!T.fly || amount <= 0.02) return;
  const ph = c._ph || 0;
  viewPt(c.x, c.y, c.of === 'pawn' ? (c.f === 'w' ? 1 : -1) * 0.4 : 0, -0.05);
  const cx = VX, cy = VY;
  for (let i = 0; i < n; i++) {
    const a = t * (2.1 + i * 0.37) + ph + i * 1.7, b = t * (3.3 + i * 0.29) + i;
    const x = cx + Math.sin(a) * (0.32 + 0.08 * i), y = cy + Math.sin(b * 0.5) * 0.12;
    const lift = 0.22 + 0.12 * Math.sin(b) + 0.05 * i;
    const wing = 0.85 + 0.15 * Math.sin(t * 60 + i * 2);
    B.fx.add(T.fly, x, y, 1.1 * wing, 1.1, 1, 1, 1, 0.9 * amount, 0, Math.cos(a) * 0.4, 0, Math.cos(a) > 0 ? 1 : -1, 0, lift);
  }
}
