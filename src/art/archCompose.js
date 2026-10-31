// Drawing of styled construction pieces and decoration props (agent K). Called from composeWorld.drawStatic for
// objects with a decoded look (o._k, see content/kits.js) and for K's own types (decor, stone wall, hedge).
// Reads state only; allocation-free per frame (sprite tables cached per atlas). Night glow of windows / lamps reads
// KIT_ENV.night (cosmetic, set every frame by the kit system).
//
// Base piece = one sprite per style × mask; every detail is an overlay drawn right after it (same anchor),
// corner pieces come one per corner in the style's material family (art/arch.js CORNER_FAM), tones multiply the base colour.
// Lazy art: style variants, details and decoration are painted on demand into the shared lazy texture (records with
// u < 0, art/lazyDefs.js). A record not painted yet is requested (want) and skipped this frame by the batch wrapper;
// styled bases fall back to the baked default look of the piece meanwhile. KIT_ENV.sync (previews) paints at once.

import { BUILDINGS } from '../game/content/buildings.js';
import { STRUCT_GEOM as SG } from './structures.js';
import { ARCH_GEOM as AG, SOFT_MASKS, CORNER_FAM, WOOD_FAMS, STONE_FAMS, QUOIN_FAMS, CORNERS } from './arch.js';
import { DECOR_GEOM as DG, DECOR_ROT2 } from './decor.js';
import { LAZY_DEFS, LAZY_GROUPS } from './lazyDefs.js';
import { lookAtlasOf, LOOK_CLOCK } from './look/lazy.js';

export const KIT_ENV = { night: 0, sync: false, game: null, ents: [] }; // game / ents: set each frame by decoration.js

// The night glow of a window is drawn after everything (additive), so nothing in front of the wall would hide it: skip
// it when the face is covered — an upper floor or a stair right in front of the wall, or someone standing before it.
function faceCovered(o) {
  const g = KIT_ENV.game, w = g?.world;
  if (!w || o.ty + 1 >= w.H) return false;
  const lv = o.lv | 0, N = w.W * w.H, i = (o.ty + 1) * w.W + o.tx, G = g.build?.grid;
  if (G) {
    const up = G.floor?.get(i + (lv + 1) * N);
    if (up && !up.blueprint) return true;
    const st = G.main?.get(i + lv * N);
    if (st && BUILDINGS[st.type]?.block === 'stairs') return true;
  }
  const cx = o.tx + 0.5, y0 = o.ty + 1;
  for (const e of KIT_ENV.ents) {
    const ez = (e.z || 0) - lv;
    if (Math.abs(e.x - cx) < 0.62 && e.y > y0 - 0.05 && e.y < y0 + 1.5 + Math.max(0, ez)) return true;
  }
  return false;
}
// wall-mounted decor was placed for a 26-px face: raise it to the middle of today's taller story (agent L)
const MOUNT_UP = Math.max(0, SG.FH - 26 / 64) * 0.5;
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

// ---------- lazy sprites ----------
let LA = null; // lazy atlas of the atlas being drawn
// usable now? (baked sprites always; lazy records once painted — else requested, or painted at once in sync mode)
function ok(s) {
  if (s.ready === undefined) return true;
  if (s.ready) { s.lu = LOOK_CLOCK.f; return true; }
  if (s.failed || !LA) return false;
  if (KIT_ENV.sync) { LA.paintNow(s); if (s.ready) return true; return false; }
  LA.want(s);
  return false;
}
const use = (s) => (s && ok(s) ? s : null);
class LBatch { // forwards to a render batch, dropping lazy sprites that are not painted yet
  constructor(t) { this.t = t; }
  add(s, x, y, sx, sy, r, g, b, a, sway, rot, flash, flip, recv, lift) { if (s && ok(s)) this.t.add(s, x, y, sx, sy, r, g, b, a, sway, rot, flash, flip, recv, lift); }
  addRaw(x, y, w, h, r, g, b, a) { this.t.addRaw(x, y, w, h, r, g, b, a); }
}
const WRAP = new WeakMap();
function wrap(B) {
  let W = WRAP.get(B);
  if (!W) { W = {}; for (const k of ['main', 'ground', 'shadow', 'emissive', 'blob', 'fx', 'light', 'decor']) if (B[k]) W[k] = new LBatch(B[k]); WRAP.set(B, W); }
  return W;
}
// paint the lazy art of what is in the world now (after a load / snapshot): a dry draw of every K piece requests its
// sprites, then up to `budget` ms of painting at once (the loading screen is still up); the rest follows per frame
const NB = { add() {}, addRaw() {} };
const NULLB = { main: NB, ground: NB, shadow: NB, emissive: NB, blob: NB, fx: NB, light: NB, decor: NB };
export function prewarmArch(game, budget = 600) {
  const A = game.A;
  if (!A || !game.build) return 0;
  const T = tables(A);
  for (const o of game.build.structures) if (o._k || ARCH_TYPES.has(o.type)) { try { drawArch(NULLB, A, o, 0, 0); } catch { /* keep going */ } }
  const q = T.LA.queue.length;
  if (q) T.LA.tick(budget);
  return q;
}
// a K sprite by name for other modules (roof props): the record / atlas sprite when drawable now, else null (requested)
export function archSprite(A, name) {
  const T = tables(A);
  LA = T.LA;
  return use(T.opt(name));
}

// ---------- sprite tables ----------
const CACHE = new WeakMap();
function tables(A) {
  let T = CACHE.get(A);
  if (T) return T;
  const LZ = lookAtlasOf(A);
  const opt = (n) => (A.has(n) ? A.get(n) : LAZY_DEFS.has(n) ? LZ.get(n) : null);
  const arr = (pre, n = 16) => { const a = []; for (let m = 0; m < n; m++) a.push(opt(pre + m)); return a[0] ? a : null; };
  T = { opt, LA: LZ, blob: opt('fx_blob'), glow: opt('fx_glow') || opt('fx_soft'), flames: [opt('fx_flame_0') || opt('fx_flame'), opt('fx_flame_1') || opt('fx_flame'), opt('fx_flame_2') || opt('fx_flame')],
    drop: opt('fx_drop') || opt('fx_soft'), ring: opt('fx_ring'), wall: {}, wallSoft: {}, fence: {}, floorEdge: {}, d: {}, face: {} };
  for (const st of ['plank', 'cut', 'log', 'timber', 'tbrick', 'wattle', 'rough', 'cobble']) {
    T.wall[st] = st === 'plank' ? arr('wall_wood_') : st === 'cut' ? arr('wall_stone_') : arr(`wst_${st}_`);
    const s = []; for (let m = 0; m < 16; m++) s.push(opt(`wst_${st}_s${m}`)); T.wallSoft[st] = s;
  }
  for (const st of ['rail', 'picket', 'board', 'wattle', 'stone', 'hedge']) T.fence[st] = st === 'rail' ? arr('fence_wood_') : arr(`kfe_${st}_`);
  for (const k of ['wood', 'stone', 'inlay', 'carpet', 'body']) T.floorEdge[k] = opt('kfx_' + k);
  T.floorBase = { plank: arr('floor_wood_'), flag: arr('floor_stone_') };
  for (const st of ['herring', 'parquet', 'wide', 'cobble', 'tiles', 'checker']) T.floorBase[st] = opt('kf_' + st);
  // corner pieces per material family × corner, buttresses per family, wooden trims per wood family (art/arch.js)
  T.cp = {};
  for (const k of ['post', 'pillar', 'endp', 'quoin']) {
    T.cp[k] = {};
    for (const f of k === 'quoin' ? QUOIN_FAMS : [...WOOD_FAMS, ...STONE_FAMS]) { const q = {}; for (const c of CORNERS) q[c] = opt(`kd_${k}_${f}_${c}`); T.cp[k][f] = q; }
  }
  T.bt = {}; for (const f of [...WOOD_FAMS, ...STONE_FAMS]) T.bt[f] = opt('kd_bt_' + f);
  T.capw = {}; T.crenw = {}; T.bandw = {};
  for (const f of WOOD_FAMS) {
    T.capw[f] = { n: opt(`kd_capw_${f}_n`), s: opt(`kd_capw_${f}_s`), w: opt(`kd_capw_${f}_w`) };
    T.crenw[f] = { n: opt(`kd_crenw_${f}_n`), s: opt(`kd_crenw_${f}_s`), w: opt(`kd_crenw_${f}_w`) };
    T.bandw[f] = opt('kd_bandw_' + f);
  }
  for (const n of ['plinth', 'cap_n', 'cap_s', 'cap_w',
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
const spriteOf = (A, type, v) => {
  if (A.groups[type]) return A.pick(type, v | 0);
  if (A.has(type)) return A.get(type);
  const n = LAZY_GROUPS.get(type);
  return tables(A).opt(n ? `${type}_${(((v | 0) % n) + n) % n}` : type);
};
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
// a detail standing out of its wall (pillar, buttress, log ends…) casts its shadow with the wall's mapping: the same
// nominal box as the wall sprite `base`, so both silhouettes land on the same footprint (MAX blend: no double dark)
function detShadow(B, s, base, x, y) { if (!BP && s && base) B.shadow.add(s, x, y - base.ay, 1, -1 / (0.6 * base.h), 1, 1, 1, CA, 0, 0, 0, 1, 0, SG.FH * 1.1); }
const WOODF = new Set(WOOD_FAMS);
// corners of a wall tile: convex ones (corner pieces) and the ones at a free end (end caps)
const CONVEX = [];
const ENDS = [];
for (let m = 0; m < 16; m++) {
  CONVEX.push(CORNERS.filter((c) => !(m & (c[0] === 'n' ? 1 : 4)) && !(m & (c[1] === 'w' ? 8 : 2))));
  ENDS.push(m === 8 ? ['ne', 'se'] : m === 2 ? ['nw', 'sw'] : m === 1 ? ['sw', 'se'] : m === 4 ? ['nw', 'ne'] : m === 0 ? CORNERS : []);
}
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
export function drawArch(B0, A, o, t, fl) {
  const type = o.type;
  const B = wrap(B0);
  LA = tables(A).LA;
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
  const base = (soft && use(T.wallSoft[st]?.[m])) || use(T.wall[st]?.[m]) || T.wall[o.type === 'wall_stone' ? 'cut' : 'plank']?.[m];
  if (!base) return false;
  const x = o.x, y = o.y, D = T.d;
  const front = !(m & 4);
  // material: the style's corner family (wood looks get wooden pieces in the wall's colours); stone pieces take the
  // tone on stone walls and stay plain on wooden ones (only the "de pedra" options are stone on wood)
  const stoneType = o.type === 'wall_stone' || BUILDINGS[o.type].mat === 'stone';
  const fam = CORNER_FAM[st] || (stoneType ? 'cut' : 'plank'), woodLook = WOODF.has(fam);
  const S = stoneType ? add : addPlain, M = woodLook ? add : S;
  B.main.add(base, x, y, 1, 1, TR, TG, TB, CA, 0, 0, fl, 1);
  if (!BP) blockShadow(B, base, x, y, CA);
  // trims on the top face edges
  if (on.cap) {
    const C = woodLook ? T.capw[fam] : { n: D.cap_n, s: D.cap_s, w: D.cap_w };
    if (!(m & 1)) M(B, C.n, x, y, 1, 1, fl); if (!(m & 8)) M(B, C.w, x, y, 1, 1, fl); if (!(m & 2)) M(B, C.w, x, y, -1, 1, fl); if (front) M(B, C.s, x, y, 1, 1, fl);
  }
  if (front) {
    if (on.plinth) S(B, D.plinth, x, y, 1, 1, fl);
    if (on.beams) add(B, D.beams, x, y, 1, 1, fl);
    if (on.band) M(B, woodLook ? T.bandw[fam] : D.band, x, y, 1, 1, fl);
    if (on.buttress) { const s = T.bt[fam]; M(B, s, x, y, 1, 1, fl); detShadow(B, s, base, x, y); }
  }
  // nature (under the mounted things)
  if (on.weather && front) addPlain(B, D.weather, x, y, 1, 0.9, fl);
  if (on.moss) addPlain(B, (o.tx + o.ty) & 1 ? D.moss_1 : D.moss_0, x, y, 1, 1, fl);
  if (on.cracks) addPlain(B, hash(o.tx, o.ty) < 0.5 ? D.cracks_0 : D.cracks_1, x, y, hash(o.ty, o.tx) < 0.5 ? 1 : -1, 1, fl);
  // corner pieces (one sprite per corner, lit from the top-left on both sides): convex corners; end caps at free ends
  const cp = on.post ? 'post' : on.quoin ? 'quoin' : on.pillar ? 'pillar' : on.endcap ? 'endp' : null;
  if (cp) {
    const set = T.cp[cp][cp === 'quoin' ? (woodLook ? (stoneType ? 'cut' : 'lime') : fam) : fam];
    const P = cp === 'quoin' ? S : M;
    for (const c of cp === 'endp' ? ENDS[m] : CONVEX[m]) { const s = set[c]; if (s) { P(B, s, x, y, 1, 1, fl); detShadow(B, s, base, x, y); } }
  }
  if (on.crenel) {
    const C = woodLook ? T.crenw[fam] : { n: D.cren_n, s: D.cren_s, w: D.cren_w };
    if (!(m & 1)) M(B, C.n, x, y, 1, 1, fl); if (!(m & 8)) M(B, C.w, x, y, 1, 1, fl); if (!(m & 2)) M(B, C.w, x, y, -1, 1, fl); if (front) M(B, C.s, x, y, 1, 1, fl);
  }
  if (front) {
    // openings / mounted things on the south face
    const win = on.window ? 'window' : on.window_shutters ? 'shutters' : on.window_curtains ? 'curtains' : on.window_round ? 'oculus' : on.slit ? 'slit' : null;
    if (win) {
      addPlain(B, D[win], x, y, 1, 1, fl);
      const n = KIT_ENV.night;
      if (!BP && n > 0.05 && win !== 'slit' && !faceCovered(o)) {
        const g = win === 'oculus' ? D.oculus_glow : D.win_glow;
        const f = 0.88 + 0.08 * Math.sin(t * 2.1 + o.tx * 1.7) + 0.04 * Math.sin(t * 7.3 + o.ty);
        if (g) B.emissive.add(g, x, y, 1, 1, 1, 0.78, 0.45, n * f, 0, 0, 0, 1);
        B.light.addRaw(x, y - 0.1, 1.9, 1.3, 1, 0.7, 0.42, 0.22 * n);
      }
    }
    if (on.winbox) addPlain(B, D.winbox, x, y, 1, 1, fl);
    const mt = on.shelf ? 'shelf' : on.hooks ? 'hooks' : on.antlers ? 'antlers' : on.pennant ? 'pennant' : on.painting ? 'painting' : on.shield ? 'shield' : on.sconce ? 'sconce' : null;
    if (mt && !FACE_SIDE) {
      addPlain(B, D[mt], x, y, 1, 1, fl);
      if (mt === 'sconce' && !BP) smallFlame(B, T, x + 4 / 64, y, AG.sconceLift, 1, t, 0.8);
    }
    if (on.flowers) addPlain(B, D.flowers, x, y, 1, 1, fl);
  }
  if (on.ivy && front) addPlain(B, D['ivy_' + (((o.tx * 7 + o.ty * 3) % 3 + 3) % 3)], x, y, hash(o.tx + 1, o.ty) < 0.5 ? 1 : -1, 1, fl); // (ivy needs a visible face)
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
  const s = use(T.fence[st]?.[m]) || T.fence.rail?.[m];
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
  const L0 = T.gate[st] || T.gate.rail, L = use(L0.h) && use(L0.v) ? L0 : T.gate.rail;
  const orient = o.orient || (o.mask != null && !(o.mask & 10) && (o.mask & 5) ? 'v' : 'h');
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
  const L0 = T.door[st] || T.door.plank, L = use(L0.h) && use(L0.v) ? L0 : T.door.plank;
  const orient = o.orient || (o.mask != null && !(o.mask & 10) && (o.mask & 5) ? 'v' : 'h');
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
    if (on.lantern) { addPlain(B, D.dlantern, x, y, 1, 1, fl); if (!BP) lanternGlow(B, T, x + 28.6 / 64, y, AG.dlanternLift, t); }
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
  let tab = T.floorBase[st];
  if (!Array.isArray(tab) && !use(tab)) tab = T.floorBase[stone ? 'flag' : 'plank'];
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
    const col = on.c_blue ? [0.3, 0.42, 0.82] : on.c_green ? [0.34, 0.58, 0.32] : on.c_gold ? [0.98, 0.74, 0.32] : [0.78, 0.24, 0.2];
    const body = T.floorEdge.body;
    if (body) B.ground.add(body, o.tx + 0.5, o.ty + 0.5, 1, 1, CR * col[0], CG * col[1], CB * col[2], CA, 0, 0, 0, 1, 1);
    edges(B, T.floorEdge.carpet, o, (o._cm | 0) & 15, CR, CG, CB, CA);
  }
  return true;
}
// farm plot overlays (composeWorld draws the plot and its crop)
export function drawPlotKit(B0, A, o) {
  const k = o._k;
  if (!k) return;
  const B = wrap(B0), T = tables(A), m = (o.mask | 0) & 15;
  LA = T.LA;
  setState(o);
  const e = k.on.e_wood ? T.floorEdge.wood : k.on.e_stone ? T.floorEdge.stone : null;
  if (e) edges(B, e, o, m, CR, CG, CB, CA);
  if (k.on.straw) B.ground.add(T.d['fl_straw_' + (hash(o.tx, o.ty) < 0.5 ? 0 : 1)], o.x, o.y, 1, 1, CR, CG, CB, CA, 0, 0, 0, 1, 1);
}

// ---------- camera rotation: pieces as computed faces (docs/CAMERA-ROTATION.md) ----------
// CAMV: the camera yaw (cos, sin) and the light's direction on the ground (game.js sets them every frame).
// A piece's own painters draw it into a recorder (the same layers as in the north view: base, trims, windows,
// posts, ivy, glows…); every layer drawn in the piece's frame is then laid on the faces: its top half on the top of
// the box, its facade half on each side that faces the camera (the facade drawn as if that side's neighbours were
// left and right). Inner sides (another wall next to it) are never drawn.
export const CAMV = { c: 1, s: 0, lx: 0.5, ly: 0.7 };
let FACE_SIDE = false;      // recording the facade of a back / end side: no shelves / paintings on it
let CUR_LIGHT = null;       // light batch the recordings forward their light pools to (or none)
class RecB { constructor(a) { this.a = a; } add(s, x, y, sx = 1, sy = 1, r = 1, g = 1, b = 1, a = 1, sway = 0, rot = 0, flash = 0, flip = 1, recv = 0, lift = 0) { if (s) this.a.push([s, x, y, sx, sy, r, g, b, a, lift || 0, rot || 0]); } addRaw() {} }
const RM = [], RE = [], RG = [];
const FWD_LIGHT = { add() {}, addRaw(x, y, w, h, r, g, b, a) { if (CUR_LIGHT) CUR_LIGHT.addRaw(x, y, w, h, r, g, b, a); } };
const RB = { main: new RecB(RM), emissive: new RecB(RE), ground: new RecB(RG), decor: new RecB(RG), shadow: NB, blob: NB, fx: NB, light: FWD_LIGHT };
// a sprite's frame (w tiles wide, fh tall, anchor bottom-centre): tiles x0..x1, y0..y1 from its top-left → atlas uv
const uvF = (s, x0, y0, x1, y1, fh, flip = false) => {
  const fu = (x) => s.ax + (x - 0.5) / s.w, fv = (y) => s.ay + (y - fh) / s.h;
  const ua = s.u0 + (s.u1 - s.u0) * fu(x0), ub = s.u0 + (s.u1 - s.u0) * fu(x1);
  return [flip ? ub : ua, s.v0 + (s.v1 - s.v0) * fv(y0), flip ? ua : ub, s.v0 + (s.v1 - s.v0) * fv(y1)];
};
const uvBox = (s, x0, y0, x1, y1) => uvF(s, x0, y0, x1, y1, 2);
// draw piece o as its painters would, with another mask, into the recorder (RM main, RE glows, RG flat)
function recordPiece(A, o, mask, t, side, light) {
  RM.length = 0; RE.length = 0; RG.length = 0;
  const m0 = o.mask;
  if (mask != null) o.mask = mask; // sync-ok: drawn with another mask for this frame only, restored right below
  FACE_SIDE = side; CUR_LIGHT = light;
  try { drawArch(RB, A, o, t, 0); } finally { o.mask = m0; FACE_SIDE = false; CUR_LIGHT = null; } // sync-ok: restores the mask
}
const vis = (nx, ny) => -CAMV.s * nx + CAMV.c * ny > 0.02; // a side whose outside faces the viewer
const shadeOf = (nx, ny) => 0.8 - 0.2 * (nx * CAMV.lx + ny * CAMV.ly);
// the frame-aligned layers of a recording (drawn at the piece's anchor, unscaled, unlifted)
const layers = (L, o) => L.filter((r) => Math.abs(r[1] - o.x) < 1e-3 && Math.abs(r[2] - o.y) < 1e-3 && Math.abs(Math.abs(r[3]) - 1) < 1e-3 && Math.abs(r[4] - 1) < 1e-3 && !r[9] && !r[10]);
// one side of a box: corners left → right as seen from outside, from height hb to ht, every layer's facade on it
function sideQuads(F, Ls, ax, ay, bx, by, hb, ht, k, emis) {
  for (const r of Ls) {
    const uv = uvBox(r[0], 0, 1, 1, 2);
    if (r[3] < 0) { const u = uv[0]; uv[0] = uv[2]; uv[2] = u; }
    const a = emis ? -r[8] : r[8];
    F.quad(ax, ay, ht, bx, by, ht, bx, by, hb, ax, ay, hb, uv, r[5] * k, r[6] * k, r[7] * k, a);
  }
}
const solidUV = (T) => { const s = T.opt('fx_solid'); if (!s || !ok(s)) return null; const u = (s.u0 + s.u1) / 2, v = (s.v0 + s.v1) / 2; return [u, v, u, v]; };
// a box of flat colour (stairs, chimneys, slab edges): the sides that face the viewer, then the top
function flatBox(F, uv, x0, y0, x1, y1, hb, ht, col, side, a) {
  const S = (nx, ny) => shadeOf(nx, ny);
  if (vis(0, 1)) F.quad(x0, y1, ht, x1, y1, ht, x1, y1, hb, x0, y1, hb, uv, side[0] * S(0, 1), side[1] * S(0, 1), side[2] * S(0, 1), a);
  if (vis(0, -1)) F.quad(x1, y0, ht, x0, y0, ht, x0, y0, hb, x1, y0, hb, uv, side[0] * S(0, -1), side[1] * S(0, -1), side[2] * S(0, -1), a);
  if (vis(1, 0)) F.quad(x1, y1, ht, x1, y0, ht, x1, y0, hb, x1, y1, hb, uv, side[0] * S(1, 0), side[1] * S(1, 0), side[2] * S(1, 0), a);
  if (vis(-1, 0)) F.quad(x0, y0, ht, x0, y1, ht, x0, y1, hb, x0, y0, hb, uv, side[0] * S(-1, 0), side[1] * S(-1, 0), side[2] * S(-1, 0), a);
  F.quad(x0, y0, ht, x1, y0, ht, x1, y1, ht, x0, y1, ht, uv, col[0], col[1], col[2], a);
}

// a wall: its layers on the top; the facades on the sides that show. A door: a dark plank box (its leaf art has its
// own frames); an open door / gate: nothing in the way.
export function drawWallFaces(F, A, o, h0 = 0, t = 0, lightB = null) {
  if (!F) return false;
  if (o.open) return true;
  const T = tables(A);
  LA = T.LA;
  const def = BUILDINGS[o.type];
  const m = (o.mask | 0) & 15, H = SG.FH, hb = h0, ht = h0 + H;
  const x0 = o.tx, y0 = o.ty, x1 = x0 + 1, y1 = y0 + 1;
  const sS = !(m & 4) && vis(0, 1), sN = !(m & 1) && vis(0, -1), sE = !(m & 2) && vis(1, 0), sW = !(m & 8) && vis(-1, 0);
  if (def.block === 'door' || !o._k) {
    // a door (its leaf art has its own frames), or a wall of the default look (drawn by the base painters, not the
    // style kits): a box with the plain wall art — top from the piece's own sprite, sides from a straight piece
    const k = o._k;
    setState(o); tone(k);
    const fb = o.type === 'wall_stone' || def.mat === 'stone' ? 'cut' : 'plank';
    const top = use(T.wall[fb]?.[m]), side = use(T.wall[fb]?.[10]);
    if (!top || !side) return false;
    const dk = def.block === 'door' ? 0.72 : 1, tu = uvBox(top, 0, 0, 1, 1), fu = uvBox(side, 0, 1, 1, 2);
    const q = (ax, ay, bx, by, nx, ny) => { const z = shadeOf(nx, ny) * dk; F.quad(ax, ay, ht, bx, by, ht, bx, by, hb, ax, ay, hb, fu, TR * z, TG * z, TB * z, CA); };
    if (sS) q(x0, y1, x1, y1, 0, 1);
    if (sN) q(x1, y0, x0, y0, 0, -1);
    if (sE) q(x1, y1, x1, y0, 1, 0);
    if (sW) q(x0, y0, x0, y1, -1, 0);
    F.quad(x0, y0, ht, x1, y0, ht, x1, y1, ht, x0, y1, ht, tu, TR * dk, TG * dk, TB * dk, CA);
    return true;
  }
  // facades first (the top's rim overlaps them)
  if (sS || sN) {
    recordPiece(A, o, m & 10, t, !sS, lightB);
    const L = layers(RM, o), E = layers(RE, o);
    if (!L.length) return false;
    if (sS) { sideQuads(F, L, x0, y1, x1, y1, hb, ht, shadeOf(0, 1), false); sideQuads(F, E, x0, y1, x1, y1, hb, ht, 1, true); }
    else { sideQuads(F, L, x1, y0, x0, y0, hb, ht, shadeOf(0, -1), false); sideQuads(F, E, x1, y0, x0, y0, hb, ht, 1, true); }
  }
  if (sE || sW) {
    // along the east side, south is on the left; along the west side, north is
    const me = sE ? ((m & 4) ? 8 : 0) | ((m & 1) ? 2 : 0) : ((m & 1) ? 8 : 0) | ((m & 4) ? 2 : 0);
    recordPiece(A, o, me, t, true, (sS || sN) ? null : lightB);
    const L = layers(RM, o), E = layers(RE, o);
    if (sE) { sideQuads(F, L, x1, y1, x1, y0, hb, ht, shadeOf(1, 0), false); sideQuads(F, E, x1, y1, x1, y0, hb, ht, 1, true); }
    else { sideQuads(F, L, x0, y0, x0, y1, hb, ht, shadeOf(-1, 0), false); sideQuads(F, E, x0, y0, x0, y1, hb, ht, 1, true); }
  }
  recordPiece(A, o, m, t, false, null);
  const L = layers(RM, o);
  if (!L.length) return false;
  for (const r of L) {
    const uv = uvBox(r[0], 0, 0, 1, 1);
    if (r[3] < 0) { const u = uv[0]; uv[0] = uv[2]; uv[2] = u; }
    F.quad(x0, y0, ht, x1, y0, ht, x1, y1, ht, x0, y1, ht, uv, r[5], r[6], r[7], r[8]);
  }
  return true;
}

// a fence / hedge / stone wall run / gate: thin panels through the tile's middle (one per axis it runs along), each
// with the piece's own art drawn as a straight run; seen from both sides. An open gate: nothing in the way.
const FENCE_FH = (64 + 36) / 64, FENCE_FOOT = (36 + 32) / 64; // its frame (PH = 36 px above the tile) and its foot
export function drawFenceFaces(F, A, o, h0 = 0, t = 0) {
  if (!F) return false;
  if (o.open) return true;
  const T = tables(A);
  LA = T.LA;
  const def = BUILDINGS[o.type], m = (o.mask | 0) & 15;
  const k = o._k, gate = def.block === 'door';
  const draw = (mask) => {
    RM.length = 0; RE.length = 0; RG.length = 0;
    const m0 = o.mask; o.mask = mask; // sync-ok: drawn with another mask for this frame only, restored right below
    try {
      setState(o); tone(k);
      if (gate) drawFence(wrap(RB), T, o, k ? { ...k, style: T.fence[k.style] ? k.style : 'rail' } : null, t, 0);
      else drawArch(RB, A, o, t, 0);
    } finally { o.mask = m0; } // sync-ok: restores the mask
    return layers(RM, o);
  };
  const panel = (L, ax, ay, bx, by) => {
    for (const r of L) {
      const uv = uvF(r[0], 0, 0, 1, FENCE_FOOT, FENCE_FH);
      if (r[3] < 0) { const u = uv[0]; uv[0] = uv[2]; uv[2] = u; }
      F.quad(ax, ay, h0 + FENCE_FOOT, bx, by, h0 + FENCE_FOOT, bx, by, h0, ax, ay, h0, uv, r[5], r[6], r[7], r[8]);
    }
  };
  const x0 = o.tx, y0 = o.ty, cx = x0 + 0.5, cy = y0 + 0.5;
  const ns = !!(m & 5), ew = !!(m & 10) || !ns;
  let any = false;
  // the panel farther from the viewer first
  const order = [];
  if (ew) order.push(['ew', -CAMV.s * cx + CAMV.c * cy]);
  if (ns) order.push(['ns', -CAMV.s * cx + CAMV.c * cy + 0.001]);
  for (const [ax] of order) {
    if (ax === 'ew') { const L = draw(gate ? 10 : m & 10); if (L.length) { any = true; panel(L, x0, cy, x0 + 1, cy); } }
    else { const L = draw(((m & 1) ? 8 : 0) | ((m & 4) ? 2 : 0)); if (L.length) { any = true; panel(L, cx, y0, cx, y0 + 1); } }
  }
  return any;
}

// stairs (1×2, one story in 5 steps): solid steps in the plank colours of art/stairs.js, climbing from the entrance
export function drawStairFaces(F, A, o, h0 = 0) {
  if (!F) return false;
  const T = tables(A), uv = solidUV(T);
  if (!uv) return false;
  setState(o);
  const r = (o.rot | 0) & 3, N = 5, L = 2, RISE = SG.FH, a = CA;
  // d: the way up; the footprint starts at the entrance edge
  const d = [[0, -1], [1, 0], [0, 1], [-1, 0]][r];
  const fw = o.fw || (r & 1 ? 2 : 1), fh = o.fh || (r & 1 ? 1 : 2);
  const tread = [0.78 * CR, 0.6 * CG, 0.41 * CB], side = [0.48 * CR, 0.32 * CG, 0.2 * CB];
  const boxes = [];
  for (let k2 = 0; k2 < N; k2++) {
    const s0 = (k2 * L) / N, s1 = ((k2 + 1) * L) / N, hk = h0 + ((k2 + 1) * RISE) / N;
    let bx0, by0, bx1, by1;
    if (d[1] < 0) { bx0 = o.tx; bx1 = o.tx + fw; by1 = o.ty + fh - s0; by0 = o.ty + fh - s1; }
    else if (d[1] > 0) { bx0 = o.tx; bx1 = o.tx + fw; by0 = o.ty + s0; by1 = o.ty + s1; }
    else if (d[0] > 0) { by0 = o.ty; by1 = o.ty + fh; bx0 = o.tx + s0; bx1 = o.tx + s1; }
    else { by0 = o.ty; by1 = o.ty + fh; bx1 = o.tx + fw - s0; bx0 = o.tx + fw - s1; }
    const cxx = (bx0 + bx1) / 2, cyy = (by0 + by1) / 2;
    boxes.push([-CAMV.s * cxx + CAMV.c * cyy + hk * 0.5, bx0, by0, bx1, by1, hk]);
  }
  boxes.sort((p, q) => p[0] - q[0]);
  for (const [, bx0, by0, bx1, by1, hk] of boxes) flatBox(F, uv, bx0, by0, bx1, by1, h0, hk, tread, side, a);
  return true;
}

// an upper floor (story lv): its flat layers laid at its height, a thin slab edge on the sides that show
export function drawFloorFaces(F, A, o, h = 1, t = 0) {
  if (!F) return false;
  const T = tables(A);
  LA = T.LA;
  recordPiece(A, o, null, t, false, null);
  if (!RG.length) return false;
  for (const r of RG) {
    const sp = r[0], sx = r[3], sy = r[4];
    const l = r[1] - sp.ax * sp.w * sx, tp = r[2] - sp.ay * sp.h * sy, rr = l + sp.w * sx, bt = tp + sp.h * sy;
    F.quad(l, tp, h, rr, tp, h, rr, bt, h, l, bt, h, [sp.u0, sp.v0, sp.u1, sp.v1], r[5], r[6], r[7], r[8]);
  }
  const uv = solidUV(T);
  if (uv) {
    const m = (o.mask | 0) & 15, x0 = o.tx, y0 = o.ty, x1 = x0 + 1, y1 = y0 + 1, hb = h - 0.12, c = [0.42, 0.29, 0.18], a = o.alpha ?? 1;
    const q = (ax, ay, bx, by, nx, ny) => { const z = shadeOf(nx, ny); F.quad(ax, ay, h, bx, by, h, bx, by, hb, ax, ay, hb, uv, c[0] * z, c[1] * z, c[2] * z, a); };
    if (!(m & 4) && vis(0, 1)) q(x0, y1, x1, y1, 0, 1);
    if (!(m & 1) && vis(0, -1)) q(x1, y0, x0, y0, 0, -1);
    if (!(m & 2) && vis(1, 0)) q(x1, y1, x1, y0, 1, 0);
    if (!(m & 8) && vis(-1, 0)) q(x0, y0, x0, y1, -1, 0);
  }
  return true;
}

// something hung on a wall (painting, trophy, herbs, curtains, pot hooks): flat on that wall's face
export function drawMountFaces(F, A, o) {
  if (!F || !o._mount) return false;
  const r = o.rot | 0;
  if (r < 1 || r > 4) return false;
  const s = spriteOf(A, o.type, o.v);
  if (!s || !ok(s)) return false;
  setState(o);
  const gm = DG.mount[o.type], gs = gm?.s ?? 0.66, gl = gm?.l ?? (typeof gm === 'number' ? gm : 0.04);
  const W = gs, Hh = 0.6875 * gs, hb = gl + MOUNT_UP, ht = hb + Hh, e = 0.035, cx = o.tx + 0.5, cy = o.ty + 0.5, hw = W / 2;
  const uv = [s.u0, s.v0, s.u1, s.v1];
  // rot 1: on the wall to the north (seen from the south) · 2: east (seen from the west) · 3: south · 4: west
  let ax, ay, bx, by;
  if (r === 1) { const y = o.ty + e; ax = cx - hw; ay = y; bx = cx + hw; by = y; }
  else if (r === 3) { const y = o.ty + 1 - e; ax = cx + hw; ay = y; bx = cx - hw; by = y; }
  else if (r === 2) { const x = o.tx + 1 - e; ax = x; ay = cy - hw; bx = x; by = cy + hw; }
  else { const x = o.tx + e; ax = x; ay = cy + hw; bx = x; by = cy - hw; }
  F.quad(ax, ay, ht, bx, by, ht, bx, by, hb, ax, ay, hb, uv, CR, CG, CB, CA);
  return true;
}

// ---------- decoration props ----------
// how far above its anchor a decoration's art touches the ground (tiles): the lowest solid row of the sprite (feet,
// base; the faint baked ground shadow does not count), measured once per sprite. The art draws a 1-tile piece
// standing about mid-tile (Y(0.55…0.9, 0)): right for a piece placed on a tile (anchor = the tile's bottom edge), but a
// piece placed at an edge / against a wall is anchored at the front-bottom of its body (structures.setGeom), so it is
// drawn that much lower — it used to float above its shadow / hang on the wall (owner)
const FOOT = new WeakMap(), FOOT_DEF = 0.4;
let footCv = null;
function footOf(A, s) {
  if (!s) return FOOT_DEF;
  const known = FOOT.get(s);
  if (known !== undefined) return known;
  const lazy = s.u0 < 0 || s.canvas, src = lazy ? s.canvas : A.canvas;
  if (!src || !(s.pw > 0) || !(s.ph > 0) || typeof document === 'undefined') return FOOT_DEF; // (not painted yet: ask again)
  let f = FOOT_DEF;
  try {
    const AS = A.size, sx = lazy ? 0 : s.u0 * AS, sy = lazy ? 0 : s.v0 * AS, W = s.pw, H = s.ph;
    footCv = footCv || document.createElement('canvas');
    footCv.width = W; footCv.height = H;
    const g = footCv.getContext('2d', { willReadFrequently: true });
    g.clearRect(0, 0, W, H);
    g.drawImage(src, sx, sy, W, H, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data;
    let row = -1;
    for (let y = H - 1; y >= 0 && row < 0; y--) { let n = 0; for (let x = 0; x < W; x++) if (d[(y * W + x) * 4 + 3] > 150 && ++n >= 2) { row = y; break; } }
    if (row >= 0) f = Math.max(0, Math.min(1.2, (s.ay * H - (row + 1)) * (s.h / H)));
  } catch { /* keep the default */ }
  FOOT.set(s, f);
  return f;
}

function drawDecorProp(B, A, o, t, fl) {
  const T = tables(A), def = BUILDINGS[o.type], type = o.type; // (B: wrapped batches, see drawArch)
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
    if (r === 1 || !o._mount) B.main.add(s, x, y, g.s, g.s, CR, CG, CB, CA, 0, 0, fl, 1, 0, Math.max(0, y - o.ty) + g.l + MOUNT_UP);
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
  // where it stands: an edge piece's art drawn lower so its base lands on its anchor; a piece on a tile keeps its
  // art, its contact shadow goes up under its feet
  const one = h < 2 && !rot2, foot = one ? footOf(A, s) * sc : 0;
  const yd = def.edge ? y + foot : y, yb = one && !def.edge ? y - foot : y;
  // the sun shadow pivots on the feet, not on the sprite's bottom edge (it hung off them by foot): cast from there
  // with the art lowered by the same height (shadow shader: h = height above the anchor + lift)
  const ys = yd - foot, ls = -0.8 * foot;
  if (T.blob) B.blob.add(T.blob, x, yb - 0.06 - (h - 1) * 0.5, (0.62 + 0.38 * w) * sc, (0.4 + 0.6 * (h - 1)) * sc, 1, 1, 1, 0.38 * CA);
  if (type === 'training_dummy' && use(T.training_dummy_base) && use(T.training_dummy_body)) {
    const dt = t - (o._wobT ?? -99);
    const wob = dt >= 0 && dt < 2.5 ? (o._wobA || 0.6) * Math.exp(-dt * 3.2) * Math.sin(dt * 17) * (o._wobD || 1) * 0.3 : 0;
    B.main.add(T.training_dummy_base, x, yd, sc, sc, CR, CG, CB, CA, 0, 0, fl, 1);
    B.main.add(T.training_dummy_body, x, yd, sc, sc, CR, CG, CB, CA, 0, wob, Math.max(fl, o.flash || 0), 1);
    if (!BP) B.shadow.add(T.training_dummy_body, x, ys, sc, sc * 0.8, 1, 1, 1, CA, 0, wob, 0, 1, 0, ls);
    return;
  }
  const sway = type === 'scarecrow' || type === 'garden_arch' ? 0.015 : type === 'drying_rack' ? 0.02 : 0;
  B.main.add(s, x + shk, yd, sc * ff, sc, CR, CG, CB, CA, sway, 0, fl, 1);
  if (!BP && h < 2 && !rot2) B.shadow.add(s, x, ys, sc * ff, sc * 0.8, 1, 1, 1, CA, sway, 0, 0, 1, 0, ls);
  else if (!BP && rot2 && h < 2) B.shadow.add(s, x, y, sc * ff, sc * 0.7, 1, 1, 1, CA, 0, 0, 0, 1);
  if (BP) { overlaysBP(B, T, o); return; }
  // flames, glows, little animations
  const n = KIT_ENV.night;
  switch (type) {
    // (flames: DECOR_GEOM heights above the ground the art stands on — yd − foot — × the piece's scale)
    case 'candles': for (const [dx, lift] of DG.candles) smallFlame(B, T, x + dx * ff * sc, yd, foot + lift * sc, sc, t, 0.55); break;
    case 'candelabra': for (const [dx, lift] of DG.candelabra) smallFlame(B, T, x + dx * sc, yd, foot + lift * sc, sc, t, 0.55); break;
    case 'lamp_stone': if (T.lamp_stone_glow) B.emissive.add(T.lamp_stone_glow, x, yd, sc, sc, 1, 1, 1, 0.55 + 0.4 * n, 0, 0, 0, 1); smallFlame(B, T, x, yd, foot + (DG.lamp_stone[0][1] - 0.06) * sc, sc, t, 0.6); break;
    case 'lamp_wood': if (T.lamp_wood_glow) B.emissive.add(T.lamp_wood_glow, x, yd, sc * ff, sc, 1, 1, 1, 0.55 + 0.4 * n, 0, 0, 0, 1); break; // (mirrored with its lamp: the lantern hangs on one side)
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
