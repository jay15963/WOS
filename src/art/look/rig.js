// Look → ordered, tinted sprite layers per facing (agent H). compose.js asks lookRig(A, p.look) once per pawn
// per frame (cached per look object + atlas), then draws the stacks at the rig's body / head transforms:
//   R.hairBack[d] (before the body) · R.body[d] · R.head[d] · R.brows[d] · R.beard[d] · R.hair[d]
//   R.lids[d] (blink, skin) · R.feet[d] + R.footTint (animated rig feet) · R.botC (thighs when sitting)
//   R.sx / R.sy / R.hk (build & height) · R.tall (hidden by tall hats) · R.long (hair follow-through)
// Layer = { s: sprite, r, g, b }. Works with the game atlas and with the creator's lazy preview atlas
// (A.has / A.get). Any look input is accepted (cleanLook), so peers / bandits can never break drawing.

import { cleanLook, rgbOf } from '../../game/look.js';
import { entry } from './catalog.js';

const CACHE = new WeakMap();
const DIRS = ['s', 'n', 'e'];

export function lookRig(A, look) {
  if (!look || typeof look !== 'object') look = FALLBACK;
  const c = CACHE.get(look);
  if (c && c.A === A) return c.R;
  const R = build(A, cleanLook(look), look);
  CACHE.set(look, { A, R });
  return R;
}
const FALLBACK = {};

function build(A, L, raw) {
  const has = (n) => A.has(n);
  const spr = (n) => (A.has(n) ? A.get(n) : null);
  const col = (hex) => rgbOf(hex);
  const skin = col(L.skin), hair = col(L.hairC), hair2 = col(L.hairC2), fhair = L.beardC ? col(L.beardC) : hair;
  const top = entry('top', L.top), bottom = entry('bottom', L.bottom), shoes = entry('shoes', L.shoes), hairE = entry('hair', L.hair);
  const build = entry('build', L.build).p, height = entry('height', L.height).p;
  const R = {
    look: L, skin, hairC: hair, sx: build.sx, sy: build.sy, hk: height.k,
    tall: !!hairE.p.tall, long: !!hairE.p.long, bald: !!hairE.p.none,
    body: {}, head: {}, brows: {}, beard: {}, hair: {}, hairBack: {}, lids: {}, feet: {},
    footTint: shoes.p.bare ? skin : col(L.shoeC), botC: col(L.botC),
  };
  // legs: bottoms / shoes (hidden while swimming by the animated rig)
  const lay = (list, name, c, legs = false) => { const s = spr(name); if (s) list.push({ s, r: c[0], g: c[1], b: c[2], legs }); };
  const W1 = [1, 1, 1];
  const longTop = top.p.hem === 'long', longBot = bottom.p.leg === 'long_skirt' || bottom.p.leg === 'skirt';
  for (const d of DIRS) {
    // ---- body ----
    const b = [];
    lay(b, 'lk_skin_' + d, skin);
    const shoeName = 'lk_shoe_' + L.shoes + '_' + d, shoeC = col(L.shoeC);
    const shoesFirst = longTop || longBot;
    if (shoesFirst) lay(b, shoeName, shoeC, true);
    if (!top.p.tuck) lay(b, `lk_bot_${L.bottom}_${d}`, col(L.botC), true);
    lay(b, `lk_top_${L.top}_${d}`, col(L.topC));
    if (L.pattern !== 'plain') lay(b, `lk_pat_${L.pattern}_${top.p.hem}_${d}`, col(L.topC2));
    lay(b, `lk_neck_${top.p.neck}_${d}`, skin);
    lay(b, `lk_trim_${L.top}_${d}`, col(L.topC2));
    if (top.p.tuck) lay(b, `lk_bot_${L.bottom}_${d}`, col(L.botC), true);
    if (L.over !== 'none') lay(b, `lk_over_${L.over}_${d}`, col(L.overC));
    if (!shoesFirst) lay(b, shoeName, shoeC, true);
    R.body[d] = b;
    // ---- head & face ----
    const h = [], fd = d === 'n' ? null : d;
    if (d !== 'e') lay(h, `lk_ears_${L.ears}_${d}`, skin);
    lay(h, `lk_head_${L.head}_${d}`, skin);
    if (fd) {
      if (L.cheeks !== 'none') lay(h, `lk_cheek_${L.cheeks}_${fd}`, skin);
    }
    if (L.age !== 'none') lay(h, `lk_age_${L.age}_${d}`, skin);
    if (fd) {
      if (L.marks !== 'none') lay(h, `lk_mark_${L.marks}_${fd}`, skin);
      if (L.scar !== 'none') lay(h, `lk_scar_${L.scar}_${fd}`, skin);
    }
    if (L.paint !== 'none') lay(h, `lk_paint_${L.paint}_${d}`, col(L.paintC));
    if (fd) {
      lay(h, `lk_nose_${L.nose}_${fd}`, skin);
      lay(h, `lk_mouth_${L.mouth}_${fd}`, skin);
      lay(h, `lk_eye_${L.eyes}_${fd}`, W1);
      lay(h, `lk_iris_${L.eyes}_${fd}`, col(L.eyeC));
      lay(h, `lk_eyet_${L.eyes}_${fd}`, W1);
    }
    if (d === 'e') lay(h, `lk_ears_${L.ears}_e`, skin);
    R.head[d] = h;
    R.brows[d] = []; R.beard[d] = [];
    if (fd) {
      if (L.brows !== 'none') lay(R.brows[d], `lk_brow_${L.brows}_${fd}`, fhair);
      if (L.beard !== 'none') lay(R.beard[d], `lk_beard_${L.beard}_${fd}`, fhair);
      R.lids[d] = spr(`lk_lids_${L.eyes}_${fd}`);
      R.feet[d] = spr(`lk_foot_${L.shoes}_${fd}`);
    } else { R.lids[d] = null; R.feet[d] = spr(`lk_foot_${L.shoes}_s`); }
    // ---- hair ----
    const hr = [], hb = [];
    if (!hairE.p.none) {
      lay(hr, `lk_hair_${L.hair}_${d}`, hair);
      if (L.hairFx !== 'none') lay(hr, `lk_hairx_${L.hairFx}_${L.hair}_${d}`, hair2);
      if (d === 's' && has(`lk_hairb_${L.hair}_s`)) {
        lay(hb, `lk_hairb_${L.hair}_s`, hair);
        if (L.hairFx !== 'none') lay(hb, `lk_hairbx_${L.hairFx}_${L.hair}_s`, hair2);
      }
    }
    R.hair[d] = hr; R.hairBack[d] = hb;
  }
  // legacy bandit extras stay on the raw object (hat bandana, face mask / eyepatch)
  R.legacyFace = raw && (raw.face === 'mask' || raw.face === 'eyepatch') ? raw.face : null;
  return R;
}
