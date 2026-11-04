// The brains of the settlements' people (game/people.js): the day's routine as tasks (walk somewhere on a town path,
// work there with an animation, idle / chat / sit, sleep in bed, go indoors = back to being a count), the danger
// (civilians run home), the guards (posts, patrols, the walls at night — archers shoot from them, crews man the
// ballistas — and the fight: the raiders' brain on the town's side, bandits.js), repairs by day. Host only.

import { PEOPLE as N, JOBS } from './content/people.js';
import { planOf } from './people.js';
import { npcMove, nearPass, npcPass, lineClear } from './townnav.js';
import { hasLOS, dealDamage, faceTowards, reach } from './combat.js';
import { fireArrow, hostProjId } from './projectiles.js';
import { facingFrom } from './physics.js';
import { stepGait } from './anim.js';
import { allPlayers, inAnyView } from './players.js';
import { seasonAt } from './seasons.js';
import { SPECIES, BUILDINGS } from './data.js';
import { heightK } from './levels.js';
import { BALLISTA, isBallista, pivotOf, seatSpot, angDiff, muzzleOf } from './ballista.js';

const SPD = { walk: 1.55, slow: 1.15, patrol: 1.3, run: 3.3, kid: 2.5 };
const R01 = (m, k = 0) => { const x = Math.sin((m.id + 1) * 12.9898 + (m._rc = (m._rc || 0) + 1) * 78.233 + k) * 43758.5453; return x - Math.floor(x); }; // (cosmetic variety: no shared state depends on it)
const objOf = (game, S, k) => (k >= 0 ? game.world.objById.get(`t${S.sid}.${k}`) || null : null);
const playersNear = (game, x, y, r) => { const w = game.world; for (const q of allPlayers(game)) if (!q.dead && Math.abs(w.dx(q.x, x)) < r && Math.abs(q.y - y) < r) return true; return false; };
const nearBuilding = (game, b) => !!b && playersNear(game, b.cx, b.cy, N.indoorR + Math.max(b.box[2] - b.box[0], b.box[3] - b.box[1]) / 2);
const inBox = (b, x, y) => !!b && x >= b.box[0] && x < b.box[2] + 1 && y >= b.box[1] && y < b.box[3] + 1;

// ---------- spots ----------
// a free tile next to a piece (inside its building when one is given), nearest to the piece's middle
function sideOf(game, o, b, pickK = -1) {
  if (!o) return null;
  const fw = o.fw || 1, fh = o.fh || 1, cx = o.tx + fw / 2, cy = o.ty + fh / 2;
  let best = null, bd = 1e9;
  const all = pickK >= 0 ? [] : null; // (pickK: one of all the free sides — a crowd at a well spreads around it)
  for (let y = o.ty - 1; y <= o.ty + fh; y++) for (let x = o.tx - 1; x <= o.tx + fw; x++) {
    const edge = x === o.tx - 1 || x === o.tx + fw || y === o.ty - 1 || y === o.ty + fh;
    if (!edge || ((x === o.tx - 1 || x === o.tx + fw) && (y === o.ty - 1 || y === o.ty + fh))) continue; // (sides only, no corners)
    if (b && !(x > b.box[0] && x < b.box[2] && y > b.box[1] && y < b.box[3]) && inBox(b, cx, cy)) continue;
    if (!npcPass(game, x, y)) continue;
    const g = game.build.grid.main.get(game.world.idx(x, y));
    if (g && g.door) continue; // (never stand in a doorway)
    const d = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2;
    if (all) all.push([x + 0.5, y + 0.5]);
    if (d < bd) { bd = d; best = [x + 0.5, y + 0.5]; }
  }
  return all && all.length ? all[pickK % all.length] : best;
}
// a free tile inside a building (not a doorway), picked with r
function insideSpot(game, b, r) {
  if (!b) return null;
  const [x0, y0, x1, y1] = b.box;
  for (let k = 0; k < 14; k++) {
    const x = x0 + 1 + Math.floor(r() * Math.max(1, x1 - x0 - 1)), y = y0 + 1 + Math.floor(r() * Math.max(1, y1 - y0 - 1));
    if (npcPass(game, x, y) && !game.build.grid.main.get(game.world.idx(x, y))?.door) return [x + 0.5, y + 0.5];
  }
  return nearPass(game, b.cx, b.cy, 2);
}
const reachable = (game, rec, ax, ay, bx, by) => !!game.people.navOf(rec.sid)?.connected(ax, ay, bx, by);
// (people.js spawnSpot) the spot by a person's bed / a free spot inside a building
export function bedSide(game, S, P) { const o = objOf(game, S, P.bed); return o ? sideOf(game, o, S.homes[P.home]) : null; }
export const insideAt = (game, b, r) => insideSpot(game, b, r);
const ring = (cx, cy, r0, r1, u, v) => { const a = u * Math.PI * 2, d = r0 + (r1 - r0) * v; return [cx + Math.cos(a) * d, cy + Math.sin(a) * d]; };

// ---------- walking ----------
// toward (gx, gy) on a town path; 'here' when arrived, 'walk', 'wait' (no path budget this frame), 'fail'
function walk(game, rec, m, gx, gy, spd, dt, arrive = 0.22) {
  const d0 = Math.hypot(gx - m.x, gy - m.y);
  if (d0 <= arrive) { m.moving = false; m.route = null; return 'here'; }
  let R = m.route;
  if (!R || R.gx !== gx || R.gy !== gy) {
    if (d0 < 1.4 || lineClear(game, m.x, m.y, gx, gy)) R = m.route = { gx, gy, p: null, i: 0 };
    else {
      // (the frame's budget of A* searches: a cached way / a quick "no way" costs nothing; after a failed search a
      // person waits a moment before asking again — nobody starves the others)
      if ((game._townPathBudget ?? 1) <= 0 || m._pathT > game.worldTime) { m.moving = false; return 'wait'; }
      const nav = game.people.navOf(rec.sid), p = nav?.path(m.x, m.y, gx, gy);
      if (nav?.cost) game._townPathBudget--;
      if (!p) { m.moving = false; m.route = null; m._fails = (m._fails || 0) + 1; m._pathT = game.worldTime + 1.2; return 'fail'; }
      R = m.route = { gx, gy, p, i: 0 };
    }
  }
  let tx = gx, ty = gy;
  if (R.p) {
    while (R.i < R.p.length && Math.hypot(R.p[R.i][0] - m.x, R.p[R.i][1] - m.y) < 0.3) R.i++;
    m._losT = (m._losT || 0) - dt;
    if (m._losT <= 0 && R.i < R.p.length) {
      m._losT = 0.3;
      for (let k = Math.min(R.p.length - 1, R.i + 3); k > R.i; k--) if (lineClear(game, m.x, m.y, R.p[k][0], R.p[k][1])) { R.i = k; break; }
    }
    if (R.i < R.p.length) { tx = R.p[R.i][0]; ty = R.p[R.i][1]; }
  }
  let dx = tx - m.x, dy = ty - m.y;
  const L = Math.hypot(dx, dy) || 1;
  dx /= L; dy /= L;
  const step = Math.min(spd * dt, L + 0.02), x0 = m.x, y0 = m.y;
  npcMove(game, m, dx * step, dy * step);
  const moved = Math.hypot(m.x - x0, m.y - y0);
  m.facing = facingFrom(dx, dy, m.facing);
  m.moving = moved > 1e-4;
  stepGait(m, moved);
  if (moved < step * 0.25) {
    m._stuckT = (m._stuckT || 0) + dt;
    if (m._stuckT > 1.6) { m._stuckT = 0; m.route = null; m._fails = (m._fails || 0) + 1; return 'fail'; }
  } else m._stuckT = 0;
  return 'walk';
}
// inside a building whose way out is blocked by its furniture (the prefabs: being fixed): it steps out of its door
// (the door swings on every peer as it goes)
function stepOut(game, rec, m, gx, gy) {
  const S = rec.S;
  for (const b of [...S.homes, ...S.works]) {
    if (!inBox(b, m.x, m.y) || reachable(game, rec, m.x, m.y, b.out[0], b.out[1])) continue;
    if (gx != null && inBox(b, gx, gy)) return false; // (going somewhere in the same room)
    m.x = b.out[0]; m.y = b.out[1]; m.route = null; m._fails = 0;
    return true;
  }
  return false;
}
// someone that cannot get there: out of sight it is simply there; in sight it gives up the trip
function unstick(game, m, gx, gy, rec = null) {
  if (rec && stepOut(game, rec, m, gx, gy)) return true;
  if ((m._fails || 0) < 3) return false;
  m._fails = 0;
  if (!inAnyView(game, m.x, m.y, 2, 3) && !inAnyView(game, gx, gy, 2, 3)) { const q = nearPass(game, gx, gy, 3); if (q) { m.x = q[0]; m.y = q[1]; return true; } }
  return false;
}

// ---------- the plan → tasks ----------
const ACT_DUR = { dig: 0.95, chop: 0.9, mine: 0.95, build: 0.85, plant: 1.6, harvest: 1.7, gather: 1.3, craft: 1.3, cook: 1.5, cast: 2.2, talk: 1.7 };
function seasonAct(game, S) { const id = seasonAt(game, S.s.x, S.s.y).id; return id === 'spring' ? 'plant' : id === 'autumn' ? 'harvest' : 'dig'; }

function startPlan(game, rec, m, pl) {
  const S = rec.S, P = m.npc, r = () => R01(m);
  m.pose = null; m.route = null;
  if (m.action?.hold) m.action = null;
  const H = S.homes[P.home] || null;
  // up on a wall / at a ballista and the duty is over: down the stairs (out of sight: a count again)
  if (m.z > 0.5 && pl.k !== 'wall' && pl.k !== 'crew') { m.task = { k: 'down' }; return; }
  const indoor = (b, then) => {
    // indoors: with a player by that building, go in and do it there; else to its door and back to being a count (and
    // the same when its inside cannot be reached from the street: a door blocked by the furniture)
    if (b && nearBuilding(game, b)) {
      const T = then();
      const from = inBox(b, m.x, m.y) ? [m.x, m.y] : b.out; // (already inside: from where it stands)
      if (T && T.k === 'go' && !T.bad && reachable(game, rec, from[0], from[1], T.x, T.y)) return T;
      if (inBox(b, m.x, m.y)) return { k: 'stand', t: 8, indoor: true }; // (inside a room it cannot leave: it stays put)
    }
    return { k: 'vanish', x: b ? b.out[0] : m.x, y: b ? b.out[1] : m.y, b };
  };
  switch (pl.k) {
    case 'bed': m.task = indoor(H, () => {
      const o = objOf(game, S, P.bed), s = o && sideOf(game, o, H);
      return s ? { k: 'go', x: s[0], y: s[1], then: { k: 'sleep', o } } : { k: 'go', ...pt(insideSpot(game, H, r)), then: { k: 'stand', t: 9 } };
    }); break;
    case 'home': case 'off': case 'shelter': m.task = indoor(H, () => ({ k: 'go', ...pt(insideSpot(game, H, r)), then: { k: 'stand', t: 6 + r() * 8, indoor: true } })); break;
    case 'tavern': m.task = indoor(S.tavern, () => {
      const k = S.chairs[(P.i * 7) % Math.max(1, S.chairs.length)], o = objOf(game, S, k ?? -1), s = o && sideOf(game, o, S.tavern);
      return s ? { k: 'go', x: s[0], y: s[1], then: { k: 'sit', o, t: 20 } } : { k: 'go', ...pt(insideSpot(game, S.tavern, r)), then: { k: 'stand', t: 8 } };
    }); break;
    case 'work': m.task = workTask(game, rec, m, pl); break;
    case 'plaza': case 'play': case 'well': m.task = pl.b && pl.k === 'play' ? porchTask(game, rec, m, true) : plazaTask(game, rec, m, pl.k); break;
    case 'porch': m.task = porchTask(game, rec, m, false); break;
    case 'post': m.task = { k: 'go', x: pl.x, y: pl.y, then: { k: 'post', fx: pl.duty.fx, fy: pl.duty.fy } }; break;
    case 'patrol': m.task = { k: 'patrol', i: pl.duty.i, dir: pl.duty.dir || 1 }; break;
    case 'wall': case 'crew': m.task = { k: 'up', duty: pl.duty }; break;
    default: m.task = { k: 'stand', t: 3 };
  }
}
const pt = (q) => (q ? { x: q[0], y: q[1] } : { x: 0, y: 0, bad: true });

function workTask(game, rec, m, pl) {
  const S = rec.S, P = m.npc, J = JOBS[P.job], r = () => R01(m, 3);
  if (P.job === 'farmer') {
    const f = S.L.fields[P.field];
    if (!f) return { k: 'stand', t: 4 };
    const x = f.x0 + 0.5 + Math.floor(r() * Math.max(1, f.x1 - f.x0)), y = f.y0 + 0.5 + Math.floor(r() * Math.max(1, f.y1 - f.y0));
    return { k: 'go', x, y, then: { k: 'act', act: seasonAct(game, S), n: 3 + Math.floor(r() * 3) } };
  }
  if (P.job === 'herder') {
    const f = S.L.pens[P.pen];
    if (!f) return { k: 'stand', t: 4 };
    const x = f.x0 + 0.5 + r() * Math.max(0.5, f.x1 - f.x0 - 1), y = f.y0 + 0.5 + r() * Math.max(0.5, f.y1 - f.y0 - 1);
    return { k: 'go', x, y, then: { k: 'act', act: 'gather', n: 2 + Math.floor(r() * 3) } };
  }
  if (P.job === 'merchant') {
    const q = nearPass(game, ...ring(S.plaza.x, S.plaza.y, S.plaza.r + 1.2, S.plaza.r + 2.2, (P.spot * 0.27 + 0.1) % 1, 0.5), 3) || [S.plaza.x, S.plaza.y];
    return { k: 'go', x: q[0], y: q[1], then: { k: 'act', act: 'talk', n: 2 + Math.floor(r() * 3), idle: 2 } };
  }
  const W = pl.b || S.works[P.work];
  if (!W) return { k: 'stand', t: 4 };
  if (!pl.in) {
    // the yard: near its door, carrying / sorting / chopping at the woodpile
    const q = nearPass(game, W.out[0] + (r() - 0.5) * 4, W.out[1] + (r() - 0.5) * 3, 3) || W.out;
    if (P.job === 'porter' || (J.carry && r() < 0.35 && P.job !== 'woodcutter')) {
      // carry something between the door and a spot of the place (a sack to the plaza / the granary)
      const far = nearPass(game, ...ring(S.plaza.x, S.plaza.y, S.plaza.r + 1, S.plaza.r + 3, r(), r()), 3) || q;
      return { k: 'go', x: far[0], y: far[1], carry: true, then: { k: 'act', act: 'craft', n: 1, then: { k: 'go', x: W.out[0], y: W.out[1], then: { k: 'stand', t: 2 } } } };
    }
    return { k: 'go', x: q[0], y: q[1], then: { k: 'act', act: J.act === 'cast' ? 'craft' : J.act || 'craft', n: 3 + Math.floor(r() * 3) } };
  }
  if (!nearBuilding(game, W)) return { k: 'vanish', x: W.out[0], y: W.out[1], b: W };
  const k = W.at.length ? W.at[(P.spot + Math.floor(game.worldTime / 60)) % W.at.length] : -1;
  const o = objOf(game, S, k), s = o ? sideOf(game, o, W) : insideSpot(game, W, r);
  if (!s) return { k: 'go', ...pt(insideSpot(game, W, r)), then: { k: 'stand', t: 6 } };
  if (P.job === 'lord') { const ch = findSeatIn(game, S, W); if (ch) return { k: 'go', x: ch.s[0], y: ch.s[1], then: { k: 'sit', o: ch.o, t: 40 } }; }
  return { k: 'go', x: s[0], y: s[1], face: o, then: { k: 'act', act: J.act || 'craft', n: 4 + Math.floor(r() * 4), face: o } };
}
function findSeatIn(game, S, b) {
  const [x0, y0, x1, y1] = b.box;
  for (let y = y0 + 1; y < y1; y++) for (let x = x0 + 1; x < x1; x++) {
    const o = game.build.grid.main.get(game.world.idx(x, y));
    if (o && /^chair|^bench/.test(o.type)) { const s = sideOf(game, o, b) || nearPass(game, o.x, o.y, 1); if (s) return { o, s }; }
  }
  return null;
}

// at its own doorstep: chores (homemakers), standing about with the neighbours (elders), children running in the street
function porchTask(game, rec, m, play) {
  const S = rec.S, P = m.npc, H = S.homes[P.home], r = () => R01(m, 11);
  if (!H) return plazaTask(game, rec, m, play ? 'play' : 'plaza');
  const R = play ? 5 : 1.6, ox = H.out[0] - H.inn[0], oy = H.out[1] - H.inn[1]; // (outward from the door)
  const cx = H.out[0] + ox * (play ? 2.5 : 0.6), cy = H.out[1] + oy * (play ? 2.5 : 0.6);
  let q = null;
  const from = inBox(H, m.x, m.y) ? H.out : [m.x, m.y];
  for (let k = 0; k < 8 && !q; k++) { const t = nearPass(game, cx + (r() - 0.5) * 2 * R, cy + (r() - 0.5) * 2 * R, 1); if (t && !inBox(H, t[0], t[1]) && Math.hypot(t[0] - H.out[0], t[1] - H.out[1]) > 0.8 && !game.world.broof.get(game.world.idx(Math.floor(t[0]), Math.floor(t[1]))) && reachable(game, rec, from[0], from[1], t[0], t[1])) q = t; }
  if (!q) q = H.out;
  if (play) return { k: 'go', x: q[0], y: q[1], run: true, then: { k: 'stand', t: 0.8 + r() * 2.2 } };
  if (P.job === 'homemaker') return { k: 'go', x: q[0], y: q[1], then: { k: 'act', act: r() < 0.6 ? 'craft' : 'gather', n: 3 + Math.floor(r() * 4), idle: 2.5, then: { k: 'stand', t: 4 + r() * 6, chat: true } } };
  if (P.job === 'farmer') return { k: 'go', x: q[0], y: q[1], then: { k: 'act', act: 'chop', n: 4 + Math.floor(r() * 4), idle: 2, then: { k: 'stand', t: 3 + r() * 4, chat: true } } }; // (winter: firewood)
  return { k: 'go', x: q[0], y: q[1], then: { k: 'stand', t: 10 + r() * 15, chat: true } };
}
function plazaTask(game, rec, m, k) {
  const S = rec.S, P = m.npc, r = () => R01(m, 7);
  if (k === 'well' && S.wells.length) {
    const o = objOf(game, S, S.wells[P.i % S.wells.length]), s = o && sideOf(game, o, null, P.i + Math.floor(game.worldTime / 30));
    if (s) return { k: 'go', x: s[0], y: s[1], face: o, then: { k: 'act', act: 'gather', n: 2, face: o, then: { k: 'go', ...pt(S.homes[P.home]?.out), carry: true, then: { k: 'stand', t: 1 } } } };
  }
  if (P.age === 'elder' && S.benches.length && r() < 0.7) {
    const o = objOf(game, S, S.benches[P.i % S.benches.length]), s = o && sideOf(game, o, null);
    if (s) return { k: 'go', x: s[0], y: s[1], then: { k: 'sit', o, t: 30 + r() * 30 } };
  }
  const run = k === 'play';
  let q = null;
  for (let n = 0; n < 6 && !q; n++) { const t = nearPass(game, ...ring(S.plaza.x, S.plaza.y, run ? 0.5 : S.plaza.r * 0.5, S.plaza.r + (run ? 4 : 3.5), r(), r()), 2); if (t && !game.world.broof.get(game.world.idx(Math.floor(t[0]), Math.floor(t[1]))) && reachable(game, rec, S.L.spawn[0], S.L.spawn[1], t[0], t[1])) q = t; } // (the start spot: always on the open plaza)
  q = q || [S.plaza.x, S.plaza.y];
  return { k: 'go', x: q[0], y: q[1], run, then: { k: 'stand', t: run ? 1 + r() * 2.5 : 4 + r() * 8, chat: !run } };
}

// ---------- the brain ----------
export function npcBrain(game, rec, m, dt) {
  const S = rec.S, P = m.npc;
  m.swingT = Math.max(0, (m.swingT || 0) - dt);
  if (m.action && !m.action.hold) { m.action.t += dt / (m.action.dur || 0.5); if (m.action.t >= 1) m.action = null; }
  if (m.stunT > 0) { m.stunT -= dt; m.moving = false; m.action = null; return; }
  if (m.fearT > 0) m.fearT -= dt;
  if (m.hp < m.maxHp && m.state !== 'chase' && !rec.danger) m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.02 * dt);
  if (P.guard) { if (guardFight(game, rec, m, dt)) return; }
  else if (flee(game, rec, m, dt)) return;
  if (m.repair && repairWork(game, rec, m, dt)) return;
  m.planT -= dt;
  if (m.planT <= 0 || !m.task) {
    m.planT = 0.9 + (m.id % 7) * 0.08;
    const pl = planOf(game, S, P, game.env?.hour ?? 12, rec.danger, !!seasonAt(game, S.s.x, S.s.y).hard);
    if (pl.key !== m.planKey || !m.task) { m.planKey = pl.key; startPlan(game, rec, m, pl); }
  }
  runTask(game, rec, m, dt);
}

function runTask(game, rec, m, dt) {
  const T = m.task;
  if (!T) { m.moving = false; return; }
  const P = m.npc;
  switch (T.k) {
    case 'go': {
      if (T.bad) { m.task = T.then || null; return; }
      if (!T.chk) {
        T.chk = 1;
        if (!reachable(game, rec, m.x, m.y, T.x, T.y) && !(stepOut(game, rec, m, T.x, T.y) && reachable(game, rec, m.x, m.y, T.x, T.y))) {
          // no way there (a room closed by its furniture, a pen without a gate): out of sight it is simply there
          if (!inAnyView(game, m.x, m.y, 2, 3) && !inAnyView(game, T.x, T.y, 2, 3)) { m.x = T.x; m.y = T.y; m.route = null; m.task = T.then || null; return; }
          m.task = { k: 'stand', t: 3 + R01(m) * 3 }; m.planKey = ''; return;
        }
      }
      const spd = T.run ? (P.age === 'child' ? SPD.kid : SPD.run) : P.age === 'elder' ? SPD.slow : P.guard ? SPD.patrol : SPD.walk;
      if (T.carry && P.carry && !m.action) m.action = { type: 'carry', t: 0, hold: true };
      const s = walk(game, rec, m, T.x, T.y, spd, dt);
      if (s === 'here') { if (m.action?.type === 'carry') m.action = null; if (T.face) faceTowards(m, { x: T.face.x, y: T.face.cy ?? T.face.y }); m.task = T.then || null; }
      else if (s === 'fail' && unstick(game, m, T.x, T.y)) { /* teleported out of sight */ }
      else if (s === 'fail' && (m._fails || 0) >= 3) { m.task = { k: 'stand', t: 2 }; m._fails = 0; m.planKey = ''; }
      return;
    }
    case 'act': {
      m.moving = false;
      if (T.face) faceTowards(m, { x: T.face.x, y: T.face.cy ?? T.face.y });
      if (T.pause > 0) { T.pause -= dt; lookAround(game, rec, m, T, dt); return; }
      if (!m.action) {
        if (T.n-- <= 0) { m.task = T.then || null; if (!m.task) m.planKey = ''; return; }
        if (T.idle && R01(m) < 0.4) { T.n++; T.pause = T.idle; return; } // (a pause between two)
        m.action = { type: T.act, t: 0, dur: ACT_DUR[T.act] || 1.2 };
        if (T.act === 'build' || T.act === 'chop' || T.act === 'mine') game.later(0.32 * (ACT_DUR[T.act] || 1), () => { if (!m.dead && m.action?.type === T.act) game.audio?.play(T.act === 'build' ? 'build_hit' : T.act === 'chop' ? 'chop' : 'mine', { x: m.x, y: m.y, volume: 0.35 }); });
      }
      return;
    }
    case 'stand': {
      m.moving = false;
      T.t -= dt;
      lookAround(game, rec, m, T, dt);
      if (T.t <= 0) { m.task = null; m.planKey = ''; }
      return;
    }
    case 'sit': case 'sleep': {
      m.moving = false;
      if (!T.o || T.o.removed) { m.pose = null; m.task = null; return; }
      if (!m.pose) {
        m.pose = { type: T.k, id: T.o.id, o: T.o };
        if (T.k === 'sit' && T.o.face) m.facing = T.o.face;
        m.action = null;
      }
      if (T.k === 'sit' && T.t != null) { T.t -= dt; if (T.t <= 0) { m.pose = null; m.task = null; m.planKey = ''; } }
      return;
    }
    case 'vanish': {
      // to the door, and in: the person becomes a count again (unless a player came close to that building meanwhile)
      const s = walk(game, rec, m, T.x, T.y, P.guard ? SPD.patrol : SPD.walk, dt, 0.4);
      if (s === 'here' || (s === 'fail' && (m._fails || 0) >= 2)) {
        if (T.b && nearBuilding(game, T.b)) { const q = insideSpot(game, T.b, () => R01(m)); if (q && reachable(game, rec, m.x, m.y, q[0], q[1])) { m.task = { k: 'go', x: q[0], y: q[1], then: { k: 'stand', t: 6, indoor: true } }; return; } }
        if (!inAnyView(game, m.x, m.y, -1, -1) || s === 'here') { game.people._drop(rec, m); return; }
      }
      return;
    }
    case 'post': {
      m.moving = false;
      lookAround(game, rec, m, T, dt);
      return;
    }
    case 'patrol': {
      const L = rec.S.posts.patrol;
      if (!L.length) { m.task = { k: 'stand', t: 5 }; return; }
      if (T.wait > 0) { T.wait -= dt; m.moving = false; lookAround(game, rec, m, T, dt); return; }
      const q = L[((T.i % L.length) + L.length) % L.length];
      const s = walk(game, rec, m, q[0], q[1], SPD.patrol, dt, 0.5);
      if (s === 'here' || (s === 'fail' && (m._fails || 0) >= 2)) { T.i += T.dir; T.wait = 1.5 + R01(m) * 2.5; m._fails = 0; if (s === 'fail') unstick(game, m, q[0], q[1]); }
      return;
    }
    case 'up': upTask(game, rec, m, T, dt); return;
    case 'down': m.moving = false; if (!inAnyView(game, m.x, m.y, 2, 3)) game.people._drop(rec, m); else lookAround(game, rec, m, T, dt); return;
    default: m.task = null;
  }
}

// idle: look at a player standing by, at the street, at a partner (chats on the plaza: turns talking)
function lookAround(game, rec, m, T, dt) {
  T.lt = (T.lt || 0) - dt;
  if (T.lt > 0) return;
  T.lt = 0.8 + R01(m) * 1.5;
  // a player standing close: turn to them
  for (const q of allPlayers(game)) {
    if (q.dead || Math.abs(q.x - m.x) > 2.6 || Math.abs(q.y - m.y) > 2.6 || q.moving) continue;
    faceTowards(m, q);
    if (!m.action && R01(m) < 0.35) m.action = { type: 'talk', t: 0, dur: ACT_DUR.talk };
    return;
  }
  if (T.fx != null && R01(m) < 0.6) { m.facing = facingFrom(T.fx + (R01(m) - 0.5), T.fy + (R01(m) - 0.5), m.facing); return; }
  if (T.chat) {
    let mate = T.mate && !T.mate.dead && T.mate.task?.k === 'stand' && Math.hypot(T.mate.x - m.x, T.mate.y - m.y) < 2.6 ? T.mate : null;
    if (!mate) for (const o of rec.ents.values()) { if (o !== m && !o.dead && o.task?.k === 'stand' && o.task.chat && Math.abs(o.x - m.x) < 2.4 && Math.abs(o.y - m.y) < 2.4) { mate = o; break; } }
    T.mate = mate;
    if (mate) { faceTowards(m, mate); if (!m.action && R01(m) < 0.55) m.action = { type: 'talk', t: 0, dur: ACT_DUR.talk }; T.t = Math.max(T.t, 2); return; }
  }
  if (R01(m) < 0.3) m.facing = ['s', 'e', 'w', 's', 'n'][Math.floor(R01(m) * 5)];
}

// ---------- danger: civilians run home ----------
function flee(game, rec, m, dt) {
  if (!rec.danger && !(m.fearT > 0)) { if (m._fled) { m._fled = false; m.planKey = ''; m.task = null; } return false; }
  const P = m.npc, H = rec.S.homes[P.home];
  if (!m._fled) { m._fled = true; m.pose = null; m.action = null; m.route = null; m.task = null; }
  if (m.task?.k === 'stand' && m.task.indoor) { runTask(game, rec, m, dt); return true; } // (already inside, by a player)
  const gx = H ? H.out[0] : rec.S.plaza.x, gy = H ? H.out[1] : rec.S.plaza.y;
  const s = walk(game, rec, m, gx, gy, SPD.run, dt, 0.45);
  if (s === 'here') {
    const q = H && nearBuilding(game, H) ? insideSpot(game, H, () => R01(m)) : null;
    if (q && reachable(game, rec, m.x, m.y, q[0], q[1])) { m.task = { k: 'go', x: q[0], y: q[1], then: { k: 'stand', t: 30, indoor: true } }; runTask(game, rec, m, dt); return true; }
    game.people._drop(rec, m); // (safe inside: a count again — shown inside again if a player is by the house)
  } else if (s === 'fail') unstick(game, m, gx, gy);
  return true;
}

// ---------- guards ----------
const hostile = (e) => !e.dead && e.isMob && !e.npc && !e.proxy && e.state !== 'evade' && (e.faction === 'walker' || e.faction === 'bandit' || e.temper === 'hostile'); // (one going home — evade — cannot be hurt: let it go)
// the nearest hostile a guard sees (or hears of: the bell) inside its town land + a margin
export function guardTargets(game, rec, m, sight = N.guardSight) {
  const S = rec.S, w = game.world, R = S.s.r + N.guardLeash, R2 = R * R;
  let best = null, bd = rec.danger ? Math.max(sight + 10, S.s.r * 2 + 6) : sight; // (the bell: the whole watch hears it, across the town)
  for (const e of game.entities) {
    if (!hostile(e)) continue;
    const d = Math.hypot(w.dx(e.x, m.x), e.y - m.y);
    if (d >= bd) continue;
    const dx = w.dx(e.x, S.s.x), dy = e.y - S.s.y;
    if (dx * dx + dy * dy > R2) continue;
    if (d > 6 && !rec.danger && !hasLOS(w, m.x, m.y, e.x, e.y, m.z || 0, e.z || 0, m._tn, e._tn)) continue;
    best = e; bd = d;
  }
  return best;
}
function guardFight(game, rec, m, dt) {
  if (m.z > 0.5) return false; // (up on a wall / at a ballista: its own task shoots — upTask)
  m.scanT = (m.scanT || 0) - dt;
  if (m.scanT <= 0 || (m.foe && m.foe.dead)) {
    m.scanT = 0.3 + (m.id % 5) * 0.04;
    const f = m.foe && !m.foe.dead && hostile(m.foe) && inReach(game, rec, m.foe) ? m.foe : guardTargets(game, rec, m);
    if (f && !m.foe) engage(game, m, f);
    m.foe = f; m.threat = f;
  }
  const f = m.foe;
  if (!f || f.dead) {
    if (m.state === 'chase') { m.state = 'idle'; m.threat = null; m.foe = null; m.planKey = ''; m.task = null; m.route = null; m.action = null; }
    return false;
  }
  m.state = 'chase'; m.lastCombatT = game.worldTime;
  const P = m.npc, sp = SPECIES.guard, d = Math.hypot(f.x - m.x, f.y - m.y);
  const fx = Math.floor(f.x) + 0.5, fy = Math.floor(f.y) + 0.5; // (the foe's tile: a new way only when it changes tiles)
  if (P.job === 'archer') {
    // archers on the ground: close in to a good range with a line of fire, then shoot
    const see = hasLOS(game.world, m.x, m.y, f.x, f.y, m.z || 0, f.z || 0, m._tn, f._tn);
    if (d > N.archerRange * 0.85 || !see) { const s = walk(game, rec, m, fx, fy, sp.speed, dt, 3); if (s === 'fail') unstick(game, m, fx, fy, rec); return true; }
    m.moving = false; faceTowards(m, f);
    if (m.swingT <= 0) { m.swingT = (m.swingDur || 1.6) * (0.95 + R01(m) * 0.25); m.action = { type: 'shoot', t: 0, dur: 0.6 }; game.later(0.34, () => { if (!m.dead && !f.dead) shoot(game, m, f); }); }
    return true;
  }
  // spears and swords: up to it (through the town's own gates: their people pass them) — each from its own side around
  // it, not all on one tile —, then the swing timer
  const rng = reach(m, f);
  if (rng < 0 || d > rng) {
    const a = Math.atan2(m.y - f.y, m.x - f.x) + ((m.id % 5) - 2) * 0.45, k = Math.max(0.5, (rng > 0 ? rng : 0.9) * 0.7);
    let gx = f.x + Math.cos(a) * k, gy = f.y + Math.sin(a) * k;
    if (d > 4) { gx = fx; gy = fy; } // (far: to its tile; the side when close)
    const s = walk(game, rec, m, Math.floor(gx * 2) / 2 + 0.25, Math.floor(gy * 2) / 2 + 0.25, sp.speed, dt, d > 4 ? Math.max(0.3, (rng > 0 ? rng : 0.8) * 0.8) : 0.2);
    if (s === 'fail') unstick(game, m, fx, fy, rec);
    else if (s === 'here' && d > rng) { m.route = null; npcMove(game, m, (f.x - m.x) / d * 0.04, (f.y - m.y) / d * 0.04); }
    return true;
  }
  m.moving = false; faceTowards(m, f);
  if (m.swingT <= 0) {
    m.swingT = m.swingDur * (0.9 + R01(m) * 0.2);
    m.specialT = (m.specialT || 0) - m.swingT;
    const heavy = m.specialT <= 0;
    if (heavy) m.specialT = 6 + R01(m) * 4;
    const act = m.wprof?.type === 'spear' ? (heavy ? 'pierce' : 'stab') : heavy ? 'cleave' : 'slash';
    m.action = { type: act, t: 0, dur: heavy ? 0.45 : 0.36 };
    game.audio?.play('swing', { x: m.x, y: m.y, volume: 0.5 });
    game.later(0.22, () => {
      if (m.dead || f.dead || Math.hypot(f.x - m.x, f.y - m.y) > rng + 0.6) return;
      dealDamage(game, m, f, m.dmg * (heavy ? 1.6 : 1) * (0.85 + R01(m) * 0.3), { from: m, ability: heavy ? act : undefined });
    });
  }
  return true;
}
// a foe still worth chasing: in the town land (+ the leash)
function inReach(game, rec, e) {
  const S = rec.S, R = S.s.r + N.guardLeash, dx = game.world.dx(e.x, S.s.x), dy = e.y - S.s.y;
  return dx * dx + dy * dy < R * R;
}
export function engage(game, m, foe) {
  m.task = null; m.pose = null; m.route = null; m.action = null;
  m.state = 'chase'; m.threat = foe; m.foe = foe; m.lastCombatT = game.worldTime;
  game.audio?.play('growl', { x: m.x, y: m.y, volume: 0.35 }); // (a shout)
}
// hurt by something (ai.js aggro → game.people.onHurt): guards fight back, civilians run
export function npcHurt(game, m, src) {
  if (!m || m.dead || m.proxy || !src || src === m || src.npc) return;
  if (m.npc.guard) { if (hostile(src) && m.state !== 'chase' && !(m.z > 0.5)) engage(game, m, src); }
  else m.fearT = 10;
}

// up on the walls (archers) / at a ballista (crews): there when nobody sees (they climbed), then they watch and shoot
function upTask(game, rec, m, T, dt) {
  const d = T.duty, S = rec.S;
  if (!(m.z > 0.5) && (d.lv | 0) > 0) {
    // still on the ground: climb (out of sight) — else walk to below the spot and wait
    if (!inAnyView(game, d.x, d.y, 1, 2) && !inAnyView(game, m.x, m.y, 1, 2)) { m.x = d.x; m.y = d.y; m.lv = d.lv; m.z = d.lv; m.route = null; return; }
    const q = nearPass(game, d.x - (d.fx || 0) * 2, d.y - (d.fy || 0) * 2, 3);
    if (q) walk(game, rec, m, q[0], q[1], SPD.walk, dt, 0.4);
    return;
  }
  m.moving = false;
  if (d.k === 'crew') { crewTask(game, rec, m, T, dt); return; }
  // archers: shoot what comes near (+20 % range a story up)
  T.scan = (T.scan || 0) - dt;
  if (T.scan <= 0) { T.scan = 0.35; T.foe = guardTargets(game, rec, m, N.archerRange * 1.5); }
  const f = T.foe;
  if (!f || f.dead) { T.foe = null; lookAround(game, rec, m, T.look || (T.look = { fx: d.fx, fy: d.fy }), dt); return; }
  const rng = N.archerRange * heightK(m, f), dd = Math.hypot(f.x - m.x, f.y - m.y);
  faceTowards(m, f);
  if (dd > rng || m.swingT > 0) return;
  if (!hasLOS(game.world, m.x, m.y, f.x, f.y, m.z || 0, f.z || 0, null, f._tn)) return;
  m.swingT = (m.swingDur || 1.6) * (0.95 + R01(m) * 0.3);
  m.action = { type: 'shoot', t: 0, dur: 0.6 };
  game.later(0.34, () => { if (!m.dead && !f.dead) shoot(game, m, f); });
}
function shoot(game, m, f) {
  const dmg = Math.max(1, Math.round(m.dmg * (0.9 + R01(m) * 0.3)));
  fireArrow(game, {
    src: m, faction: 'town', x: m.x, y: m.y, tx: f.x, ty: f.y, range: N.archerRange * 1.6, kind: 'arrow', target: f, z1: f.z || 0,
    onHit: (g, e, pr) => { dealDamage(g, m, e, dmg, { ranged: true, from: { x: pr.ox, y: pr.oy } }); },
  });
  game.audio?.play('bow', { x: m.x, y: m.y, volume: 0.45 });
}
// a ballista crew: aims at the biggest threat in reach (a giant first) and fires (ops ballista.set / ballista.shot — the
// same as a player's, by 'npc'); never while a player operates it
function crewTask(game, rec, m, T, dt) {
  const S = rec.S, o = objOf(game, S, T.duty.s);
  if (!isBallista(o) || o.user) { lookAround(game, rec, m, T, dt); return; }
  const [px, py] = pivotOf(o);
  T.scan = (T.scan || 0) - dt;
  if (T.scan <= 0) {
    T.scan = 0.5;
    let best = null, bs = -1;
    for (const e of game.entities) {
      if (!hostile(e)) continue;
      const d = Math.hypot(e.x - px, e.y - py);
      if (d > BALLISTA.range * 0.8 || d < 3) continue;
      const sc = (SPECIES[e.species]?.giant ? 100 : 1) - d * 0.05;
      if (sc > bs && hasLOS(game.world, px, py, e.x, e.y, o.lv | 0, e.z || 0)) { bs = sc; best = e; }
    }
    T.foe = best;
  }
  const f = T.foe;
  const a = f && !f.dead ? Math.atan2(f.y - py, f.x - px) : null;
  // stand behind it, facing where it points
  const seat = seatSpot(game, o, Number.isFinite(o.aim) ? o.aim : 0) || [px, py];
  if (Math.hypot(seat[0] - m.x, seat[1] - m.y) > 0.4 && !inAnyView(game, m.x, m.y, 1, 2)) { m.x = seat[0]; m.y = seat[1]; }
  if (a == null) { lookAround(game, rec, m, T, dt); return; }
  m.facing = facingFrom(Math.cos(a), Math.sin(a), m.facing);
  T.aimT = (T.aimT || 0) - dt;
  const cur = Number.isFinite(o.aim) ? o.aim : a, diff = angDiff(a, cur);
  if (Math.abs(diff) > 0.04 && T.aimT <= 0) { T.aimT = 0.25; const na = cur + Math.max(-0.5, Math.min(0.5, diff)); game.net.emit('ballista.set', { id: o.id, aim: +na.toFixed(4) }); return; }
  T.fireT = (T.fireT || 0) - dt;
  if (Math.abs(diff) <= 0.06 && T.fireT <= 0) {
    T.fireT = BALLISTA.reload * 1.6;
    const [mx, my] = muzzleOf(o, cur);
    game.net.emit('ballista.shot', { id: o.id, sid: hostProjId(), x: +mx.toFixed(3), y: +my.toFixed(3), a: +cur.toFixed(4), by: 'npc' });
  }
}

// ---------- repairs by day: a worker / a guard off its post fixes the town's walls and gates ----------
const REPAIRERS = new Set(['woodcutter', 'smith', 'porter', 'farmer', 'miner', 'groom', 'guard']);
export function repairTick(game, rec, dt) {
  const h = game.env?.hour ?? 12;
  rec.repT = (rec.repT || 0) - dt;
  if (rec.repT > 0) return;
  rec.repT = 2;
  if (rec.danger || h < 7 || h > 18.6) { for (const m of rec.ents.values()) if (m.repair) { m.repair = null; m.action = null; } return; }
  const pre = `t${rec.sid}.`, jobs = [];
  for (const [id, r] of game.towns.state) {
    if (!id.startsWith(pre)) continue;
    if (r.dmg > 0) jobs.push([id, r, 0]);
    else if (r.gone && game.worldTime - r.at > 20) jobs.push([id, r, 1]);
  }
  for (const m of rec.ents.values()) if (m.repair && !jobs.some((j) => j[0] === m.repair.id)) { m.repair = null; m.action = null; m.task = null; m.planKey = ''; }
  if (!jobs.length) return;
  // the lower stories first (a wall walk needs its wall)
  const L = rec.S.L;
  jobs.sort((a, b) => (L.structs[+a[0].split('.')[1]]?.[4] | 0) - (L.structs[+b[0].split('.')[1]]?.[4] | 0));
  const busy = new Set([...rec.ents.values()].filter((m) => m.repair).map((m) => m.repair.id));
  for (const [id, r, gone] of jobs) {
    if (busy.has(id) || busy.size >= 3 || rec.noRepair?.get(id) > game.worldTime - 20) continue; // (nobody could get to it lately)
    // the nearest free adult that can repair (not a guard at a gate / on a wall, not fighting)
    let best = null, bd = 40;
    for (const m of rec.ents.values()) {
      const P = m.npc;
      if (m.dead || m.repair || !REPAIRERS.has(P.job) || m.state === 'chase' || m.z > 0.5 || m.task?.k === 'vanish') continue;
      if (P.guard && m.task?.k !== 'patrol') continue;
      const d = Math.hypot(m.x - (r.x + 0.5), m.y - (r.y + 0.5));
      if (d < bd) { bd = d; best = m; }
    }
    if (!best) continue;
    best.repair = { id, gone: !!gone, x: r.x, y: r.y, t: 0, hit: 0 };
    best.task = null; best.pose = null; best.route = null;
    busy.add(id);
  }
}
function repairWork(game, rec, m, dt) {
  const J = m.repair, st = game.towns.state.get(J.id);
  if (!st || (!J.gone && !(st.dmg > 0)) || (J.gone && !st.gone)) { m.repair = null; m.action = null; m.planKey = ''; m.task = null; return false; }
  const row = rec.S.L.structs[+J.id.split('.')[1]];
  if (!J.spot) {
    // a free tile beside the piece that this person can walk to (the street side of a house wall, either side of a
    // palisade log), the nearest to it
    const fw = (BUILDINGS[row?.[0]]?.size?.[0]) || 1, fh = (BUILDINGS[row?.[0]]?.size?.[1]) || 1, w = row && row[3] & 1 ? fh : fw, h = row && row[3] & 1 ? fw : fh;
    let best = null, bd = 1e9;
    for (let y = J.y - 1; y <= J.y + h; y++) for (let x = J.x - 1; x <= J.x + w; x++) {
      if (x >= J.x && x < J.x + w && y >= J.y && y < J.y + h) continue;
      if (!npcPass(game, x, y) || game.build.grid.main.get(game.world.idx(x, y))?.door || !reachable(game, rec, m.x, m.y, x + 0.5, y + 0.5)) continue;
      const d = Math.hypot(x + 0.5 - m.x, y + 0.5 - m.y) + ((x === J.x - 1 || x === J.x + w) && (y === J.y - 1 || y === J.y + h) ? 1.5 : 0);
      if (d < bd) { bd = d; best = [x + 0.5, y + 0.5]; }
    }
    J.spot = best;
    if (!J.spot) { (rec.noRepair || (rec.noRepair = new Map())).set(J.id, game.worldTime); m.repair = null; return false; }
  }
  const s = walk(game, rec, m, J.spot[0], J.spot[1], SPD.walk * 1.5, dt, 0.3); // (in a hurry: a hole in the wall)
  m._rw = s;
  if (!(m._trT > game.worldTime)) { m._trT = game.worldTime + 1; (m._trail || (m._trail = [])).push(m.x.toFixed(1) + ',' + m.y.toFixed(1)); if (m._trail.length > 6) m._trail.shift(); }
  if (s !== 'here') { if (s === 'fail' && !unstick(game, m, J.spot[0], J.spot[1], rec) && (m._fails || 0) >= 3) { (rec.noRepair || (rec.noRepair = new Map())).set(J.id, game.worldTime); m.repair = null; } return true; }
  m.moving = false;
  faceTowards(m, { x: J.x + 0.5, y: J.y + 0.5 });
  if (!m.action) { m.action = { type: 'build', t: 0, dur: 0.8 }; game.later(0.3, () => { if (!m.dead && m.action?.type === 'build') game.audio?.play('build_hit', { x: m.x, y: m.y, volume: 0.45 }); }); }
  J.t += dt;
  const o = game.world.objById.get(J.id);
  if (!J.gone) {
    if (J.t < N.repairEvery) return true;
    J.t = 0;
    const stone = /stone/.test(row?.[0] || '');
    const step = o?.sdmg ? N.repairStep.siege : stone ? N.repairStep.stone : N.repairStep.wood;
    const d = Math.max(0, (st.dmg / 100) - step);
    if (o?.sdmg) game.net.emit('siege.dmg', { id: J.id, d: +d.toFixed(4), x: +m.x.toFixed(2), y: +m.y.toFixed(2) });
    else game.net.emit('struct.dmg', { id: J.id, d: +d.toFixed(4), x: +m.x.toFixed(2), y: +m.y.toFixed(2) });
    if (d <= 0) { m.repair = null; m.action = null; m.planKey = ''; m.task = null; }
    return true;
  }
  // a destroyed piece: built again (nobody standing in its place)
  if (J.t < N.rebuildS) return true;
  const busy = allPlayers(game).concat(game.entities).some((e) => !e.dead && Math.abs(e.x - (J.x + 0.5)) < 0.75 && Math.abs(e.y - (J.y + 0.5)) < 0.75);
  if (busy) { J.t = N.rebuildS * 0.7; return true; }
  game.net.emit('town.restore', { ids: [J.id] });
  game.juice?.puff?.(J.x + 0.5, J.y + 0.5, 10, [0.72, 0.64, 0.52], 0.8);
  m.repair = null; m.action = null; m.planKey = ''; m.task = null;
  return true;
}
// far from the players (no creature to do it): the people mend the walls by the hour, by day
export function repairByNumbers(game, step = 0.2) {
  const h = game.env?.hour ?? 12;
  if (h < 7 || h > 18.6) return;
  for (const [id, r] of game.towns.state) {
    if (!(r.dmg > 0)) continue;
    const sid = +id.slice(1).split('.')[0];
    if (game.people.live.get(sid)?.ents.size) continue; // (a settlement with its people out: they do it by hand)
    const o = game.world.objById.get(id), d = Math.max(0, r.dmg / 100 - step);
    game.net.emit(o?.sdmg ? 'siege.dmg' : 'struct.dmg', { id, d: +d.toFixed(4), x: r.x + 0.5, y: r.y + 0.5 });
  }
}

// ---------- the people do not walk through each other (moving ones step aside; the ones standing stay put) ----------
const SEP = [];
export function npcSeparate(game, rec) {
  const L = SEP, PL = allPlayers(game);
  L.length = 0;
  for (const m of rec.ents.values()) if (!m.dead && !(m.z > 0.5) && m._pd < N.nearR) L.push(m);
  // never standing in a player: step aside (not someone in bed / on a chair)
  for (const m of L) {
    if (m.pose || m._pd > 2) continue;
    for (const q of PL) {
      const dx = m.x - q.x, dy = m.y - q.y, rr = m.r + (q.r || 0.24);
      if (q.dead || Math.abs(dx) > rr || Math.abs(dy) > rr || Math.abs((q.z || 0) - (m.z || 0)) > 0.5) continue;
      const d = Math.hypot(dx, dy) || 0.01;
      if (d < rr) npcMove(game, m, (dx / d) * (rr - d) * 0.35, (dy / d) * (rr - d) * 0.35);
    }
  }
  for (let i = 0; i < L.length; i++) {
    const a = L[i];
    for (let j = i + 1; j < L.length; j++) {
      const b = L[j], rr = (a.r + b.r) * 0.95, dx = b.x - a.x, dy = b.y - a.y;
      const am = a.moving || a.state === 'chase', bm = b.moving || b.state === 'chase'; // (fighters jostle into their own places too)
      if (Math.abs(dx) > rr || Math.abs(dy) > rr || (!am && !bm) || a.pose || b.pose) continue;
      const d = Math.hypot(dx, dy);
      if (d < 1e-3 || d >= rr) continue;
      const push = (rr - d) * 0.5, ux = dx / d, uy = dy / d;
      const ka = am ? (bm ? 1 : 2) : 0, kb = bm ? (am ? 1 : 2) : 0;
      if (ka) npcMove(game, a, -ux * push * ka * 0.5, -uy * push * ka * 0.5);
      if (kb) npcMove(game, b, ux * push * kb * 0.5, uy * push * kb * 0.5);
    }
  }
}
