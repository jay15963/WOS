// The ice giant's rig (species 'giant'): its own body (art/giantBody.js parts) posed by a small 3D skeleton every
// frame and seen from the view the camera has of it — 8 views (s, se, e, ne, n and the mirrored sw, w, nw), the 3/4
// ones included, at every camera angle and at 0° too (a giant walking on a diagonal shows its diagonal view).
// Everything is a function of replicated state (facing, moving / moveT, action {type, t, hold}, flash, dead / deadT)
// plus time, so a guest's copy moves like the host's:
//   idle (breathing, a slow sway, the club resting on the snow) · heavy walk (feet that step and plant, the pelvis
//   dropping on every step, the body rocking over the standing leg, arms swinging) · smash: the club raised high in
//   both fists behind the head and held, quivering (the wind-up the danger circle counts down), then slammed on the
//   ground in front · throw: the left hand pulls an ice rock out of the snow, lifts it over the head and hurls it ·
//   hurt (it rocks back) · death: it shatters, the pieces flying apart and fading (fx/walkerfx.js adds the shards).
// drawGiant returns false while its parts are still being painted (compose.js then draws the old stand-in).

import { SK, EYES, PHI, GIANT_PARTS } from './giantBody.js';
import { lookAtlasOf, LOOK_CLOCK } from './look/lazy.js';
import { viewFacing8 } from './facing.js';

const TAU = Math.PI * 2, PX = 1 / 64;
const SPH = Math.sin(PHI), CPH = Math.cos(PHI);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (u) => { u = clamp01(u); return u * u * (3 - 2 * u); };
const easeIn = (u) => { u = clamp01(u); return u * u * u; };
const easeOut = (u) => { u = clamp01(u); return 1 - (1 - u) * (1 - u); };
// walk: the gait phase per moveT unit (moveT grows 0.25 per tile on every peer): one step every 0.9 tiles
export const GIANT_GAIT = Math.PI / (0.25 * 0.9);
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
let asked = null;
function prefetch(A) { if (asked === A) return; asked = A; for (const n of GIANT_PARTS) spr(A, n); } // (all views: they paint over the next frames)
function opt(A, n) { return A.has(n) ? A.get(n) : null; }

// ---------- small vector helpers (body space: x forward, y left, z up; px) ----------
const V = () => [0, 0, 0];
const set3 = (o, x, y, z) => { o[0] = x; o[1] = y; o[2] = z; return o; };
const lerp = (a, b, u) => a + (b - a) * u;
const lerp3 = (o, a, b, u) => set3(o, lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u));
const nrm3 = (o) => { const l = Math.hypot(o[0], o[1], o[2]) || 1; o[0] /= l; o[1] /= l; o[2] /= l; return o; };

// ---------- key poses ----------
// pel: pelvis (x, y, z) · pitch (forward lean), roll (+ = toward its right) · fR / fL: fist centres · club: the club's
// direction from the right fist (unit) · aR / aL: ankles · two: the left fist on the haft below the right one
const N = (v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const P = (o) => ({ pel: [0, 0, SK.pelvis], pitch: 0.05, roll: 0, fR: [8, -36, 41], fL: [10, 36, 40], club: N([0.75, -0.1, -0.65]), aR: [0, -14, SK.ankle], aL: [0, 14, SK.ankle], two: 0, ...o });
const REST = P({ fR: [10, -38, 42], fL: [12, 38, 41] });
const SMASH_UP = P({ pel: [-2, 0, 54], pitch: -0.16, fR: [-5, -8, 128], club: N([-0.55, 0.05, 0.83]), aR: [-4, -16, SK.ankle], aL: [8, 16, SK.ankle], two: 1 });
const SMASH_HIT = P({ pel: [6, 0, 49], pitch: 0.44, fR: [40, -10, 36], club: N([0.8, -0.28, -0.53]), aR: [-9, -16, SK.ankle], aL: [13, 16, SK.ankle], two: 1 });
const THROW_DOWN = P({ pel: [3, 0, 50], pitch: 0.36, fL: [24, 22, 14], fR: [12, -34, 46], aR: [6, -15, SK.ankle], aL: [-4, 15, SK.ankle] });
const THROW_UP = P({ pel: [-3, 0, 55], pitch: -0.14, roll: 0.07, fL: [-18, 25, 124], fR: [16, -33, 54], club: N([0.6, -0.2, -0.77]), aR: [8, -15, SK.ankle], aL: [-7, 15, SK.ankle] });
const THROW_REL = P({ pel: [5, 0, 52], pitch: 0.3, roll: -0.04, fL: [38, 12, 88], fR: [10, -34, 46], aR: [8, -15, SK.ankle], aL: [-7, 15, SK.ankle] });
const THROW_FOL = P({ pel: [4, 0, 52], pitch: 0.24, fL: [30, 8, 50], fR: [8, -35, 44], aR: [8, -15, SK.ankle], aL: [-7, 15, SK.ankle] });

// the current pose (scratch, no allocation)
const Q = { pel: V(), pitch: 0, roll: 0, k: 1, fR: V(), fL: V(), club: V(), aR: V(), aL: V(), two: 0, lR: 0, lL: 0, rock: false, hp: 0, nod: 0 };
function mix(a, b, u) {
  lerp3(Q.pel, a.pel, b.pel, u); Q.pitch = lerp(a.pitch, b.pitch, u); Q.roll = lerp(a.roll, b.roll, u);
  lerp3(Q.fR, a.fR, b.fR, u); lerp3(Q.fL, a.fL, b.fL, u); nrm3(lerp3(Q.club, a.club, b.club, u));
  lerp3(Q.aR, a.aR, b.aR, u); lerp3(Q.aL, a.aL, b.aL, u); Q.two = lerp(a.two, b.two, u);
}
// pose of the moment from the replicated state
function pose(p, t, ph0) {
  const act = p.action && (p.action.t ?? 0) < 1 ? p.action : null, k = act ? clamp01(act.t || 0) : 0;
  const type = act ? (act.type === 'throw' ? 'throw' : 'smash') : null; // (any other blow: the club comes down)
  Q.rock = false; Q.lR = 0; Q.lL = 0; Q.nod = 0; Q.k = 1;
  if (type === 'smash') {
    if (act.hold) {
      mix(SMASH_UP, SMASH_UP, 0);
      const q = Math.sin(t * 38 + ph0) * 0.035, q2 = Math.sin(t * 29 + 1.3) * 0.02; // (quivering, high)
      Q.club[0] += q; Q.club[1] += q2; nrm3(Q.club); Q.fR[2] += Math.sin(t * 31) * 0.8; Q.pel[2] += Math.sin(t * 23) * 0.5;
    } else if (k < 0.41) mix(REST, SMASH_UP, smooth(k / 0.41) * 0.92 + easeOut(k / 0.41) * 0.08);
    else if (k < 0.53) mix(SMASH_UP, SMASH_HIT, easeIn((k - 0.41) / 0.12));
    else if (k < 0.66) { mix(SMASH_HIT, SMASH_HIT, 0); const u = (k - 0.53) / 0.13; Q.pel[2] -= Math.sin(u * Math.PI) * 2.5; Q.k = 1 - Math.sin(u * Math.PI) * 0.04; }
    else mix(SMASH_HIT, REST, smooth((k - 0.66) / 0.34));
  } else if (type === 'throw') {
    if (act.hold) { mix(THROW_UP, THROW_UP, 0); Q.fL[2] += Math.sin(t * 27) * 0.7; }
    else if (k < 0.15) mix(REST, THROW_DOWN, smooth(k / 0.15));
    else if (k < 0.43) mix(THROW_DOWN, THROW_UP, smooth((k - 0.15) / 0.28));
    else if (k < 0.5) mix(THROW_UP, THROW_REL, easeIn((k - 0.43) / 0.07));
    else if (k < 0.62) mix(THROW_REL, THROW_FOL, smooth((k - 0.5) / 0.12));
    else mix(THROW_FOL, REST, smooth((k - 0.62) / 0.38));
    Q.rock = act.hold || (k > 0.1 && k < 0.47);
  } else mix(REST, REST, 0);
  // idle life: breathing, a slow sway, the head looking about
  const br = Math.sin(t * 1.6 + ph0);
  Q.k *= 1 + br * 0.012; Q.pel[2] += br * 0.4;
  Q.roll += Math.sin(t * 0.33 + ph0 * 2) * 0.015;
  Q.fR[2] += br * 0.6; Q.fL[2] += br * 0.6;
  Q.nod = Math.sin(t * 0.45 + ph0) * 0.05;
  // walk: heavy steps (a planted foot sweeps back, the other swings forward with a lift; the pelvis drops on every
  // step and rocks over the standing leg; the arms swing against the legs, the club arm less)
  const mk = p._mk ?? (p.moving ? 1 : 0);
  if (mk > 0.01) {
    const g = (p.moveT || 0) * GIANT_GAIT, s = Math.sin(g), c = Math.cos(g), S = 25 * mk, H = 10 * mk;
    Q.aR[0] += S * s; Q.aL[0] -= S * s;
    Q.lR = H * Math.max(0, c) ** 1.4; Q.lL = H * Math.max(0, -c) ** 1.4;
    Q.aR[2] += Q.lR; Q.aL[2] += Q.lL;
    Q.pel[2] -= 4.5 * mk * s * s; Q.pel[1] += 3.2 * mk * c; Q.roll -= 0.05 * mk * c; Q.pitch += 0.09 * mk;
    Q.fL[0] += 11 * mk * s; Q.fL[2] += 3 * mk * Math.abs(s); Q.fR[0] -= 5 * mk * s;
    Q.nod -= 0.04 * mk * s * s;
  }
  // hit flinch: it rocks back, the head jerks
  const fl = p.flash || 0;
  if (fl > 0.05) { const f = fl * fl; Q.pitch -= 0.16 * f; Q.pel[0] -= 3 * f; Q.nod -= 0.2 * f; Q.fR[1] -= 4 * f; Q.fL[1] += 4 * f; }
  // two hands on the haft: the left fist below the right one
  if (Q.two > 0.01) { const tx = Q.fR[0] - Q.club[0] * 13, ty = Q.fR[1] - Q.club[1] * 13 + 6, tz = Q.fR[2] - Q.club[2] * 13; Q.fL[0] = lerp(Q.fL[0], tx, Q.two); Q.fL[1] = lerp(Q.fL[1], ty, Q.two); Q.fL[2] = lerp(Q.fL[2], tz, Q.two); }
}

// ---------- skeleton ----------
const tmp = V();
// a torso point (rest offset from the pelvis) in body space: breathing, forward lean, roll
function torsoPt(o, v, pitch = Q.pitch, roll = Q.roll, k = Q.k) {
  const x = v[0], y = v[1], z = v[2] * k, cp = Math.cos(pitch), sp = Math.sin(pitch), cr = Math.cos(roll), sr = Math.sin(roll);
  const x1 = x * cp + z * sp, z1 = -x * sp + z * cp;
  return set3(o, Q.pel[0] + x1, Q.pel[1] + y * cr - z1 * sr, Q.pel[2] + y * sr + z1 * cr);
}
// two-bone IK: root a, target b, bone lengths l1 / l2, pole (the way the middle joint bends) → mid joint m, end e
function ik(m, e, a, b, l1, l2, pole) {
  let dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  let L = Math.hypot(dx, dy, dz) || 1;
  const ux = dx / L, uy = dy / L, uz = dz / L;
  L = Math.max(Math.abs(l1 - l2) + 0.5, Math.min(l1 + l2 - 0.3, L));
  const da = (l1 * l1 - l2 * l2 + L * L) / (2 * L), h = Math.sqrt(Math.max(0, l1 * l1 - da * da));
  let px = pole[0], py = pole[1], pz = pole[2];
  const pd = px * ux + py * uy + pz * uz;
  px -= ux * pd; py -= uy * pd; pz -= uz * pd;
  const pl = Math.hypot(px, py, pz) || 1;
  set3(m, a[0] + ux * da + (px / pl) * h, a[1] + uy * da + (py / pl) * h, a[2] + uz * da + (pz / pl) * h);
  set3(e, a[0] + ux * L, a[1] + uy * L, a[2] + uz * L);
}
const J = { pel: V(), neck: V(), sR: V(), sL: V(), eR: V(), eL: V(), fR: V(), fL: V(), wR: V(), wL: V(), hR: V(), hL: V(), kR: V(), kL: V(), aR: V(), aL: V(), club: V() };
const ARM = SK.farm + SK.fist;
function skeleton() {
  set3(J.pel, Q.pel[0], Q.pel[1], Q.pel[2]);
  torsoPt(J.neck, SK.neck);
  torsoPt(J.sR, set3(tmp, SK.shoulder[0], -SK.shoulder[1], SK.shoulder[2]));
  torsoPt(J.sL, set3(tmp, SK.shoulder[0], SK.shoulder[1], SK.shoulder[2]));
  // arms: elbows bend back and out when low, out and forward when raised
  const up = (f) => clamp01((f[2] - 70) / 40);
  let u = up(Q.fR);
  ik(J.eR, J.fR, J.sR, Q.fR, SK.uarm, ARM, [-1 + 1.3 * u, -0.7 - 0.5 * u, -0.2 * u]);
  u = up(Q.fL);
  ik(J.eL, J.fL, J.sL, Q.fL, SK.uarm, ARM, [-1 + 1.3 * u, 0.7 + 0.5 * u, -0.2 * u]);
  const w = SK.farm / ARM;
  lerp3(J.wR, J.eR, J.fR, w); lerp3(J.wL, J.eL, J.fL, w);
  // legs: knees forward and a little out
  const cr = Math.cos(Q.roll), sr = Math.sin(Q.roll);
  set3(J.hR, Q.pel[0], Q.pel[1] - SK.hip[1] * cr, Q.pel[2] + SK.hip[2] - SK.hip[1] * sr);
  set3(J.hL, Q.pel[0], Q.pel[1] + SK.hip[1] * cr, Q.pel[2] + SK.hip[2] + SK.hip[1] * sr);
  ik(J.kR, J.aR, J.hR, Q.aR, SK.thigh, SK.shin, [1, -0.25, 0]);
  ik(J.kL, J.aL, J.hL, Q.aL, SK.thigh, SK.shin, [1, 0.25, 0]);
  set3(J.club, J.fR[0] + Q.club[0] * SK.club, J.fR[1] + Q.club[1] * SK.club, J.fR[2] + Q.club[2] * SK.club);
}

// ---------- projection (body → screen px: x right, y down; d = toward the camera) ----------
let CY = 0, SY = 1;
const PR = { x: 0, y: 0, d: 0 };
function proj(v) { const wy = SY * v[0] - CY * v[1]; PR.x = CY * v[0] + SY * v[1]; PR.y = SPH * wy - CPH * v[2]; PR.d = wy; return PR; }
function projDir(v) { const wy = SY * v[0] - CY * v[1]; PR.x = CY * v[0] + SY * v[1]; PR.y = SPH * wy - CPH * v[2]; PR.d = wy; return PR; }

// ---------- draw items ----------
// it: [sprite, x px, y px (screen, from the ground point), sx, sy, rot, flip, shadow]
const ITEMS = [];
let NI = 0;
function item(s, x, y, sx, sy, rot, flip, sh = 1) {
  if (!s) return null;
  const it = ITEMS[NI] || (ITEMS[NI] = { s: null, x: 0, y: 0, sx: 1, sy: 1, rot: 0, flip: 1, sh: 1, k: 1 });
  NI++;
  it.s = s; it.x = x; it.y = y; it.sx = sx; it.sy = sy; it.rot = rot; it.flip = flip; it.sh = sh; it.k = 1;
  return it;
}
// a limb sprite (painted along −z) from joint a to joint b, bone length L
function limb(s, a, b, L) {
  const pa = proj(a), ax = pa.x, ay = pa.y;
  const pb = proj(b), dx = pb.x - ax, dy = pb.y - ay, len = Math.hypot(dx, dy);
  return item(s, ax, ay, 1, Math.max(0.34, len / (L * CPH)), Math.atan2(-dx, dy), 1);
}
function at(s, v, flip, rot = 0, sx = 1, sy = 1) { const p = proj(v); return item(s, p.x, p.y, sx, sy, rot, flip); }

const ORDER = [];
const tv0 = V(), tv1 = V(), tv2 = V();
let SEED = 0;
const hash = (i) => { const x = Math.sin((SEED + 1) * 12.9898 + i * 78.233) * 43758.5453; return x - Math.floor(x); };

export function drawGiant(B, A, p, t, env) {
  prefetch(A);
  // the view: on a turned camera game.js set it (p._dv / p.facing); at 0° the facing angle picks it here too
  const turned = env.animEnv.rs !== 0 || env.animEnv.rc !== 1;
  let v8 = p._dv;
  if (!v8) {
    if (!turned) { const f = viewFacing8(p, t, 0); v8 = p._dv || f; p._dv = null; }
    else v8 = p.facing || 's';
  }
  const VW = VIEW8[v8] || VIEW8.s, pv = VW[0], mir = VW[1], yaw = VW[2];
  // parts of this view (all or nothing: the stand-in until they are painted)
  const S = {
    torso: spr(A, 'gi_torso_' + pv), head: spr(A, 'gi_head_' + pv), fist: spr(A, 'gi_fist_' + pv), foot: spr(A, 'gi_foot_' + pv),
    pR: spr(A, (mir > 0 ? 'gi_paulR_' : 'gi_paulL_') + pv), pL: spr(A, (mir > 0 ? 'gi_paulL_' : 'gi_paulR_') + pv), uarm: spr(A, 'gi_uarm'), farm: spr(A, 'gi_farm'), thigh: spr(A, 'gi_thigh'), shin: spr(A, 'gi_shin'), club: spr(A, 'gi_club'),
  };
  for (const k in S) if (!S[k]) return false;
  CY = Math.cos(yaw); SY = Math.sin(yaw);
  const ph0 = p._ph ?? (p._ph = ((p.id ?? 0) * 0.618 + Math.random()) * TAU);
  const dead = !!p.dead, dk = dead ? p.deadT || 0 : 0;
  if (dead && dk > 1.4) return true; // (shattered: fx/walkerfx.js threw the shards)
  pose(p, t, ph0);
  if (dead) { Q.pitch = 0.18; Q.rock = false; }
  skeleton();
  NI = 0;
  // ---- the parts ----
  const fl = p.flash || 0;
  // torso: the painted torso turned / squashed like the shoulder line and the spine are now
  const pp = proj(J.pel), px0 = pp.x, py0 = pp.y;
  torsoPt(tv0, SK.neck, 0, 0, 1); proj(tv0); const u0x = PR.x - px0, u0y = PR.y - py0; // (the rest spine, pitch 0)
  proj(J.neck); const u1x = PR.x - px0, u1y = PR.y - py0;
  const trot = Math.atan2(u1x, -u1y) - Math.atan2(u0x, -u0y), tsy = Math.hypot(u1x, u1y) / (Math.hypot(u0x, u0y) || 1);
  const T = item(S.torso, px0, py0, 1, tsy, trot, mir);
  const nk = proj(J.neck);
  const H = item(S.head, nk.x, nk.y, 1, 1, trot * 0.55 + CY * (Q.nod + Q.pitch * 0.3), mir);
  // arms
  const UR = limb(S.uarm, J.sR, J.eR, SK.uarm), FR = limb(S.farm, J.eR, J.wR, SK.farm);
  const UL = limb(S.uarm, J.sL, J.eL, SK.uarm), FL = limb(S.farm, J.eL, J.wL, SK.farm);
  const XR = at(S.fist, J.fR, mir), XL = at(S.fist, J.fL, mir);
  // the club from the right fist, foreshortened along its direction
  const cb = proj(J.fR), cbx = cb.x, cby = cb.y;
  projDir(set3(tv1, Q.club[0] * SK.club, Q.club[1] * SK.club, Q.club[2] * SK.club));
  const CL = item(S.club, cbx, cby, 1, Math.max(0.3, Math.hypot(PR.x, PR.y) / (SK.club * CPH)), Math.atan2(-PR.x, PR.y), 1);
  // the ice rock in the left hand (throw)
  const rockS = Q.rock ? spr(A, 'proj_ice_rock') : null;
  const RK = rockS ? at(rockS, set3(tv2, J.fL[0] + 2, J.fL[1], J.fL[2] + 7), 1, Math.sin(t * 3) * 0.2, 0.78, 0.78) : null;
  // pauldrons on the shoulders
  const PRr = at(S.pR, torsoPt(tv0, set3(tv1, SK.shoulder[0], -SK.shoulder[1], SK.shoulder[2] + 3)), mir, trot);
  const PLl = at(S.pL, torsoPt(tv0, set3(tv1, SK.shoulder[0], SK.shoulder[1], SK.shoulder[2] + 3)), mir, trot);
  // legs and feet (a lifted foot tips its toes down)
  const TR = limb(S.thigh, J.hR, J.kR, SK.thigh), SR = limb(S.shin, J.kR, J.aR, SK.shin);
  const TL = limb(S.thigh, J.hL, J.kL, SK.thigh), SL = limb(S.shin, J.kL, J.aL, SK.shin);
  const KR = at(S.foot, J.aR, mir, CY * 0.04 * Q.lR), KL = at(S.foot, J.aL, mir, CY * 0.04 * Q.lL);

  // ---- order (back to front) ----
  // front / back views: the legs under the torso, the arms beside it (in front of it facing the camera, under it
  // facing away), the head in front or hidden behind the hump; side and 3/4 views: the far side, the torso, the near
  // side. The club leaves its arm when it goes behind the body (front view) or comes toward the camera (back view).
  ORDER.length = 0;
  const lat = CY, fwd = SY;
  const clubD = proj(set3(tv1, J.fR[0] + Q.club[0] * 26, J.fR[1] + Q.club[1] * 26, J.fR[2] + Q.club[2] * 26)).d, torsoD = proj(set3(tv2, Q.pel[0] - 4, Q.pel[1], Q.pel[2])).d;
  const armR = [UR, PRr, FR, CL, XR], armL = [UL, PLl, FL, XL, RK];
  if (Math.abs(lat) < 0.3) {
    const front = fwd > 0, clubOut = front ? clubD < torsoD - 6 : clubD > torsoD + 6;
    if (clubOut) armR[3] = null;
    if (front) ORDER.push(clubOut ? CL : null, TL, SL, KL, TR, SR, KR, T, ...armL, ...armR, H);
    else ORDER.push(H, TL, SL, KL, TR, SR, KR, UL, FL, XL, RK, UR, FR, armR[3], XR, T, PLl, PRr, clubOut ? CL : null);
  } else {
    const nearR = lat > 0, back = fwd < -0.3;
    const farLeg = nearR ? [TL, SL, KL] : [TR, SR, KR], nearLeg = nearR ? [TR, SR, KR] : [TL, SL, KL];
    const farArm = nearR ? armL : armR, nearArm = nearR ? armR : armL;
    if (back) ORDER.push(H);
    for (const it of farLeg) if (it) it.k = 0.8; // (the far side in the body's shade)
    for (const it of farArm) if (it) it.k = 0.8;
    ORDER.push(...farLeg, ...farArm, T);
    if (!back) ORDER.push(H);
    ORDER.push(...nearLeg, ...nearArm);
  }

  // ---- emit ----
  const B2 = env.viewB(B, p.x, p.y); // (camera turned: screen offsets → world)
  const ox = p.x, oy = p.y;
  SEED = (p.id ?? 0) * 7.13;
  let al = 1, burst = 0, flash = fl;
  if (dead) { burst = Math.max(0, dk - 0.08); al = 1 - smooth((dk - 0.55) / 0.8); flash = Math.max(fl, 0.55 * (1 - dk)); }
  const T0 = opt(A, 'fx_blob');
  if (T0) B2.blob.add(T0, ox, oy + 0.02, 1.55, 1.05, 1, 1, 1, 0.7 * (dead ? 1 - smooth(dk / 0.5) : 1));
  let i = 0;
  for (const it of ORDER) {
    if (!it) continue;
    i++;
    let x = it.x, y = it.y, rot = it.rot;
    if (burst > 0) {
      // shatter: every piece flies off on its own arc, spinning, and fades (the torso mostly sinks)
      const big = it === T, h1 = hash(i), h2 = hash(i + 31), h3 = hash(i + 57), sp = big ? 0.25 : 1;
      x += (h1 - 0.5) * 150 * sp * burst; y += (-(40 + 70 * h2) * sp * burst + 320 * burst * burst) * (big ? 0.3 : 1);
      rot += (h3 - 0.5) * 9 * burst * sp;
    }
    B2.main.add(it.s, ox + x * PX, oy, it.sx, it.sy, it.k, it.k, Math.min(1, it.k * 1.04), al, 0, rot, flash, it.flip, 0, -y * PX);
    if (it.sh && !dead) B2.shadow.add(it.s, ox + x * PX, oy, it.sx, it.sy, 1, 1, 1, 0.9, 0, rot, 0, it.flip, 0, -y * PX);
  }
  // the cold glow of the eyes (emissive: it shines in the dark), only the eyes facing the camera
  const soft = opt(A, 'fx_soft'), spark = opt(A, 'fx_spark');
  if (soft && !dead && H) {
    // (the eye on the head sprite: its rest offset from the neck, turned with the head)
    const pulse = 0.85 + 0.15 * Math.sin(t * 2.3 + ph0), c = Math.cos(H.rot), s = Math.sin(H.rot);
    for (const e of EYES) {
      if (SY * 0.9 - CY * (e[1] > 0 ? 0.42 : -0.42) < -0.05) continue; // (the eye looking away from the camera)
      projDir(e);
      const ex = H.x + PR.x * c - PR.y * s, ey = H.y + PR.x * s + PR.y * c;
      B2.emissive.add(soft, ox + ex * PX, oy + 0.001, 0.2 / soft.w, 0.14 / soft.h, 0.45, 0.92, 1, 0.6 * pulse, 0, 0, 0, 1, 0, -ey * PX);
      if (spark) B2.emissive.add(spark, ox + ex * PX, oy + 0.002, 0.08 / spark.w, 0.06 / spark.h, 0.75, 1, 1, 0.95, 0, 0, 0, 1, 0, -ey * PX);
    }
  }
  return true;
}
