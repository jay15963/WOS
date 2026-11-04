// The rig of the night's dead of the warm lands (docs/NIGHT-DEAD.md): skeletons, mummies and their giants. Their own
// bodies (art/deadBody.js parts) posed by a small 3D skeleton every frame and seen from the view the camera has of them
// — 8 views (s, se, e, ne, n and the mirrored sw, w, nw), at every camera angle and at 0° too (one walking on a
// diagonal shows its diagonal view) — the ice giant's machinery (art/giantRig.js) with more to hold and more to do.
// Everything is a function of replicated state (facing, moving / moveT, action {type, t, hold}, flash, dead / deadT,
// weapon) plus time, so a guest's copy moves like the host's:
//   skeletons  a quick, jerky walk with a rattle in the skull and the hands; a sword slash (raised behind the head,
//              brought down across), a spear thrust (two hands) and throw, a bow drawn to the cheek and loosed (the
//              string follows the hand, an arrow nocked until it flies); death / sunrise: the bones fall apart and
//              scatter on the ground, the skull rolls off, then they fade.
//   mummies    a slow, limping shuffle, the unarmed ones with both arms reaching forward; a two-armed clubbing blow (or
//              the khopesh slash); death / sunrise: the body sinks into a heap of sand that pours and fades.
//   giants     the ice giant's poses (heavy walk, smash with a long wind-up held high, the throw) with their own body,
//              club and thrown thing; the skeleton giant's ghost-fire glows in its ribcage; death: bones / sand, bigger.
// The eyes glow (emissive): pale spectral green for the bones, amber for the wrapped.
// drawDead returns false while its parts are still being painted (compose.js then draws only its shadow).

import { SK_SKEL, SK_MUMMY, EYES_SKEL, EYES_MUMMY, EYES_SG, EYES_MG, CORE_SG, GS, SMALL, DEAD_PARTS } from './deadBody.js';
import { SK as GSKU, PHI } from './giantBody.js';
import { lookAtlasOf, LOOK_CLOCK } from './look/lazy.js';
import { viewFacing8 } from './facing.js';

const TAU = Math.PI * 2, PX = 1 / 64;
const SPH = Math.sin(PHI), CPH = Math.cos(PHI);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (u) => { u = clamp01(u); return u * u * (3 - 2 * u); };
const easeIn = (u) => { u = clamp01(u); return u * u * u; };
const easeOut = (u) => { u = clamp01(u); return 1 - (1 - u) * (1 - u); };

// the kinds: part prefix, scale (unit px → painted px), skeleton, eyes, eye colour, death style
export const DEAD_KIND = {
  skeleton: { k: 'sk', S: SMALL, SK: SK_SKEL, eyes: EYES_SKEL, eyeC: [0.72, 1, 0.66], death: 'bones', giant: false, gait: Math.PI / 0.25 },
  mummy: { k: 'mu', S: SMALL, SK: SK_MUMMY, eyes: EYES_MUMMY, eyeC: [1, 0.74, 0.3], death: 'sand', giant: false, gait: Math.PI / 0.21 },
  skeleton_giant: { k: 'sg', S: GS, SK: GSKU, eyes: EYES_SG, eyeC: [0.6, 1, 0.68], death: 'bones', giant: true, core: CORE_SG },
  mummy_giant: { k: 'mg', S: GS, SK: GSKU, eyes: EYES_MG, eyeC: [1, 0.7, 0.26], death: 'sand', giant: true },
};
// walk: the giants' heavy steps (one every 1.35 tiles, like the ice giant: fx/giantfx.js listens to the same clock)
export const DEAD_GIANT_GAIT = Math.PI / (0.25 * 0.9 * GS);
// the 8 views: the painted view, mirror, the yaw the body faces on the screen (x right, y toward the camera)
const VIEW8 = {
  s: ['s', 1, Math.PI / 2], se: ['se', 1, Math.PI / 4], e: ['e', 1, 0], ne: ['ne', 1, -Math.PI / 4], n: ['n', 1, -Math.PI / 2],
  sw: ['se', -1, (3 * Math.PI) / 4], w: ['e', -1, Math.PI], nw: ['ne', -1, (-3 * Math.PI) / 4],
};

// ---------- sprites (lazy look texture) ----------
const RECS = new WeakMap();
function spr(A, name) {
  let M = RECS.get(A);
  if (!M) RECS.set(A, (M = new Map()));
  let r = M.get(name);
  if (r === undefined) { const LA = lookAtlasOf(A); r = LA.has(name) ? LA.get(name) : null; M.set(name, r); }
  if (!r || r.failed) return null;
  if (r.ready) { r.lu = LOOK_CLOCK.f; return r; }
  lookAtlasOf(A).want(r);
  return null;
}
const asked = new WeakMap();
function prefetch(A, k) { let s = asked.get(A); if (!s) asked.set(A, (s = new Set())); if (s.has(k)) return; s.add(k); for (const n of DEAD_PARTS[k]) spr(A, n); }
function opt(A, n) { return A.has(n) ? A.get(n) : null; }

// ---------- vectors (body space: x forward, y left, z up; unit px) ----------
const V = () => [0, 0, 0];
const set3 = (o, x, y, z) => { o[0] = x; o[1] = y; o[2] = z; return o; };
const lerp = (a, b, u) => a + (b - a) * u;
const lerp3 = (o, a, b, u) => set3(o, lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u));
const nrm3 = (o) => { const l = Math.hypot(o[0], o[1], o[2]) || 1; o[0] /= l; o[1] /= l; o[2] /= l; return o; };
const N = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };

// ---------- key poses ----------
// pel (x, y, z) · pitch (forward lean) · roll · fR / fL fists · w: the right hand's weapon direction (unit) · b: the bow's
// axis in the left hand · aR / aL ankles · two: the left hand on the spear's shaft · draw: the bow string pulled to fR
const mk = (base) => (o) => ({ pel: base.pel, pitch: 0.06, roll: 0, fR: base.fR, fL: base.fL, w: base.w, b: base.b, aR: base.aR, aL: base.aL, two: 0, draw: 0, ...o });
// the small ones (skeleton proportions; the mummy shares them, its arms a little lower and wider)
const SA = SK_SKEL.ankle;
const P0 = mk({ pel: [0, 0, 17.5], fR: [2.6, -9.6, 15.6], fL: [2.4, 9.6, 15.6], w: N([0.74, -0.1, -0.66]), b: N([0.22, 0.05, 0.97]), aR: [0, -4.2, SA], aL: [0, 4.2, SA] });
const SM = {
  rest: P0({}),
  restSpear: P0({ fR: [3, -9, 16], w: N([0.14, -0.05, 0.99]) }),
  restBow: P0({ fL: [3.4, 9.2, 15.6] }),
  slashUp: P0({ pel: [-1, 0, 17.5], pitch: -0.12, roll: 0.1, fR: [-3.5, -9, 43], w: N([-0.4, 0.22, 0.89]), fL: [5, 7.5, 20] }),
  slashHit: P0({ pel: [1.5, 0, 16.6], pitch: 0.32, roll: -0.12, fR: [11.5, -1, 15.5], w: N([0.8, 0.38, -0.46]), fL: [0, 9.4, 14], aR: [-2.2, -4.2, SA], aL: [3, 4.2, SA] }),
  thrustBack: P0({ pel: [-1.5, 0, 17.5], pitch: -0.04, fR: [-3, -6.5, 19.5], w: N([1, 0.06, 0.07]), two: 1 }),
  thrustHit: P0({ pel: [2.6, 0, 16.6], pitch: 0.3, fR: [8.5, -3, 18], w: N([1, 0.03, -0.06]), two: 1, aR: [-3, -4.2, SA], aL: [4, 4.2, SA] }),
  throwUp: P0({ pel: [-1.5, 0, 18], pitch: -0.15, roll: 0.07, fR: [-6, -8.5, 40], w: N([0.97, 0.05, 0.24]), fL: [9.5, 6, 26] }),
  throwRel: P0({ pel: [2.2, 0, 17], pitch: 0.26, fR: [11.5, -4, 26], w: N([0.95, 0, -0.12]), fL: [2, 8, 16], aR: [-2, -4.2, SA], aL: [3, 4.2, SA] }),
  draw: P0({ pitch: 0.02, fL: [13.5, 3, 29], b: N([0.04, 0, 1]), fR: [3, -4.6, 36], draw: 1 }),
  loose: P0({ pitch: 0.02, fL: [13.5, 3, 29], b: N([0.04, 0, 1]), fR: [-1.5, -7.5, 34], draw: 0 }),
  clawUp: P0({ pel: [-1, 0, 17.6], pitch: -0.14, fR: [1, -7.5, 44], fL: [1, 7.5, 44] }),
  clawHit: P0({ pel: [2.2, 0, 16.4], pitch: 0.34, fR: [13.5, -4, 17], fL: [13.5, 4, 17], aR: [-2, -4.2, SA], aL: [3, 4.2, SA] }),
  reach: P0({ pitch: 0.12, fR: [11.5, -6.4, 25.5], fL: [11.5, 6.4, 25.5] }),
};
// the giants: the ice giant's key poses (art/giantRig.js), the club in `w`
const GA = GSKU.ankle;
const PG = mk({ pel: [0, 0, GSKU.pelvis], fR: [10, -40, 37], fL: [12, 40, 36], w: N([0.75, -0.1, -0.65]), b: N([0, 0, 1]), aR: [0, -15, GA], aL: [0, 15, GA] });
const GP = {
  rest: PG({ pitch: 0.05 }),
  smashUp: PG({ pel: [-2, 0, 54], pitch: -0.16, fR: [-5, -8, 128], w: N([-0.55, 0.05, 0.83]), aR: [-4, -17, GA], aL: [8, 17, GA], two: 1 }),
  smashHit: PG({ pel: [6, 0, 49], pitch: 0.44, fR: [40, -10, 36], w: N([0.8, -0.28, -0.53]), aR: [-9, -17, GA], aL: [13, 17, GA], two: 1 }),
  throwDown: PG({ pel: [3, 0, 50], pitch: 0.36, fL: [24, 22, 14], fR: [12, -36, 42], aR: [6, -16, GA], aL: [-4, 16, GA] }),
  throwUp: PG({ pel: [-3, 0, 55], pitch: -0.14, roll: 0.07, fL: [-18, 26, 124], fR: [16, -35, 50], w: N([0.6, -0.2, -0.77]), aR: [8, -16, GA], aL: [-7, 16, GA] }),
  throwRel: PG({ pel: [5, 0, 52], pitch: 0.3, roll: -0.04, fL: [38, 12, 88], fR: [10, -36, 42], aR: [8, -16, GA], aL: [-7, 16, GA] }),
  throwFol: PG({ pel: [4, 0, 52], pitch: 0.24, fL: [30, 8, 50], fR: [8, -37, 40], aR: [8, -16, GA], aL: [-7, 16, GA] }),
};

// the current pose (scratch)
const Q = { pel: V(), pitch: 0, roll: 0, k: 1, fR: V(), fL: V(), w: V(), b: V(), aR: V(), aL: V(), two: 0, draw: 0, lR: 0, lL: 0, rock: false, hideW: false, arrow: false, nod: 0 };
function mix(a, b, u) {
  lerp3(Q.pel, a.pel, b.pel, u); Q.pitch = lerp(a.pitch, b.pitch, u); Q.roll = lerp(a.roll, b.roll, u);
  lerp3(Q.fR, a.fR, b.fR, u); lerp3(Q.fL, a.fL, b.fL, u); nrm3(lerp3(Q.w, a.w, b.w, u)); nrm3(lerp3(Q.b, a.b, b.b, u));
  lerp3(Q.aR, a.aR, b.aR, u); lerp3(Q.aL, a.aL, b.aL, u); Q.two = lerp(a.two, b.two, u); Q.draw = lerp(a.draw, b.draw, u);
}
// a blow in three beats: rest → up (wind-up) → hit (fast) → hold → back to rest
function beats(R, U, H, k, kU, kH, kB = kH + 0.1) {
  if (k < kU) mix(R, U, smooth(k / kU) * 0.9 + easeOut(k / kU) * 0.1);
  else if (k < kH) mix(U, H, easeIn((k - kU) / (kH - kU)));
  else if (k < kB) mix(H, H, 0);
  else mix(H, R, smooth((k - kB) / (1 - kB)));
}
// weapon class of a held item: what the rig draws and how it fights
const wclass = (w) => (!w ? 'none' : /^bow/.test(w) ? 'bow' : /^spear/.test(w) ? 'spear' : /copper|bronze|khopesh/.test(w) ? 'khopesh' : 'sword');
const THRUST = new Set(['stab', 'pierce', 'sweep', 'attack', 'smash', 'cleave', 'strike']);

function smallPose(p, t, ph0, K, wc) {
  const act = p.action && (p.action.t ?? 0) < 1 ? p.action : null, k = act ? clamp01(act.t || 0) : 0, ty = act?.type;
  const mummy = K.k === 'mu';
  Q.lR = 0; Q.lL = 0; Q.nod = 0; Q.k = 1; Q.rock = false; Q.hideW = false; Q.arrow = false;
  const R = wc === 'spear' ? SM.restSpear : wc === 'bow' ? SM.restBow : SM.rest;
  if (!act || ty === 'block') mix(R, R, 0);
  else if (wc === 'bow' && ty === 'shoot') {
    if (act.hold) { mix(SM.draw, SM.draw, 0); Q.fR[0] += Math.sin(t * 31) * 0.15; }
    else if (k < 0.55) mix(R, SM.draw, smooth(k / 0.55));
    else if (k < 0.65) mix(SM.draw, SM.loose, easeOut((k - 0.55) / 0.1));
    else mix(SM.loose, R, smooth((k - 0.65) / 0.35));
    Q.arrow = act.hold || (k > 0.12 && k < 0.57);
  } else if (wc === 'spear' && ty === 'throw') {
    beats(R, SM.throwUp, SM.throwRel, k, 0.45, 0.58);
    Q.hideW = k > 0.52 && k < 0.95; // (it flies: projectiles.js)
  } else if (wc === 'spear' && THRUST.has(ty)) beats(R, SM.thrustBack, SM.thrustHit, k, 0.34, 0.48);
  else if (wc === 'none' || wc === 'bow') beats(R, SM.clawUp, SM.clawHit, k, 0.36, 0.5);
  else beats(R, SM.slashUp, SM.slashHit, k, 0.38, 0.52);
  // idle: a slow sway; a skeleton's skull twitches now and then
  Q.roll += Math.sin(t * 0.5 + ph0 * 2) * 0.02;
  Q.nod = Math.sin(t * 0.6 + ph0) * 0.04 + (!mummy && Math.sin(t * 0.83 + ph0 * 3) > 0.985 ? 0.16 : 0);
  // walk: skeletons quick and jerky (a rattle), mummies a slow limping shuffle with the arms reaching forward
  const m = p._mk ?? (p.moving ? 1 : 0);
  if (m > 0.01) {
    const g = (p.moveT || 0) * K.gait, s = Math.sin(g), c = Math.cos(g);
    const S = (mummy ? 3.4 : 4.6) * m, Hh = (mummy ? 2.2 : 3.2) * m;
    Q.aR[0] += S * s; Q.aL[0] -= S * s;
    Q.lR = Hh * Math.max(0, c) ** 1.3 * (mummy ? 0.45 : 1); Q.lL = Hh * Math.max(0, -c) ** 1.3; // (the mummy drags its right foot)
    Q.aR[2] += Q.lR; Q.aL[2] += Q.lL;
    const drop = Math.pow(s * s, 1.4);
    Q.pel[2] -= (mummy ? 1.3 : 0.9) * m * drop; Q.pel[1] += (mummy ? 1.3 : 0.7) * m * c; Q.roll -= (mummy ? 0.11 : 0.06) * m * c; Q.pitch += (mummy ? 0.14 : 0.08) * m;
    if (!act) {
      if (mummy && wc === 'none') { lerp3(Q.fR, Q.fR, SM.reach.fR, m); lerp3(Q.fL, Q.fL, SM.reach.fL, m); Q.fR[2] += 0.8 * s * m; Q.fL[2] -= 0.8 * s * m; }
      else if (mummy) { lerp3(Q.fL, Q.fL, SM.reach.fL, m); Q.fR[0] -= 2.4 * s * m; }
      else { Q.fR[0] -= 3.2 * s * m; Q.fL[0] += 3.2 * s * m; Q.fR[2] += 0.6 * Math.abs(s) * m; Q.fL[2] += 0.6 * Math.abs(s) * m; }
    }
    if (!mummy) { Q.nod += Math.sin(t * 29 + ph0) * 0.05 * m; Q.fR[2] += Math.sin(t * 23) * 0.35 * m; Q.fL[2] += Math.sin(t * 26 + 1) * 0.35 * m; } // (the rattle)
  }
  // hit flinch
  const fl = p.flash || 0;
  if (fl > 0.05) { const f = fl * fl; Q.pitch -= 0.2 * f; Q.pel[0] -= 1.2 * f; Q.nod -= 0.25 * f; Q.fR[1] -= 1.5 * f; Q.fL[1] += 1.5 * f; }
  // two hands on the shaft: the left fist ahead of the right one
  if (Q.two > 0.01) { const tx = Q.fR[0] + Q.w[0] * 7, ty2 = Q.fR[1] + Q.w[1] * 7 + 2.6, tz = Q.fR[2] + Q.w[2] * 7; Q.fL[0] = lerp(Q.fL[0], tx, Q.two); Q.fL[1] = lerp(Q.fL[1], ty2, Q.two); Q.fL[2] = lerp(Q.fL[2], tz, Q.two); }
}

function giantPose(p, t, ph0) {
  const act = p.action && (p.action.t ?? 0) < 1 ? p.action : null, k = act ? clamp01(act.t || 0) : 0;
  const type = act ? (act.type === 'throw' ? 'throw' : 'smash') : null;
  Q.rock = false; Q.lR = 0; Q.lL = 0; Q.nod = 0; Q.k = 1; Q.hideW = false; Q.arrow = false; Q.draw = 0;
  if (type === 'smash') {
    if (act.hold) {
      mix(GP.smashUp, GP.smashUp, 0);
      const q = Math.sin(t * 38 + ph0) * 0.035, q2 = Math.sin(t * 29 + 1.3) * 0.02;
      Q.w[0] += q; Q.w[1] += q2; nrm3(Q.w); Q.fR[2] += Math.sin(t * 31) * 0.8; Q.pel[2] += Math.sin(t * 23) * 0.5;
    } else if (k < 0.41) mix(GP.rest, GP.smashUp, smooth(k / 0.41) * 0.92 + easeOut(k / 0.41) * 0.08);
    else if (k < 0.53) mix(GP.smashUp, GP.smashHit, easeIn((k - 0.41) / 0.12));
    else if (k < 0.66) { mix(GP.smashHit, GP.smashHit, 0); const u = (k - 0.53) / 0.13; Q.pel[2] -= Math.sin(u * Math.PI) * 2.5; Q.k = 1 - Math.sin(u * Math.PI) * 0.04; }
    else mix(GP.smashHit, GP.rest, smooth((k - 0.66) / 0.34));
  } else if (type === 'throw') {
    if (act.hold) { mix(GP.throwUp, GP.throwUp, 0); Q.fL[2] += Math.sin(t * 27) * 0.7; }
    else if (k < 0.15) mix(GP.rest, GP.throwDown, smooth(k / 0.15));
    else if (k < 0.43) mix(GP.throwDown, GP.throwUp, smooth((k - 0.15) / 0.28));
    else if (k < 0.5) mix(GP.throwUp, GP.throwRel, easeIn((k - 0.43) / 0.07));
    else if (k < 0.62) mix(GP.throwRel, GP.throwFol, smooth((k - 0.5) / 0.12));
    else mix(GP.throwFol, GP.rest, smooth((k - 0.62) / 0.38));
    Q.rock = act.hold || (k > 0.1 && k < 0.47);
  } else mix(GP.rest, GP.rest, 0);
  const br = Math.sin(t * 1.2 + ph0);
  Q.pel[2] += br * 0.4; Q.roll += Math.sin(t * 0.33 + ph0 * 2) * 0.015; Q.fR[2] += br * 0.6; Q.fL[2] += br * 0.6;
  Q.nod = Math.sin(t * 0.45 + ph0) * 0.05;
  const m = p._mk ?? (p.moving ? 1 : 0);
  if (m > 0.01) {
    const g = (p.moveT || 0) * DEAD_GIANT_GAIT, s = Math.sin(g), c = Math.cos(g), S = 25 * m, H = 11 * m;
    Q.aR[0] += S * s; Q.aL[0] -= S * s;
    Q.lR = H * Math.max(0, c) ** 1.4; Q.lL = H * Math.max(0, -c) ** 1.4;
    Q.aR[2] += Q.lR; Q.aL[2] += Q.lL;
    const drop = Math.pow(s * s, 1.6);
    Q.pel[2] -= 6 * m * drop; Q.k *= 1 - 0.025 * m * drop; Q.pel[1] += 4 * m * c; Q.roll -= 0.07 * m * c; Q.pitch += 0.1 * m;
    Q.fL[0] += 11 * m * s; Q.fL[2] += 3 * m * Math.abs(s); Q.fR[0] -= 5 * m * s;
    Q.nod -= 0.05 * m * drop;
  }
  const fl = p.flash || 0;
  if (fl > 0.05) { const f = fl * fl; Q.pitch -= 0.16 * f; Q.pel[0] -= 3 * f; Q.nod -= 0.2 * f; Q.fR[1] -= 4 * f; Q.fL[1] += 4 * f; }
  if (Q.two > 0.01) { const tx = Q.fR[0] - Q.w[0] * 13, ty = Q.fR[1] - Q.w[1] * 13 + 6, tz = Q.fR[2] - Q.w[2] * 13; Q.fL[0] = lerp(Q.fL[0], tx, Q.two); Q.fL[1] = lerp(Q.fL[1], ty, Q.two); Q.fL[2] = lerp(Q.fL[2], tz, Q.two); }
}

// ---------- skeleton (painted px: the pose × S) ----------
let SKS = null, S_ = 1;
const tmp = V();
function torsoPt(o, v, pitch = Q.pitch, roll = Q.roll, k = Q.k) {
  const x = v[0], y = v[1], z = v[2] * k, cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  const x1 = x * cp + z * sp, z1 = -x * sp + z * cp;
  return set3(o, Q.pel[0] + x1, Q.pel[1] + y * cr - z1 * sr, Q.pel[2] + y * sr + z1 * cr);
}
function ik(m, e, a, b, l1, l2, pole) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  let L = Math.hypot(dx, dy, dz) || 1;
  const ux = dx / L, uy = dy / L, uz = dz / L;
  L = Math.max(Math.abs(l1 - l2) + 0.3 * S_, Math.min(l1 + l2 - 0.15 * S_, L));
  const da = (l1 * l1 - l2 * l2 + L * L) / (2 * L), h = Math.sqrt(Math.max(0, l1 * l1 - da * da));
  let px = pole[0], py = pole[1], pz = pole[2];
  const pd = px * ux + py * uy + pz * uz;
  px -= ux * pd; py -= uy * pd; pz -= uz * pd;
  const pl = Math.hypot(px, py, pz) || 1;
  set3(m, a[0] + ux * da + (px / pl) * h, a[1] + uy * da + (py / pl) * h, a[2] + uz * da + (pz / pl) * h);
  set3(e, a[0] + ux * L, a[1] + uy * L, a[2] + uz * L);
}
const J = { pel: V(), neck: V(), sR: V(), sL: V(), eR: V(), eL: V(), fR: V(), fL: V(), wR: V(), wL: V(), hR: V(), hL: V(), kR: V(), kL: V(), aR: V(), aL: V() };
function skeleton() {
  const SK = SKS, s = S_;
  set3(J.pel, Q.pel[0], Q.pel[1], Q.pel[2]);
  torsoPt(J.neck, [SK.neck[0] * s, 0, SK.neck[2] * s]);
  torsoPt(J.sR, set3(tmp, SK.shoulder[0] * s, -SK.shoulder[1] * s, SK.shoulder[2] * s));
  torsoPt(J.sL, set3(tmp, SK.shoulder[0] * s, SK.shoulder[1] * s, SK.shoulder[2] * s));
  const ARM = (SK.farm + SK.fist) * s, shZ = (SK.pelvis + SK.shoulder[2]) * s;
  const up = (f) => clamp01((f[2] - shZ * 0.62) / (shZ * 0.4));
  let u = up(Q.fR);
  ik(J.eR, J.fR, J.sR, Q.fR, SK.uarm * s, ARM, [-1 + 1.3 * u, -0.7 - 0.5 * u, -0.2 * u]);
  u = up(Q.fL);
  ik(J.eL, J.fL, J.sL, Q.fL, SK.uarm * s, ARM, [-1 + 1.3 * u, 0.7 + 0.5 * u, -0.2 * u]);
  const w = SK.farm / (SK.farm + SK.fist);
  lerp3(J.wR, J.eR, J.fR, w); lerp3(J.wL, J.eL, J.fL, w);
  const cr = Math.cos(Q.roll), sr = Math.sin(Q.roll), hy = SK.hip[1] * s, hz = SK.hip[2] * s;
  set3(J.hR, Q.pel[0], Q.pel[1] - hy * cr, Q.pel[2] + hz - hy * sr);
  set3(J.hL, Q.pel[0], Q.pel[1] + hy * cr, Q.pel[2] + hz + hy * sr);
  ik(J.kR, J.aR, J.hR, Q.aR, SK.thigh * s, SK.shin * s, [1, -0.25, 0]);
  ik(J.kL, J.aL, J.hL, Q.aL, SK.thigh * s, SK.shin * s, [1, 0.25, 0]);
}

// ---------- projection (body → screen px: x right, y down; d = toward the camera) ----------
let CY = 0, SY = 1;
const PR = { x: 0, y: 0, d: 0 };
function proj(v) { const wy = SY * v[0] - CY * v[1]; PR.x = CY * v[0] + SY * v[1]; PR.y = SPH * wy - CPH * v[2]; PR.d = wy; return PR; }

// ---------- draw items ----------
const ITEMS = [];
let NI = 0;
function item(s, x, y, sx, sy, rot, flip, sh = 1) {
  if (!s) return null;
  const it = ITEMS[NI] || (ITEMS[NI] = { s: null, x: 0, y: 0, sx: 1, sy: 1, rot: 0, flip: 1, sh: 1, k: 1, head: false, lim: false });
  NI++;
  it.s = s; it.x = x; it.y = y; it.sx = sx; it.sy = sy; it.rot = rot; it.flip = flip; it.sh = sh; it.k = 1; it.head = false; it.lim = false;
  return it;
}
// a limb sprite (painted along −z) from a to b, its painted length L
function limb(s, a, b, L, flip = 1, sx = 1) {
  const pa = proj(a), ax = pa.x, ay = pa.y;
  const pb = proj(b), dx = pb.x - ax, dy = pb.y - ay, len = Math.hypot(dx, dy);
  const it = item(s, ax, ay, sx, Math.max(0.3, len / (L * CPH)), Math.atan2(-dx, dy), flip);
  if (it) it.lim = true;
  return it;
}
function at(s, v, flip, rot = 0, sx = 1, sy = 1) { const p = proj(v); return item(s, p.x, p.y, sx, sy, rot, flip); }
const along = (o, a, d, L) => set3(o, a[0] + d[0] * L, a[1] + d[1] * L, a[2] + d[2] * L);

const ORDER = [];
const tv0 = V(), tv1 = V(), tv2 = V(), tv3 = V(), tv4 = V();
let SEED = 0;
const hash = (i) => { const x = Math.sin((SEED + 1) * 12.9898 + i * 78.233) * 43758.5453; return x - Math.floor(x); };
const strHash = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h >>> 0; };
// weapon lengths (painted px at S = 1): the grip → tip of each weapon sprite
const WLEN = { sword: 21, spear: 25, khopesh: 15, club: 44 };

export function drawDead(B, A, p, t, env) {
  const K = DEAD_KIND[p.species];
  if (!K) return false;
  const turned = env.animEnv.rs !== 0 || env.animEnv.rc !== 1;
  let v8 = p._dv;
  if (!v8) {
    if (!turned) { const f = viewFacing8(p, t, 0); v8 = p._dv || f; p._dv = null; }
    else v8 = p.facing || 's';
  }
  const VW = VIEW8[v8] || VIEW8.s, pv = VW[0], mir = VW[1], yaw = VW[2];
  const kk = K.k, big = K.giant, wc = big ? 'club' : wclass(p.weapon);
  const helm = kk === 'sk' && strHash(String(p.id ?? p.nid ?? 0)) % 10 < 4; // (some skeletons wear a rusted kettle hat)
  const S = {
    torso: spr(A, `dd_${kk}_torso_${pv}`), head: spr(A, `dd_${kk}_${helm ? 'headh' : 'head'}_${pv}`), fist: spr(A, `dd_${kk}_fist_${pv}`), foot: spr(A, `dd_${kk}_foot_${pv}`),
    uarm: spr(A, `dd_${kk}_uarm`), farm: spr(A, `dd_${kk}_farm`), thigh: spr(A, `dd_${kk}_thigh`), shin: spr(A, `dd_${kk}_shin`),
  };
  if (big) { S.pR = spr(A, `dd_${kk}_${mir > 0 ? 'paulR' : 'paulL'}_${pv}`); S.pL = spr(A, `dd_${kk}_${mir > 0 ? 'paulL' : 'paulR'}_${pv}`); S.weap = spr(A, `dd_${kk}_club`); }
  else if (wc === 'sword') S.weap = spr(A, 'dd_sk_sword');
  else if (wc === 'spear') S.weap = spr(A, 'dd_sk_spear');
  else if (wc === 'khopesh') S.weap = spr(A, 'dd_mu_khopesh');
  else if (wc === 'bow') { S.bow = spr(A, 'dd_sk_bow'); S.str = spr(A, 'dd_sk_string'); S.arw = spr(A, 'dd_sk_arrow'); }
  prefetch(A, kk);
  for (const n in S) if (!S[n]) return false;
  CY = Math.cos(yaw); SY = Math.sin(yaw);
  SKS = K.SK; S_ = K.S;
  const ph0 = p._ph ?? (p._ph = ((p.id ?? 0) * 0.618 + Math.random()) * TAU);
  const dead = !!p.dead, dk = dead ? p.deadT || 0 : 0;
  const END = big ? 4.2 : 3.4;
  if (dead && dk > END) return true; // (gone: bones faded / sand blown away — fx/undeadfx.js did the rest)
  if (big) giantPose(p, t, ph0); else smallPose(p, t, ph0, K, wc);
  if (!big) { for (const v of [Q.pel, Q.fR, Q.fL, Q.aR, Q.aL]) { v[0] *= S_; v[1] *= S_; v[2] *= S_; } Q.lR *= S_; Q.lL *= S_; } // (unit px → painted px)
  else { for (const v of [Q.pel, Q.fR, Q.fL, Q.aR, Q.aL]) { v[0] *= GS; v[1] *= GS; v[2] *= GS; } Q.lR *= GS; Q.lL *= GS; }
  if (dead) { Q.rock = false; Q.arrow = false; Q.draw = 0; }
  skeleton();
  NI = 0;
  const SK = SKS, s = S_;
  // ---- the parts ----
  const pp = proj(J.pel), px0 = pp.x, py0 = pp.y;
  torsoPt(tv0, [SK.neck[0] * s, 0, SK.neck[2] * s], 0, 0, 1); proj(tv0); const u0x = PR.x - px0, u0y = PR.y - py0;
  proj(J.neck); const u1x = PR.x - px0, u1y = PR.y - py0;
  const trot = Math.atan2(u1x, -u1y) - Math.atan2(u0x, -u0y), tsy = Math.hypot(u1x, u1y) / (Math.hypot(u0x, u0y) || 1);
  const T = item(S.torso, px0, py0, 1, tsy, trot, mir);
  const nk = proj(J.neck);
  const H = item(S.head, nk.x, nk.y, 1, 1, trot * 0.55 + CY * (Q.nod + Q.pitch * 0.3), mir);
  if (H) H.head = true;
  const UR = limb(S.uarm, J.sR, J.eR, SK.uarm * s), FR = limb(S.farm, J.eR, J.wR, SK.farm * s);
  const UL = limb(S.uarm, J.sL, J.eL, SK.uarm * s), FL = limb(S.farm, J.eL, J.wL, SK.farm * s);
  const XR = at(S.fist, J.fR, mir), XL = at(S.fist, J.fL, mir);
  // the right hand's weapon (sword / spear / khopesh / the giant's club), foreshortened along its direction
  let W = null, wTip = null;
  if (S.weap && !Q.hideW) { const L = (big ? 44 : WLEN[wc] || 20) * s; wTip = along(tv1, J.fR, Q.w, L); W = limb(S.weap, J.fR, wTip, L); }
  // the bow in the left hand: two limbs (bending away from the archer), the string to the drawing hand, an arrow nocked
  let BU = null, BD = null, ST1 = null, ST2 = null, AR = null;
  if (S.bow) {
    const L = 13 * s, top = along(tv2, J.fL, Q.b, L), bot = along(tv3, J.fL, [-Q.b[0], -Q.b[1], -Q.b[2]], L);
    // (which way the bow bends on the screen: the archer's forward, foreshortened)
    const bend = CY >= 0 ? 1 : -1, bk = Math.max(0.3, Math.abs(CY));
    BU = limb(S.bow, J.fL, top, L, -bend, bk); BD = limb(S.bow, J.fL, bot, L, bend, bk);
    // nock: the drawing hand when drawn, else the middle of the string (behind the grip)
    const ex = 3.3 * s; // (the tips bend this far forward)
    set3(tv4, J.fL[0] + ex * 0.9, J.fL[1], J.fL[2]);
    const nock = Q.draw > 0.05 ? J.fR : tv4;
    const tt = [top[0] + ex, top[1], top[2]], tb = [bot[0] + ex, bot[1], bot[2]];
    ST1 = limb(S.str, tt, nock, 10 * s); ST2 = limb(S.str, tb, nock, 10 * s);
    if (Q.arrow) { const d = [J.fL[0] - nock[0], J.fL[1] - nock[1], J.fL[2] - nock[2]], l = Math.hypot(d[0], d[1], d[2]) || 1; AR = limb(S.arw, nock, along(tv0, nock, [d[0] / l, d[1] / l, d[2] / l], 14 * s), 14 * s); }
  }
  // the giants: pauldrons, the thing it throws in its left hand
  let PRr = null, PLl = null, RK = null;
  if (big) {
    PRr = at(S.pR, torsoPt(tv0, set3(tv1, SK.shoulder[0] * s, -SK.shoulder[1] * s, (SK.shoulder[2] + 3) * s)), mir, trot);
    PLl = at(S.pL, torsoPt(tv0, set3(tv1, SK.shoulder[0] * s, SK.shoulder[1] * s, (SK.shoulder[2] + 3) * s)), mir, trot);
    const rockS = Q.rock ? spr(A, kk === 'sg' ? 'proj_giant_bone' : 'proj_giant_slab') : null;
    RK = rockS ? at(rockS, set3(tv2, J.fL[0] + 3 * s, J.fL[1], J.fL[2] + 11 * s), 1, (kk === 'sg' ? 0.5 : 0) + Math.sin(t * 3) * 0.2, 1.05, 1.05) : null;
  }
  const TR = limb(S.thigh, J.hR, J.kR, SK.thigh * s), SR = limb(S.shin, J.kR, J.aR, SK.shin * s);
  const TL = limb(S.thigh, J.hL, J.kL, SK.thigh * s), SL = limb(S.shin, J.kL, J.aL, SK.shin * s);
  const KR = at(S.foot, J.aR, mir, CY * 0.04 * Q.lR / s), KL = at(S.foot, J.aL, mir, CY * 0.04 * Q.lL / s);

  // ---- order (back to front): the ice giant's (art/giantRig.js) — legs under the torso, the arms beside it, the head
  // in front or hidden; side / 3/4 views: far side, torso, near side. A weapon behind the body leaves its arm.
  ORDER.length = 0;
  const lat = CY, fwd = SY;
  const torsoD = proj(set3(tv2, Q.pel[0] - 4 * s, Q.pel[1], Q.pel[2])).d;
  const wD = wTip ? proj(set3(tv1, J.fR[0] + Q.w[0] * 14 * s, J.fR[1] + Q.w[1] * 14 * s, J.fR[2] + Q.w[2] * 14 * s)).d : 0;
  const armR = [UR, PRr, FR, W, XR], armL = [UL, PLl, FL, BU, BD, ST1, ST2, AR, XL, RK];
  if (Math.abs(lat) < 0.3) {
    const front = fwd > 0, wOut = !!W && (front ? wD < torsoD - 4 * s : wD > torsoD + 4 * s);
    if (wOut) armR[3] = null;
    if (front) ORDER.push(wOut ? W : null, TL, SL, KL, TR, SR, KR, T, ...armL, ...armR, H);
    else ORDER.push(H, TL, SL, KL, TR, SR, KR, UL, FL, BU, BD, ST1, ST2, AR, XL, RK, UR, FR, armR[3], XR, T, PLl, PRr, wOut ? W : null);
  } else {
    const nearR = lat > 0, back = fwd < -0.3;
    const farLeg = nearR ? [TL, SL, KL] : [TR, SR, KR], nearLeg = nearR ? [TR, SR, KR] : [TL, SL, KL];
    const farArm = nearR ? armL : armR, nearArm = nearR ? armR : armL;
    if (back) ORDER.push(H);
    for (const it of farLeg) if (it) it.k = 0.8;
    for (const it of farArm) if (it) it.k = 0.8;
    ORDER.push(...farLeg, ...farArm, T);
    if (!back) ORDER.push(H);
    ORDER.push(...nearLeg, ...nearArm);
  }

  // ---- emit ----
  const B2 = env.viewB(B, p.x, p.y);
  const ox = p.x, oy = p.y, fl = p.flash || 0;
  SEED = (p.id ?? 0) * 7.13;
  const bones = K.death === 'bones', FALL = big ? 0.8 : 0.5, SINK = big ? 1.7 : 1.15;
  let al = 1, flash = fl, sink = 0, fallU = 0;
  if (dead) {
    if (bones) { fallU = clamp01(dk / FALL); al = 1 - smooth((dk - (END - 0.9)) / 0.8); }
    else { sink = smooth(dk / SINK); al = 1 - smooth((dk - SINK * 0.55) / (SINK * 0.65)); }
    flash = Math.max(fl, 0.35 * (1 - dk * 2));
  }
  const blob = opt(A, 'fx_blob'), soft = opt(A, 'fx_soft');
  const bw = big ? 1.5 * GS : 0.62, bh = big ? 1.0 * GS : 0.46;
  if (blob) B2.blob.add(blob, ox, oy + 0.02, bw, bh, 1, 1, 1, 0.7 * (dead ? (bones ? 0.6 * al : 1 - sink) : 1));
  // (the mummy's heap of sand, growing as it sinks, blown away after)
  if (dead && !bones) {
    const heap = spr(A, 'fx_sand_heap'), grow = smooth(dk / SINK), gone = smooth((dk - SINK * 1.35) / 1.0);
    if (heap && grow > 0.01 && gone < 1) { const R = big ? 2.7 : 1.15; B2.main.add(heap, ox, oy + 0.04, R * (0.55 + 0.45 * grow), R * grow * (1 - 0.7 * gone), 1, 1, 1, 1 - gone, 0, 0, 0, 1, 0, 0); }
  }
  let i = 0;
  for (const it of ORDER) {
    if (!it) continue;
    i++;
    let x = it.x, y = it.y, rot = it.rot, sx = it.sx, sy = it.sy, r = it.k, g = it.k, b = Math.min(1, it.k * 1.04);
    if (dead && bones) {
      // the bones fall apart: each drops to the ground on its own arc, tips over, bounces, scatters; the skull rolls off
      const h1 = hash(i), h2 = hash(i + 31), h3 = hash(i + 57), D = big ? 34 : 9;
      const gx = x * 1.25 + (h1 - 0.5) * D * 1.6 + (it.head ? (h2 < 0.5 ? -1 : 1) * D * (0.6 + Math.min(1, dk) * 0.5) : 0);
      const gy = -(1 + h2 * 2) * s - (it === T ? 3 * s : 0);
      const u = easeIn(fallU), bounce = fallU >= 1 ? Math.max(0, Math.sin(Math.min(1, (dk - FALL) / 0.28) * Math.PI)) * 2.2 * s * (1 - h3 * 0.5) : 0;
      x = lerp(x, gx, Math.min(1, fallU * 1.15)); y = lerp(y, gy, u) - bounce;
      // (long bones come to lie flat, the rest tips over; the ribcage lies on its back)
      const rg = it.lim ? (h3 < 0.5 ? -1 : 1) * Math.PI / 2 + (h1 - 0.5) * 0.7 : rot + (h3 - 0.5) * 1.6 + (it.head ? (h2 < 0.5 ? -1 : 1) * dk * 3 : 0);
      rot = lerp(rot, rg, smooth(fallU));
      if (it === T) sy *= 1 - 0.35 * smooth(fallU);
    } else if (dead) {
      // pouring into sand: everything sinks and spreads, its colour drying to sand
      y *= 1 - sink * 0.92; sy *= 1 - 0.55 * sink; sx *= 1 + 0.3 * sink;
      r = lerp(r, 1.02, sink * 0.8); g = lerp(g, 0.86, sink * 0.8); b = lerp(b, 0.6, sink * 0.8);
      x += (hash(i) - 0.5) * 6 * s * sink;
    }
    B2.main.add(it.s, ox + x * PX, oy, sx, sy, r, g, b, al, 0, rot, flash, it.flip, 0, -y * PX);
    if (it.sh && !dead) B2.shadow.add(it.s, ox + x * PX, oy, sx, sy, 1, 1, 1, 0.9, 0, rot, 0, it.flip, 0, -y * PX);
  }
  // the glow of the eyes (emissive: it shines in the dark), only the eyes facing the camera; the skeleton giant's
  // ghost-fire through its ribs
  const spark = opt(A, 'fx_spark');
  if (soft && !dead && H) {
    const pulse = 0.85 + 0.15 * Math.sin(t * 2.3 + ph0), c = Math.cos(H.rot), sn = Math.sin(H.rot), ec = K.eyeC, ez = big ? 1 : 0.62;
    for (const e of K.eyes) {
      if (SY * 0.9 - CY * (e[1] > 0 ? 0.42 : -0.42) < -0.05) continue;
      const wy = SY * e[0] * s - CY * e[1] * s, ex0 = CY * e[0] * s + SY * e[1] * s, ey0 = SPH * wy - CPH * e[2] * s;
      const ex = H.x + ex0 * c - ey0 * sn, ey = H.y + ex0 * sn + ey0 * c;
      B2.emissive.add(soft, ox + ex * PX, oy + 0.001, (0.26 * ez) / soft.w, (0.18 * ez) / soft.h, ec[0], ec[1], ec[2], 0.6 * pulse, 0, 0, 0, 1, 0, -ey * PX);
      if (spark) B2.emissive.add(spark, ox + ex * PX, oy + 0.002, (0.1 * ez) / spark.w, (0.075 * ez) / spark.h, Math.min(1, ec[0] + 0.2), 1, Math.min(1, ec[2] + 0.3), 0.95, 0, 0, 0, 1, 0, -ey * PX);
    }
    if (K.core) {
      proj(torsoPt(tv0, [K.core[0] * s, K.core[1] * s, K.core[2] * s]));
      const fk = 0.8 + 0.2 * Math.sin(t * 5.3 + ph0) + 0.08 * Math.sin(t * 13.1);
      B2.emissive.add(soft, ox + PR.x * PX, oy + 0.001, 1.2 / soft.w, 1.3 / soft.h, 0.45, 1, 0.6, 0.32 * fk, 0, 0, 0, 1, 0, -PR.y * PX);
    }
  }
  return true;
}
