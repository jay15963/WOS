// Drawing of styled construction pieces and decoration props (agent K). Called from composeWorld.drawStatic for
// objects with a decoded look (o._k, see content/kits.js) and for K's own types (decor, stone wall, hedge).
// Reads state only; allocation-free per frame (sprite tables cached per atlas). Night glow of windows / lamps reads
// KIT_ENV.night (cosmetic, set every frame by the kit system).
//
// Base piece = one baked sprite per style × mask; every detail is an overlay drawn right after it (same anchor),
// NE / SE corner pieces are the NW / SW ones mirrored (sx = -1), tones multiply the base colour.

import { BUILDINGS } from '../game/content/buildings.js';
import { STRUCT_GEOM as SG } from './structures.js';
import { ARCH_GEOM as AG, SOFT_MASKS } from './arch.js';
import { DECOR_GEOM as DG, DECOR_ROT2 } from './decor.js';

export const KIT_ENV = { night: 0 };
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const SOFT = new Set(SOFT_MASKS);
const ROT_A = [0, Math.PI / 2, Math.PI, Math.PI * 1.5];
const DECOR = new Set(Object.keys(BUILDINGS).filter((k) => BUILDINGS[k].decor));
const ROT2 = new Set(DECOR_ROT2);
// types whose base art is K's (always drawn here)
export const ARCH_TYPES = new Set([...DECOR, 'fence_stone', 'hedge']);

// ---------- state (same rules as composeWorld.setState) ----------
let CR = 1, CG = 1, CB = 1, CA = 1, BP = false;
function setState(o) {
  const p = o.progress;
  BP = p != null && p < 1;
  const a = o.alpha ?? 1;
  if (o._ghost) { BP = true; if (o._ghost === 2) { CR = 1.6; CG = 0.42; CB = 0.36; } else { CR = 0.36; CG = 0.78; CB = 2.1; } CA = a * 0.72; }
  else if (BP) { CR = 0.34; CG = 0.72; CB = 2.0; CA = a * (0.62 + 0.3 * clamp01(p)); }
  else { CR = CG = CB = 1; CA = a; }
}
// base colour with the tone tint (finished pieces only)
let TR = 1, TG = 1, TB = 1;
function tone(k) { if (!BP && k && k.tint) { TR = CR * k.tint[0]; TG = CG * k.tint[1]; TB = CB * k.tint[2]; } else { TR = CR; TG = CG; TB = CB; } }

// ---------- sprite tables ----------
const CACHE = new WeakMap();
function tables(A) {
  let T = CACHE.get(A);
  if (T) return T;
  const opt = (n) => (A.has(n) ? A.get(n) : null);
  const arr = (pre, n = 16) => { const a = []; for (let m = 0; m < n; m++) a.push(opt(pre + m)); return a[0] ? a : null; };
  T = { opt, blob: opt('fx_blob'), glow: opt('fx_glow') || opt('fx_soft'), flames: [opt('fx_flame_0') || opt('fx_flame'), opt('fx_flame_1') || opt('fx_flame'), opt('fx_flame_2') || opt('fx_flame')],
    drop: opt('fx_drop') || opt('fx_soft'), ring: opt('fx_ring'), wall: {}, wallSoft: {}, fence: {}, floorEdge: {}, d: {}, face: {} };
  for (const st of ['plank', 'cut', 'log', 'timber', 'tbrick', 'wattle', 'rough', 'cobble']) {
    T.wall[st] = st === 'plank' ? arr('wall_wood_') : st === 'cut' ? arr('wall_stone_') : arr(`wst_${st}_`);
    const s = []; for (let m = 0; m < 16; m++) s.push(opt(`wst_${st}_s${m}`)); T.wallSoft[st] = s;
  }
  for (const st of ['rail', 'picket', 'board', 'wattle', 'stone', 'hedge']) T.fence[st] = st === 'rail' ? arr('fence_wood_') : arr(`kfe_${st}_`);
  for (const k of ['wood', 'stone', 'inlay', 'carpet', 'body']) T.floorEdge[k] = opt('kfx_' + k);
  T.floorBase = { plank: arr('floor_wood_'), flag: arr('floor_stone_') };
  for (const st of ['herring', 'parquet', 'wide', 'cobble', 'tiles', 'checker']) T.floorBase[st] = opt('kf_' + st);
  for (const n of ['post_nw', 'post_sw', 'quoin_nw', 'quoin_sw', 'pillar_nw', 'pillar_sw', 'end_e', 'end_s', 'end_n', 'buttress', 'plinth', 'cap_n', 'cap_s', 'cap_w',
    'cren_n', 'cren_s', 'cren_w', 'beams', 'band', 'window', 'shutters', 'curtains', 'oculus', 'slit', 'win_glow', 'oculus_glow', 'winbox', 'shelf', 'hooks', 'antlers',
    'pennant', 'painting', 'shield', 'sconce', 'ivy_0', 'ivy_1', 'ivy_2', 'moss_0', 'moss_1', 'cracks_0', 'cracks_1', 'weather', 'flowers', 'door_arch', 'awning',
    'dlantern', 'knocker', 'wreath', 'step']) T.d[n] = opt('kd_' + n);
  for (const n of ['cap_flat', 'cap_ball', 'cap_point', 'lantern', 'flowers', 'vines_h', 'vines_v', 'bird']) T.d['f_' + n] = opt('kfe_' + n);
  for (const n of ['arch', 'sign']) T.d['g_' + n] = opt('kg_' + n);
  for (const n of ['inlay', 'straw_0', 'straw_1', 'leaves_0', 'leaves_1', 'moss_0', 'moss_1']) T.d['fl_' + n] = opt('kf_' + n);
  T.door = {};
  for (const st of ['plank', 'panel', 'iron', 'arched', 'rustic']) {
    T.door[st] = st === 'plank' ? { h: opt('door_wood_h_leaf'), v: opt('door_wood_v_leaf') } : { h: opt(`kdr_${st}_h_leaf`), v: opt(`kdr_${st}_v_leaf`) };
  }
  T.gate = {};
  for (const st of ['rail', 'picket', 'board']) T.gate[st] = st === 'rail' ? { h: opt('gate_wood_h_leaf'), v: opt('gate_wood_v_leaf') } : { h: opt(`kg_${st}_h_leaf`), v: opt(`kg_${st}_v_leaf`) };
  for (const n of ['door_wood_h_frame', 'door_wood_v_frame', 'door_wood_v_post', 'door_wood_sill_h', 'door_wood_sill_v', 'gate_wood_h_frame', 'gate_wood_v_frame', 'gate_wood_v_post',
    'training_dummy_base', 'training_dummy_body', 'lamp_stone_glow', 'lamp_wood_glow']) T[n] = opt(n);
  CACHE.set(A, T);
  return T;
}
const spriteOf = (A, type, v) => (A.groups[type] ? A.pick(type, v | 0) : A.has(type) ? A.get(type) : null);
let FFLIP = 1;
function faceSprite(A, T, type, v, face) {
  FFLIP = 1;
  const base = spriteOf(A, type, v);
  if (!face || face === 's') return base;
  let fv = T.face[type];
  if (!fv) fv = T.face[type] = [T.opt(type + '_n'), T.opt(type + '_e')];
  if (face === 'n') { if (fv[0]) return fv[0]; FFLIP = -1; return base; }
  if (face === 'w') FFLIP = -1;
  return fv[1] || base;
}

function blockShadow(B, s, x, y, a) { B.shadow.add(s, x, y - s.ay, 1, -1 / (0.6 * s.h), 1, 1, 1, a, 0, 0, 0, 1, 0, SG.FH * 1.1); }
function smallFlame(B, T, x, y, lift, sc, t, k) {
  const ph = t * 11 + x * 2.3 + y;
  const q = 0.9 + 0.12 * Math.sin(ph) + 0.06 * Math.sin(ph * 2.3);
  if (T.flames[0]) B.emissive.add(T.flames[0], x + 0.012 * Math.sin(ph * 0.9), y, 0.3 * q * sc * k, 0.42 * q * sc * k, 1, 1, 1, 0.95, 0, 0.1 * Math.sin(ph * 0.6), 0, 1, 0, lift);
  if (T.flames[1]) B.emissive.add(T.flames[1], x, y, 0.2 * sc * k, 0.28 * (0.8 + 0.2 * Math.sin(ph * 1.7)) * sc * k, 1, 1, 1, 0.8, 0, -0.1, 0, 1, 0, lift + 0.03 * k);
  if (T.glow) B.emissive.add(T.glow, x, y, 0.5 * sc * k, 0.5 * sc * k, 1, 0.6, 0.3, 0.18, 0, 0, 0, 1, 0, lift + 0.08 * k);
}
const add = (B, s, x, y, sx, a, fl, lift = 0) => { if (s) B.main.add(s, x, y, sx, 1, TR, TG, TB, CA * a, 0, 0, fl, 1, 0, lift); };
const addPlain = (B, s, x, y, sx, a, fl, lift = 0) => { if (s) B.main.add(s, x, y, sx, 1, CR, CG, CB, CA * a, 0, 0, fl, 1, 0, lift); };

// ---------- entry ----------
// returns true when drawn here
export function drawArch(B, A, o, t, fl) {
  const type = o.type;
  if (DECOR.has(type)) { drawDecorProp(B, A, o, t, fl); return true; }
  const def = BUILDINGS[type];
  if (!def) return false;
  const k = o._k;
  const kit = k ? k.kit : def.connect === 'fence' ? (def.block === 'door' ? 'gate' : 'fence') : null;
  setState(o); tone(k);
  const T = tables(A);
  switch (kit) {
    case 'wall': return drawWall(B, T, o, k, t, fl);
    case 'fence': return drawFence(B, T, o, k, t, fl);
    case 'gate': return drawGate(B, T, o, k, t, fl);
    case 'door': return drawDoorK(B, T, o, k, t, fl);
    case 'floor': return drawFloor(B, T, o, k, fl);
  }
  return false;
}

// ---------- walls ----------
function drawWall(B, T, o, k, t, fl) {
  const m = (o.mask | 0) & 15, on = k.on, st = k.style;
  const soft = on.soft && SOFT.has(m);
  const base = (soft && T.wallSoft[st]?.[m]) || T.wall[st]?.[m];
  if (!base) return false;
  const x = o.x, y = o.y, D = T.d;
  const front = !(m & 4);
  B.main.add(base, x, y, 1, 1, TR, TG, TB, CA, 0, 0, fl, 1);
  if (!BP) blockShadow(B, base, x, y, CA);
  // trims on the top face edges
  if (on.cap) { if (!(m & 1)) addPlain(B, D.cap_n, x, y, 1, 1, fl); if (!(m & 8)) addPlain(B, D.cap_w, x, y, 1, 1, fl); if (!(m & 2)) addPlain(B, D.cap_w, x, y, -1, 1, fl); if (front) addPlain(B, D.cap_s, x, y, 1, 1, fl); }
  if (front) {
    if (on.plinth) addPlain(B, D.plinth, x, y, 1, 1, fl);
    if (on.beams) add(B, D.beams, x, y, 1, 1, fl);
    if (on.band) addPlain(B, D.band, x, y, 1, 1, fl);
    if (on.buttress) addPlain(B, D.buttress, x, y, 1, 1, fl);
  }
  // nature (under the mounted things)
  if (on.weather && front) addPlain(B, D.weather, x, y, 1, 0.9, fl);
  if (on.moss) addPlain(B, (o.tx + o.ty) & 1 ? D.moss_1 : D.moss_0, x, y, 1, 1, fl);
  if (on.cracks) addPlain(B, hash(o.tx, o.ty) < 0.5 ? D.cracks_0 : D.cracks_1, x, y, hash(o.ty, o.tx) < 0.5 ? 1 : -1, 1, fl);
  // corner pieces at convex corners (NE / SE mirrored)
  const cp = on.post ? 'post' : on.quoin ? 'quoin' : on.pillar ? 'pillar' : null;
  if (cp) {
    const nw = !(m & 1) && !(m & 8), ne = !(m & 1) && !(m & 2), sw = !(m & 4) && !(m & 8), se = !(m & 4) && !(m & 2);
    const sN = D[cp + '_nw'], sS = D[cp + '_sw'];
    const A2 = cp === 'post' ? add : addPlain;
    if (nw) A2(B, sN, x, y, 1, 1, fl); if (ne) A2(B, sN, x, y, -1, 1, fl);
    if (sw) A2(B, sS, x, y, 1, 1, fl); if (se) A2(B, sS, x, y, -1, 1, fl);
  } else if (on.endcap) {
    if (m === 8) addPlain(B, D.end_e, x, y, 1, 1, fl); else if (m === 2) addPlain(B, D.end_e, x, y, -1, 1, fl);
    else if (m === 1) addPlain(B, D.end_s, x, y, 1, 1, fl); else if (m === 4) addPlain(B, D.end_n, x, y, 1, 1, fl);
    else if (m === 0) { addPlain(B, D.end_e, x, y, 1, 1, fl); addPlain(B, D.end_e, x, y, -1, 1, fl); }
  }
  if (on.crenel) { if (!(m & 1)) addPlain(B, D.cren_n, x, y, 1, 1, fl); if (!(m & 8)) addPlain(B, D.cren_w, x, y, 1, 1, fl); if (!(m & 2)) addPlain(B, D.cren_w, x, y, -1, 1, fl); if (front) addPlain(B, D.cren_s, x, y, 1, 1, fl); }
  if (front) {
    // openings / mounted things on the south face
    const win = on.window ? 'window' : on.shutters ? 'shutters' : on.curtains ? 'curtains' : on.oculus ? 'oculus' : on.slit ? 'slit' : null;
    if (win) {
      addPlain(B, D[win], x, y, 1, 1, fl);
      const n = KIT_ENV.night;
      if (!BP && n > 0.05 && win !== 'slit') {
        const g = win === 'oculus' ? D.oculus_glow : D.win_glow;
        const f = 0.88 + 0.08 * Math.sin(t * 2.1 + o.tx * 1.7) + 0.04 * Math.sin(t * 7.3 + o.ty);
        if (g) B.emissive.add(g, x, y, 1, 1, 1, 0.78, 0.45, n * f, 0, 0, 0, 1);
        B.light.addRaw(x, y - 0.1, 1.9, 1.3, 1, 0.7, 0.42, 0.22 * n);
      }
    }
    if (on.winbox) addPlain(B, D.winbox, x, y, 1, 1, fl);
    const mt = on.shelf ? 'shelf' : on.hooks ? 'hooks' : on.antlers ? 'antlers' : on.pennant ? 'pennant' : on.painting ? 'painting' : on.shield ? 'shield' : on.sconce ? 'sconce' : null;
    if (mt) {
      addPlain(B, D[mt], x, y, 1, 1, fl);
      if (mt === 'sconce' && !BP) smallFlame(B, T, x + 4 / 64, y, 0.36, 1, t, 0.8);
    }
    if (on.flowers) addPlain(B, D.flowers, x, y, 1, 1, fl);
  }
  if (on.ivy) addPlain(B, D['ivy_' + (((o.tx * 7 + o.ty * 3) % 3 + 3) % 3)], x, y, hash(o.tx + 1, o.ty) < 0.5 ? 1 : -1, 1, fl);
  overlaysBP(B, T, o);
  return true;
}
// scaffold while under construction (frame stage)
function overlaysBP(B, T, o) {
  if (!BP || o._ghost || (o.progress || 0) <= 0.02) return;
  const sc = T.opt('scaffold_0');
  if (sc) B.main.add(sc, o.tx + (o.fw || 1) / 2, o.ty + (o.fh || 1), o.fw || 1, 1, 1, 1, 1, 0.9 * (o.alpha ?? 1), 0, 0, 0, 1);
}

// ---------- fences (+ stone wall, hedge) ----------
function drawFence(B, T, o, k, t, fl) {
  const m = (o.mask | 0) & 15, on = k ? k.on : {};
  const st = o.type === 'fence_stone' ? 'stone' : o.type === 'hedge' ? 'hedge' : k ? k.style : 'rail';
  const s = T.fence[st]?.[m];
  if (!s) return false;
  const x = o.x, y = o.y, D = T.d;
  const sway = st === 'hedge' ? 0.02 : 0;
  B.main.add(s, x, y, 1, 1, TR, TG, TB, CA, sway, 0, fl, 1);
  if (!BP) B.shadow.add(s, x, y - 0.5, 1, 1, 1, 1, 1, CA, sway, 0, 0, 1, 0, -0.5);
  const posts = st !== 'stone' && st !== 'hedge';
  if (on.flowers) addPlain(B, D.f_flowers, x, y, hash(o.tx, o.ty) < 0.5 ? 1 : -1, 1, fl);
  if (on.vines) { if (m & 10) addPlain(B, D.f_vines_h, x, y, 1, 1, fl); else if (m & 5) addPlain(B, D.f_vines_v, x, y, 1, 1, fl); else addPlain(B, D.f_vines_h, x, y, 1, 1, fl); }
  const lift = st === 'stone' ? -0.2 : st === 'hedge' ? -0.06 : 0;
  if (posts || st === 'stone') {
    const cap = on.cap_flat ? 'f_cap_flat' : on.cap_ball ? 'f_cap_ball' : on.cap_point ? 'f_cap_point' : null;
    if (cap && (posts || cap === 'f_cap_ball')) add(B, D[cap], x, y, 1, 1, fl, lift);
  }
  if (on.lantern) {
    addPlain(B, D.f_lantern, x, y, 1, 1, fl, lift);
    if (!BP) lanternGlow(B, T, x + AG.lanternFlame.x, y, AG.lanternFlame.lift + lift, t);
  }
  if (on.bird && hash(o.tx * 3, o.ty * 5) < 0.4) addPlain(B, D.f_bird, x, y, hash(o.ty, o.tx * 2) < 0.5 ? 1 : -1, 1, fl, lift);
  overlaysBP(B, T, o);
  return true;
}
function lanternGlow(B, T, x, y, lift, t) {
  const n = KIT_ENV.night;
  const f = 0.9 + 0.1 * Math.sin(t * 9 + x * 3) * Math.sin(t * 4.3 + y);
  if (T.glow) B.emissive.add(T.glow, x, y, 0.42, 0.42, 1, 0.78, 0.45, (0.25 + 0.55 * n) * f, 0, 0, 0, 1, 0, lift);
  if (T.flames[0]) B.emissive.add(T.flames[0], x, y, 0.1, 0.14 * f, 1, 1, 1, 0.9, 0, 0, 0, 1, 0, lift - 0.04);
}

// ---------- gates ----------
function drawGate(B, T, o, k, t, fl) {
  const on = k ? k.on : {}, st = k ? k.style : 'rail';
  const L = T.gate[st] || T.gate.rail;
  let orient = o.orient || 'h';
  const kk = 1 - 0.86 * clamp01(o._openT ?? (+o.open || 0));
  const x = o.x, y = o.y, x0 = x - 0.5, D = T.d;
  if (orient === 'h') {
    const frame = T.gate_wood_h_frame, leaf = L.h;
    if (!frame || !leaf) return false;
    if (on.arch) add(B, D.g_arch, x, y, 1, 0.98, fl);
    B.main.add(frame, x, y, 1, 1, TR, TG, TB, CA, 0, 0, fl, 1);
    B.main.add(leaf, x0 + SG.GATE_H.l, y, kk, 1, TR, TG, TB, CA, 0, 0, fl, 1);
    B.main.add(leaf, x0 + SG.GATE_H.r, y, -kk, 1, TR, TG, TB, CA, 0, 0, fl, 1);
    if (!BP) { B.shadow.add(frame, x, y - 0.5, 1, 1, 1, 1, 1, CA, 0, 0, 0, 1, 0, -0.5); B.shadow.add(leaf, x0 + SG.GATE_H.l, y - 0.5, kk, 1, 1, 1, 1, CA, 0, 0, 0, 1, 0, -0.5); B.shadow.add(leaf, x0 + SG.GATE_H.r, y - 0.5, -kk, 1, 1, 1, 1, CA, 0, 0, 0, 1, 0, -0.5); }
    const pl = 9 / 64, dx = 26.5 / 64;
    if (on.cap_ball) { add(B, D.f_cap_ball, x - dx, y, 1, 1, fl, pl); add(B, D.f_cap_ball, x + dx, y, 1, 1, fl, pl); }
    if (on.lantern) {
      addPlain(B, D.f_lantern, x - dx, y, -1, 1, fl, pl); addPlain(B, D.f_lantern, x + dx, y, 1, 1, fl, pl);
      if (!BP) { lanternGlow(B, T, x - dx - AG.lanternFlame.x, y, AG.lanternFlame.lift + pl, t); lanternGlow(B, T, x + dx + AG.lanternFlame.x, y, AG.lanternFlame.lift + pl, t); }
    }
    if (on.sign && kk > 0.9) addPlain(B, D.g_sign, x, y, 1, 1, fl);
  } else {
    const frame = T.gate_wood_v_frame, post = T.gate_wood_v_post, leaf = L.v;
    if (!frame || !post || !leaf) return false;
    B.main.add(frame, x, y, 1, 1, TR, TG, TB, CA, 0, 0, fl, 1);
    B.main.add(leaf, x, y - SG.GATE_V.a, 1, kk, TR, TG, TB, CA, 0, 0, fl, 1);
    B.main.add(leaf, x, y - SG.GATE_V.b, 1, -kk, TR, TG, TB, CA, 0, 0, fl, 1);
    B.main.add(post, x, y, 1, 1, TR, TG, TB, CA, 0, 0, fl, 1);
    if (!BP) { B.shadow.add(frame, x, y - 0.5, 1, 1, 1, 1, 1, CA, 0, 0, 0, 1, 0, -0.5); B.shadow.add(post, x, y - 0.5, 1, 1, 1, 1, 1, CA, 0, 0, 0, 1, 0, -0.5); }
    if (on.lantern) { addPlain(B, D.f_lantern, x, y, 1, 1, fl, 9 / 64); if (!BP) lanternGlow(B, T, x + AG.lanternFlame.x, y, AG.lanternFlame.lift + 9 / 64, t); }
  }
  overlaysBP(B, T, o);
  return true;
}

// ---------- doors ----------
function drawDoorK(B, T, o, k, t, fl) {
  const on = k.on, st = k.style;
  const L = T.door[st] || T.door.plank;
  const orient = o.orient || 'h';
  const kk = 1 - 0.86 * clamp01(o._openT ?? (+o.open || 0));
  const x = o.x, y = o.y, x0 = x - 0.5, D = T.d;
  if (orient === 'h') {
    const frame = T.door_wood_h_frame, leaf = L.h;
    if (!frame || !leaf) return false;
    if (on.step) B.ground.add(D.step, x, y + 0.02, 1, 1, CR, CG, CB, CA, 0, 0, 0, 1, 1);
    if (T.door_wood_sill_h) B.ground.add(T.door_wood_sill_h, x, y, 1, 1, TR, TG, TB, CA, 0, 0, 0, 1, 1);
    B.main.add(frame, x, y, 1, 1, TR, TG, TB, CA, 0, 0, fl, 1);
    B.main.add(leaf, x0 + SG.DOOR_H.l, y, kk, 1, TR, TG, TB, CA, 0, 0, fl, 1);
    B.main.add(leaf, x0 + SG.DOOR_H.r, y, -kk, 1, TR, TG, TB, CA, 0, 0, fl, 1);
    if (!BP) blockShadow(B, frame, x, y, CA);
    if (kk > 0.9) { if (on.knocker) addPlain(B, D.knocker, x, y, 1, 1, fl); if (on.wreath) addPlain(B, D.wreath, x, y, 1, 1, fl); }
    if (st === 'arched') addPlain(B, D.door_arch, x, y, 1, 1, fl);
    if (on.lantern) { addPlain(B, D.dlantern, x, y, 1, 1, fl); if (!BP) lanternGlow(B, T, x + 28.6 / 64, y, (26 - 10) / 64, t); }
    if (on.awning) add(B, D.awning, x, y, 1, 1, fl);
  } else {
    const frame = T.door_wood_v_frame, post = T.door_wood_v_post, leaf = L.v;
    if (!frame || !post || !leaf) return false;
    if (T.door_wood_sill_v) B.ground.add(T.door_wood_sill_v, x, y, 1, 1, TR, TG, TB, CA, 0, 0, 0, 1, 1);
    B.main.add(frame, x, y, 1, 1, TR, TG, TB, CA, 0, 0, fl, 1);
    B.main.add(leaf, x, y - SG.DOOR_V.a, 1, kk, TR, TG, TB, CA, 0, 0, fl, 1);
    B.main.add(leaf, x, y - SG.DOOR_V.b, 1, -kk, TR, TG, TB, CA, 0, 0, fl, 1);
    B.main.add(post, x, y, 1, 1, TR, TG, TB, CA, 0, 0, fl, 1);
    if (!BP) blockShadow(B, frame, x, y, CA);
  }
  overlaysBP(B, T, o);
  return true;
}

// ---------- floors ----------
// edge strips on the open sides (N strip: S mirrored, W / E rotated about the tile centre)
const HP = Math.PI / 2;
function edges(B, s, o, m, r, g, b, a) {
  if (!s) return;
  const cx = o.tx + 0.5, cy = o.ty + 0.5;
  if (!(m & 1)) B.ground.add(s, cx, cy, 1, 1, r, g, b, a, 0, 0, 0, 1, 1);
  if (!(m & 4)) B.ground.add(s, cx, cy, 1, -1, r, g, b, a, 0, 0, 0, 1, 1);
  if (!(m & 8)) B.ground.add(s, cx, cy, 1, 1, r, g, b, a, 0, -HP, 0, 1, 1);
  if (!(m & 2)) B.ground.add(s, cx, cy, 1, 1, r, g, b, a, 0, HP, 0, 1, 1);
}
function drawFloor(B, T, o, k, fl) {
  const m = (o.mask | 0) & 15, on = k.on, st = k.style;
  const stone = o.type === 'floor_stone';
  const tab = T.floorBase[st];
  const base = Array.isArray(tab) ? tab[m] : tab;
  if (!base) return false;
  const x = o.x, y = o.y, D = T.d;
  B.ground.add(base, x, y, 1, 1, TR, TG, TB, CA, 0, 0, fl, 1, 1);
  const brd = on.b_board ? 'wood' : on.b_curb ? 'stone' : on.b_inlay ? 'inlay' : null;
  if (!Array.isArray(tab) && !brd) edges(B, T.floorEdge[stone ? 'stone' : 'wood'], o, m, TR, TG, TB, CA);
  if (brd) edges(B, T.floorEdge[brd], o, m, CR, CG, CB, CA);
  const h = hash(o.tx, o.ty) < 0.5 ? 0 : 1;
  if (on.mossy) B.ground.add(D['fl_moss_' + h], x, y, 1, 1, CR, CG, CB, CA, 0, 0, 0, 1, 1);
  if (on.leaves) B.ground.add(D['fl_leaves_' + h], x, y, 1, 1, CR, CG, CB, CA, 0, 0, 0, 1, 1);
  if (on.straw) B.ground.add(D['fl_straw_' + h], x, y, 1, 1, CR, CG, CB, CA, 0, 0, 0, 1, 1);
  if (on.inlay && D.fl_inlay) B.ground.add(D.fl_inlay, x, y, 1, 1, CR, CG, CB, CA, 0, 0, 0, 1, 1);
  if (on.carpet) {
    const col = on.c_blue ? [0.42, 0.56, 0.9] : on.c_green ? [0.46, 0.7, 0.42] : on.c_gold ? [1, 0.82, 0.42] : [0.86, 0.32, 0.28];
    const body = T.floorEdge.body;
    if (body) B.ground.add(body, o.tx + 0.5, o.ty + 0.5, 1, 1, CR * col[0], CG * col[1], CB * col[2], CA, 0, 0, 0, 1, 1);
    edges(B, T.floorEdge.carpet, o, (o._cm | 0) & 15, CR, CG, CB, CA);
  }
  return true;
}
// farm plot overlays (composeWorld draws the plot and its crop)
export function drawPlotKit(B, A, o) {
  const k = o._k;
  if (!k) return;
  const T = tables(A), m = (o.mask | 0) & 15;
  setState(o);
  const e = k.on.e_wood ? T.floorEdge.wood : k.on.e_stone ? T.floorEdge.stone : null;
  if (e) edges(B, e, o, m, CR, CG, CB, CA);
  if (k.on.straw) B.ground.add(T.d['fl_straw_' + (hash(o.tx, o.ty) < 0.5 ? 0 : 1)], o.x, o.y, 1, 1, CR, CG, CB, CA, 0, 0, 0, 1, 1);
}

// ---------- decoration props ----------
function drawDecorProp(B, A, o, t, fl) {
  const T = tables(A), def = BUILDINGS[o.type], type = o.type;
  setState(o);
  const sc = o.s || 1, x = o.x, y = o.y;
  // flat pieces (rugs, stepping stones)
  if (def.flat) {
    const s = spriteOf(A, type, o.v);
    if (!s) return;
    if (o.tx != null && (def.size[0] > 1 || def.size[1] > 1)) B.ground.add(s, o.tx + (o.fw || 1) / 2, o.ty + (o.fh || 1) / 2, sc, sc, CR, CG, CB, CA, 0, def.rotate ? ROT_A[(o.rot | 0) & 3] : 0, fl, 1, 1);
    else B.ground.add(s, x, y, sc, sc, CR, CG, CB, CA, 0, 0, fl, 1, 1);
    return;
  }
  // wall-mounted: lifted onto the wall face behind (south faces only; side walls: seen edge-on)
  if (def.mount) {
    const s = spriteOf(A, type, o.v);
    if (!s) return;
    const g = DG.mount[type] || { l: 0.04, s: 0.66 };
    const r = o.rot | 0;
    if (r === 1 || !o._mount) B.main.add(s, x, y, g.s, g.s, CR, CG, CB, CA, 0, 0, fl, 1, 0, Math.max(0, y - o.ty) + g.l);
    else if (r === 2 || r === 4) B.main.add(s, x + (r === 2 ? 0.08 : -0.08), y, g.s * 0.28, g.s * 0.9, CR * 0.85, CG * 0.85, CB * 0.85, CA, 0, 0, fl, 1, 0, 0.12 + g.l);
    else B.main.add(s, x, y, g.s * 0.8, g.s * 0.5, CR, CG, CB, CA, 0, 0, fl, 1, 0, SG.FH + 0.02);
    return;
  }
  const rot2 = ROT2.has(type);
  const s = o.face ? faceSprite(A, T, type, o.v, o.face) : spriteOf(A, type, o.v);
  if (!s) return;
  const ff = o.face ? FFLIP : 1;
  const w = o.fw || def.size[0], h = o.fh || def.size[1];
  const shk = o.shake > 0 ? Math.sin(t * 57) * 0.025 * o.shake : 0;
  if (T.blob) B.blob.add(T.blob, x, y - 0.06 - (h - 1) * 0.5, (0.62 + 0.38 * w) * sc, (0.4 + 0.6 * (h - 1)) * sc, 1, 1, 1, 0.38 * CA);
  if (type === 'training_dummy' && T.training_dummy_base && T.training_dummy_body) {
    const dt = t - (o._wobT ?? -99);
    const wob = dt >= 0 && dt < 2.5 ? (o._wobA || 0.6) * Math.exp(-dt * 3.2) * Math.sin(dt * 17) * (o._wobD || 1) * 0.3 : 0;
    B.main.add(T.training_dummy_base, x, y, sc, sc, CR, CG, CB, CA, 0, 0, fl, 1);
    B.main.add(T.training_dummy_body, x, y, sc, sc, CR, CG, CB, CA, 0, wob, Math.max(fl, o.flash || 0), 1);
    if (!BP) B.shadow.add(T.training_dummy_body, x, y, sc, sc * 0.8, 1, 1, 1, CA, 0, wob, 0, 1);
    return;
  }
  const sway = type === 'scarecrow' || type === 'garden_arch' ? 0.015 : type === 'drying_rack' ? 0.02 : 0;
  B.main.add(s, x + shk, y, sc * ff, sc, CR, CG, CB, CA, sway, 0, fl, 1);
  if (!BP && h < 2 && !rot2) B.shadow.add(s, x, y, sc * ff, sc * 0.8, 1, 1, 1, CA, sway, 0, 0, 1);
  else if (!BP && rot2 && h < 2) B.shadow.add(s, x, y, sc * ff, sc * 0.7, 1, 1, 1, CA, 0, 0, 0, 1);
  if (BP) { overlaysBP(B, T, o); return; }
  // flames, glows, little animations
  const n = KIT_ENV.night;
  switch (type) {
    case 'candles': for (const [dx, lift] of DG.candles) smallFlame(B, T, x + dx * ff, y, lift, sc, t, 0.55); break;
    case 'candelabra': for (const [dx, lift] of DG.candelabra) smallFlame(B, T, x + dx, y, lift, sc, t, 0.55); break;
    case 'lamp_stone': if (T.lamp_stone_glow) B.emissive.add(T.lamp_stone_glow, x, y, sc, sc, 1, 1, 1, 0.55 + 0.4 * n, 0, 0, 0, 1); smallFlame(B, T, x, y, DG.lamp_stone[0][1] - 0.06, sc, t, 0.6); break;
    case 'lamp_wood': if (T.lamp_wood_glow) B.emissive.add(T.lamp_wood_glow, x, y, sc, sc, 1, 1, 1, 0.55 + 0.4 * n, 0, 0, 0, 1); break;
    case 'fireplace': {
      if (o.face && o.face !== 's') { if (T.glow) B.emissive.add(T.glow, x + (o.face === 'w' ? -0.3 : o.face === 'e' ? 0.3 : 0), y - 0.4, 1.2, 1.2, 1, 0.55, 0.25, 0.25, 0, 0, 0, 1, 0, 0.2); break; }
      const seed = x * 1.7 + y;
      for (let i = 0; i < 3; i++) {
        const ph = t * (8.5 + i * 2.3) + i * 2.1 + seed, q = 0.86 + 0.16 * Math.sin(ph);
        if (T.flames[i]) B.emissive.add(T.flames[i], x + (i - 1) * 0.16, y - 0.16, (i === 1 ? 0.6 : 0.44) * q, (i === 1 ? 0.62 : 0.46) * q, 1, 1, 1, 0.92, 0, (i - 1) * 0.2, 0, 1, 0, DG.fireplace.lift);
      }
      if (T.glow) B.emissive.add(T.glow, x, y - 0.2, 1.6, 1.0, 1, 0.55, 0.25, 0.22 + 0.05 * Math.sin(t * 9 + seed), 0, 0, 0, 1, 0, 0.1);
      break;
    }
    case 'fountain': {
      const cx = o.tx + 1, cy = o.ty + 1.2;
      for (let i = 0; i < 6; i++) {
        const u = (t * 0.9 + i / 6) % 1, a = (i / 6) * Math.PI * 2 + 0.4;
        const r = 0.12 + u * 0.32, lift = 0.75 + Math.sin(u * Math.PI) * 0.22 - u * 0.5;
        if (T.drop) B.fx.add(T.drop, cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.5 - 0.48, 0.12, 0.16, 0.8, 0.92, 1, 0.75 * (1 - u * 0.6), 0, 0, 0, 1, 0, Math.max(0, lift));
      }
      if (T.ring) { const u = (t * 0.5) % 1; B.ground.add(T.ring, cx, cy - 0.3, 0.6 + u * 0.9, (0.6 + u * 0.9) * 0.55, 0.85, 0.95, 1, 0.35 * (1 - u), 0, 0, 0, 1, 0); }
      break;
    }
    case 'beehive': {
      if (T.blob) for (let i = 0; i < 3; i++) { const a = t * (1.6 + i * 0.4) + i * 2.1; B.fx.add(T.blob, x + Math.cos(a) * 0.32, y - 0.1 + Math.sin(a * 1.3) * 0.12, 0.05, 0.05, 0.15, 0.12, 0.05, 0.85, 0, 0, 0, 1, 0, 0.4 + Math.sin(a * 2) * 0.1); }
      break;
    }
  }
}
