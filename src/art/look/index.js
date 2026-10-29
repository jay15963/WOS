// Look sprite registry (agent H): every catalogue part as a named definition { W, H, ax, ay, pad, paint(P) }.
// addLook(add) paints them all into the game atlas (sprites.js); the character creator paints single parts at
// k× through hipaint.js (same painters → the preview is exactly the in-game sprite, sharper).
// Names: lk_<part>_<id>_<dir> (see lookDefs); w (west) = mirrored e, like every pawn part.

import { rng } from '../paint.js';
import { BW, BH, FEET, HW, HH, NECK } from '../pawns.js';
import { CATALOG, entry } from './catalog.js';
import * as B from './body.js';
import * as F from './face.js';
import { paintHair, paintBeard, hasBack } from './hair.js';
import { atlasCanvas } from './hipaint.js';

const D3 = ['s', 'n', 'e'], D2 = ['s', 'e'];
export const HEMS = ['short', 'mid', 'long'];
export const HAIR_MODES = ['streaks', 'tips', 'roots'];
const seedOf = (s) => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };

const body = (name, fn, ow = 1.4, pad = 10) => ({ W: BW, H: BH, ax: 0.5, ay: FEET / BH, pad, paint: (P) => P.layer((g) => fn(g, rng(seedOf(name))), ow) });
const headD = (name, fn, ow = 0, pad = 10) => ({ W: HW, H: HH, ax: 0.5, ay: NECK / HH, pad, paint: (P) => P.layer((g) => fn(g, rng(seedOf(name))), ow) });

let DEFS = null;
// Map name → definition (built once; pure)
export function lookDefs() {
  if (DEFS) return DEFS;
  const M = new Map();
  const C = CATALOG;
  for (const d of D3) M.set('lk_skin_' + d, body('lk_skin_' + d, (g) => B.skinBody(g, d), 3.2));
  for (const e of C.top) for (const d of D3) {
    M.set(`lk_top_${e.id}_${d}`, body(`lk_top_${e.id}_${d}`, (g, r) => B.topBase(g, d, e, r), 1.5, 12));
    M.set(`lk_trim_${e.id}_${d}`, body(`lk_trim_${e.id}_${d}`, (g) => B.topTrim(g, d, e), 0.9, 12));
  }
  const necks = new Set(C.top.map((e) => e.p.neck));
  for (const n of necks) for (const d of B.necklineDirs(n)) M.set(`lk_neck_${n}_${d}`, body(`lk_neck_${n}_${d}`, (g) => B.neckline(g, d, n), 0));
  for (const e of C.pattern) if (e.id !== 'plain') for (const h of HEMS) for (const d of D3) {
    if (e.id === 'embroidered' && d === 'e' && h === 'short') { /* still drawn: hem band */ }
    M.set(`lk_pat_${e.id}_${h}_${d}`, body(`lk_pat_${e.id}_${h}_${d}`, (g, r) => B.pattern(g, d, e.id, h, r), 0));
  }
  for (const e of C.over) if (e.id !== 'none') for (const d of D3) {
    if ((e.p.kind === 'apron' && d === 'n') || (e.p.kind === 'corset' && d === 'n')) { /* back views still show ties / laces */ }
    M.set(`lk_over_${e.id}_${d}`, body(`lk_over_${e.id}_${d}`, (g, r) => B.overLayer(g, d, e, r), 1.3, 12));
  }
  for (const e of C.bottom) for (const d of D3) M.set(`lk_bot_${e.id}_${d}`, body(`lk_bot_${e.id}_${d}`, (g, r) => B.bottomBase(g, d, e, r), 1.4, 12));
  for (const e of C.shoes) {
    if (!e.p.bare) for (const d of D3) M.set(`lk_shoe_${e.id}_${d}`, body(`lk_shoe_${e.id}_${d}`, (g) => B.shoeBand(g, d, e), 1.2));
    for (const d of D2) M.set(`lk_foot_${e.id}_${d}`, { W: 18, H: 12, ax: 0.5, ay: 10.4 / 12, pad: 6, paint: (P) => P.layer((g) => B.foot(g, d, e), 1.4) });
  }
  // head & face
  for (const e of C.head) for (const d of D3) M.set(`lk_head_${e.id}_${d}`, headD(`lk_head_${e.id}_${d}`, (g) => F.head(g, d, e), 3.2));
  for (const e of C.ears) for (const d of D3) {
    const name = `lk_ears_${e.id}_${d}`;
    M.set(name, d === 'e' ? { W: HW, H: HH, ax: 0.5, ay: NECK / HH, pad: 10, paint: (P) => P.layer((g) => F.ears(g, d, e), 1, 'rgba(30,26,22,0.75)') } : headD(name, (g) => F.ears(g, d, e), 2.4));
  }
  for (const e of C.eyes) for (const d of D2) {
    M.set(`lk_eye_${e.id}_${d}`, headD(`lk_eye_${e.id}_${d}`, (g) => F.eyeBase(g, d, e), 0));
    M.set(`lk_iris_${e.id}_${d}`, headD(`lk_iris_${e.id}_${d}`, (g) => F.eyeIris(g, d, e), 0));
    M.set(`lk_eyet_${e.id}_${d}`, headD(`lk_eyet_${e.id}_${d}`, (g) => F.eyeTop(g, d, e), 0));
    M.set(`lk_lids_${e.id}_${d}`, headD(`lk_lids_${e.id}_${d}`, (g) => F.eyeLids(g, d, e), 0));
  }
  for (const e of C.brows) if (!e.p.none) for (const d of D2) {
    const name = `lk_brow_${e.id}_${d}`;
    M.set(name, { W: HW, H: HH, ax: 0.5, ay: NECK / HH, pad: 10, paint: (P) => P.layer((g) => F.brows(g, d, e), 0.7, 'rgba(30,26,22,0.8)') });
  }
  for (const e of C.nose) for (const d of D2) M.set(`lk_nose_${e.id}_${d}`, headD(`lk_nose_${e.id}_${d}`, (g) => F.nose(g, d, e), 0));
  for (const e of C.mouth) for (const d of D2) M.set(`lk_mouth_${e.id}_${d}`, headD(`lk_mouth_${e.id}_${d}`, (g) => F.mouth(g, d, e), 0));
  for (const e of C.cheeks) if (e.id !== 'none') for (const d of D2) M.set(`lk_cheek_${e.id}_${d}`, headD(`lk_cheek_${e.id}_${d}`, (g, r) => F.cheeks(g, d, e, r), 0));
  for (const e of C.age) if (e.id !== 'none') for (const d of (e.p.lv || 0) >= 2 ? D3 : D2) M.set(`lk_age_${e.id}_${d}`, headD(`lk_age_${e.id}_${d}`, (g) => F.age(g, d, e), 0));
  for (const e of C.marks) if (e.id !== 'none') for (const d of D2) M.set(`lk_mark_${e.id}_${d}`, headD(`lk_mark_${e.id}_${d}`, (g, r) => F.marks(g, d, e, r), 0));
  for (const e of C.scar) if (e.id !== 'none') for (const d of D2) M.set(`lk_scar_${e.id}_${d}`, headD(`lk_scar_${e.id}_${d}`, (g) => F.scar(g, d, e), 0));
  for (const e of C.paint) if (e.id !== 'none') for (const d of (e.p.kind === 'tribal' || e.p.kind === 'stripes') ? D3 : D2) M.set(`lk_paint_${e.id}_${d}`, headD(`lk_paint_${e.id}_${d}`, (g, r) => F.facePaint(g, d, e, r), 0));
  // hair
  const hairDef = (e, d, opts) => ({ W: HW, H: HH, ax: 0.5, ay: NECK / HH, pad: 14, paint: (P) => paintHair(P, e, d, opts) });
  for (const e of C.hair) if (!e.p.none) {
    for (const d of D3) {
      M.set(`lk_hair_${e.id}_${d}`, hairDef(e, d, {}));
      for (const m of HAIR_MODES) M.set(`lk_hairx_${m}_${e.id}_${d}`, hairDef(e, d, { mode: m }));
    }
    if (hasBack(e)) {
      M.set(`lk_hairb_${e.id}_s`, hairDef(e, 's', { back: true }));
      for (const m of HAIR_MODES) M.set(`lk_hairbx_${m}_${e.id}_s`, hairDef(e, 's', { back: true, mode: m }));
    }
  }
  for (const e of C.beard) if (e.id !== 'none') for (const d of D2) M.set(`lk_beard_${e.id}_${d}`, { W: HW, H: HH, ax: 0.5, ay: NECK / HH, pad: 12, paint: (P) => paintBeard(P, e, d) });
  DEFS = M;
  return M;
}

// atlas painter group (sprites.js)
export function addLook(add) {
  for (const [name, def] of lookDefs()) add(name, atlasCanvas(def), def.ax, def.ay);
}
export { entry };
