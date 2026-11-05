// The playable siege (docs/REINOS.md §4, §5 "Para a fase 3", §14 "Fase 3b — o cerco"): a kingdom's force besieging a
// settlement near the players, on the host, through the same rules and ops as a player's siege engines.
//
//   march   → the column comes up to its camp spot, OUT of the defenders' reach (it measures the archers on the walls —
//             13 tiles + 20 % a story, as npc.js shoots — the ballistas' 34 tiles, the gate guards' chase) + a margin;
//   camp    → the engineers raise the camp: tents and banners in the kingdom's colours, fires (structures of the army:
//             o.realm = k, op war.mark);
//   build   → an Oficina de cerco in front of the camp, then the engines as real blueprints with build time (placeReason:
//             the player's own rules), the siege tower with the height of the wall stretch it is planned against
//             (towerStoriesFor), the trebuchets 34–43 tiles from their target;
//   bombard → an engineer on each trebuchet (siege.set user '~<nid>', the aim turned at the frame's speed, the shot
//             through mut/siege.js fireShot: the same reload and scatter as a player's) at a stretch of the wall:
//             persistent damage (siege.dmg) until a piece breaks → a breach;
//   assault → the ram pushed by its crew (siege.set push, the host's own stepping: siege.js hostPush) to the gate,
//             blows (ramBlow) until it breaks; the tower pushed to the wall, the ramp drops, the soldiers climb its
//             ladder, cross onto the wall walk and fight there, then go down inside; the infantry runs through any opening
//             (a flow field to the plaza over the soldiers' ground: closed gates and walls block), the archers shoot the
//             defenders on the walls, the general rallies from behind;
//   held    → the attackers hold the centre (the plaza) with no defender around for a while: game.realms.capture(sid, k);
//   retreat → heavy losses, the morale broken or too long: they run back past the camp; camp and engines are struck.
// The defenders are the place's watch (game/people.js, defense.js): the bell, the threat on the army's side
// (game.townDefense via game.warfare.threatOn), guards fighting soldiers of a kingdom at war, ballistas on soldiers and
// engines. Host only.

import { WAR, CRIES, CAMP } from './content/soldiers.js';
import { BUILDINGS } from './data.js';
import { ARTY, PUSH } from './content/siege.js';
import {
  towerStoriesFor, toWorld, slotLocal, ladderLocal, deckLocal, frontTiles, DIR, isGate, seatSpot, pivotOf, aimOf, angDiff, towerN, isEngineObj, frontAng,
} from './siege.js';
import { fireShot, ramBlow } from './mut/siege.js';
import { placeReason, baseFor, dimsOf } from './mut/structures.js';
import { solNear, solPass, stepTo, FlowField, surfAt, atWar, ownerOf, unstick } from './soldier.js';
import { setPhase, shout, repelled } from './warfare.js';
import { allPlayers, inAnyView } from './players.js';
import { BALLISTA } from './ballista.js';
import { facingFrom } from './physics.js';

const r2 = (v) => Math.round(v * 100) / 100;
const SIDES = [[0, 1], [-1, 0], [0, -1], [1, 0]]; // (= siege.js DIR: rot r's front)
const rotFacing = (dx, dy) => SIDES.findIndex(([x, y]) => x === dx && y === dy);
const ARCH_REACH = (lv) => 13 * (1 + 0.2 * (lv | 0)) + 1.5; // (npc.js: archerRange × heightK; + a margin)

// ---------- set up (warfare.js startSiege) ----------
export function siegeSetup(game, F, spec) {
  const s = game.towns.realm.settlements[spec.sid];
  const at = spec.at || [s.x + s.r + 40, s.y];
  F.sg = { sid: spec.sid, at, want: spec.eng || null, plan: null, tries: 0, t: 0, camp: [], jobs: [], made: 0, capT: 0, shots: 0, breach: null, gateDown: false, rampDown: false, climbed: 0, onWall: 0 };
  F.anchor = { x: at[0], y: at[1] };
  const dx = s.x - at[0], dy = s.y - at[1], d = Math.hypot(dx, dy) || 1;
  F.face = { x: dx / d, y: dy / d }; F.fx = F.face.x; F.fy = F.face.y;
  F.x = at[0]; F.y = at[1];
  F.phase = 'march';
  F.slotOf = (u) => slotOf(F, u);
  F.rear = () => [F.anchor.x - F.face.x * 8, F.anchor.y - F.face.y * 8];
}

// ---------- the plan: the side, the camp, the engines and their targets (once the place is all made here) ----------
// Spread over the force's ticks (a few ms each): the basics, then each of the four axis sides of the wall line weighed
// (a clear lane for the ram to a gate, one for the tower to a stretch of its height, room for the trebuchets), then the
// best side (facing the army, the most engines) with its camp and the workshop within 16 tiles of every engine.
function plan(game, F) {
  const G = F.sg, sid = G.sid, s = game.towns.realm.settlements[sid];
  let Q = G.pp;
  if (!Q) {
    if (!game.towns.ready?.(sid) || !game.people) return null;
    const S = game.people.of(sid), per = game.townDefense?.perimeter(sid);
    if (!S || !per) return null;
    const C = { x: per.cx, y: per.cy };
    const ax0 = G.at[0] - C.x, ay0 = G.at[1] - C.y, al = Math.hypot(ax0, ay0) || 1, A = { x: ax0 / al, y: ay0 / al };
    const pieces = [...per.pieces.values()].filter((p) => game.world.objById.has(p.id));
    const reach = [];
    for (const w of S.posts.walls) reach.push([w.x, w.y, ARCH_REACH(w.lv)]);
    for (const c of S.posts.crews) reach.push([c.x, c.y, BALLISTA.range + 1]);
    const wallLv = Math.max(1, ...S.posts.walls.map((w) => w.lv | 0));
    const sides = SIDES.map(([sx, sy]) => [sx, sy]).sort((p, q) => (q[0] * A.x + q[1] * A.y) - (p[0] * A.x + p[1] * A.y));
    G.pp = Q = { S, per, C, A, pieces, reach, laneL: Math.max(12, Math.ceil(ARCH_REACH(wallLv)) + 2), sides, k: 0, cands: [] };
    return null;
  }
  const { S, per, C, A, pieces, reach } = Q, want = { treb: 1, ram: 1, tower: 1, ...(G.want || {}) };
  if (Q.k < Q.sides.length) {
    // one side a tick
    const side = Q.sides[Q.k++], [nx, ny] = side, tx = -ny, ty = nx;
    const onSide = pieces.filter((p) => p.fx === nx && p.fy === ny);
    if (onSide.length < 4 && per.walled) { why('lado ' + side, onSide.length + ' peças'); return null; }
    const proj = (p) => (p.cx - C.x) * tx + (p.cy - C.y) * ty;
    const gates = onSide.filter((p) => p.gate), walls = onSide.filter((p) => !p.gate && gates.every((g) => Math.hypot(g.cx - p.cx, g.cy - p.cy) > 4.5));
    let ram = null, tower = null;
    if (want.ram && gates.length) for (const g of gates.slice().sort((a, b) => Math.abs(proj(a)) - Math.abs(proj(b)))) { ram = laneFor(game, 'battering_ram', g, side, s, Q.laneL); if (ram) { ram.gate = g; break; } }
    if (want.tower && per.walled) {
      const ref = ram ? proj(ram.gate) : 0;
      const cand = walls.filter((p) => !ram || (Math.abs(proj(p) - ref) > 5 && Math.abs(proj(p) - ref) < 16)).sort((a, b) => Math.abs(Math.abs(proj(a) - ref) - (ram ? 8 : 0)) - Math.abs(Math.abs(proj(b) - ref) - (ram ? 8 : 0)));
      for (const p of cand.slice(0, 16)) { tower = laneFor(game, 'siege_tower', p, side, s, Q.laneL); if (tower) { tower.wall = p; break; } }
    }
    // the trebuchets' targets: near the lanes (one workshop serves them all), apart from each other
    const lanes = [ram, tower].filter(Boolean), mid = lanes.length ? lanes.reduce((a, q) => a + ((q.tx + q.fw / 2 - C.x) * tx + (q.ty + q.fh / 2 - C.y) * ty), 0) / lanes.length : 0;
    const trebs = [];
    for (const p of walls.slice().sort((a, b) => Math.abs(proj(a) - mid) - Math.abs(proj(b) - mid))) {
      if (trebs.length >= Math.max(0, Math.min(3, want.treb | 0))) break;
      if (Math.abs(proj(p) - mid) > 12 || trebs.some((q) => Math.abs(proj(q.target) - proj(p)) < 5) || (tower && Math.abs(proj(tower.wall) - proj(p)) < 3)) continue;
      let got = null;
      for (let D = WAR.siege.trebD[0]; D <= WAR.siege.trebD[1] && !got; D += 2) {
        const q = spotFor(game, 'trebuchet', p.cx + nx * D - 1.5, p.cy + ny * D - 1.5, rotFacing(-nx, -ny), 2);
        if (q && !trebs.some((t) => Math.abs(t.tx - q.tx) < 4 && Math.abs(t.ty - q.ty) < 4) && !lanes.some((l) => Math.abs(l.tx - q.tx) < 4 && Math.abs(l.ty - q.ty) < 4)) got = q;
      }
      if (got) trebs.push({ target: p, ...got });
    }
    const face = nx * A.x + ny * A.y;
    Q.cands.push({ side, onSide, ram, tower, trebs, score: face * 1.2 + (ram ? 1.1 : 0) + (tower ? 1 : 0) + (trebs.length ? 0.9 : 0) });
    return null;
  }
  // the best side
  const best = Q.cands.slice().sort((a, b) => b.score - a.score)[0];
  if (!best) { G.pp = null; return null; }
  const { side, onSide, trebs } = best, [nx, ny] = side, tx = -ny, ty = nx;
  let { ram, tower } = best;
  const pad = WAR.siege.pad, cr = WAR.siege.campR;
  const outOfReach = (x, y, extra = 0) => reach.every(([rx, ry, r]) => Math.hypot(x - rx, y - ry) >= r + extra) && Math.hypot(x - C.x, y - C.y) >= s.r + 12 + extra;
  // the camp: out of everything's reach on that side, toward the army
  const dl = Math.hypot(nx + A.x * 0.5, ny + A.y * 0.5) || 1, dir = { x: (nx + A.x * 0.5) / dl, y: (ny + A.y * 0.5) / dl };
  let camp = null;
  for (let D = s.r + 12 + pad + cr; D < s.r + 150 && !camp; D += 2) {
    for (const da of [0, 0.2, -0.2, 0.42, -0.42, 0.65, -0.65]) {
      const c = Math.cos(da), sn = Math.sin(da), ux = dir.x * c - dir.y * sn, uy = dir.x * sn + dir.y * c;
      const x = C.x + ux * D, y = C.y + uy * D;
      if (!outOfReach(x, y, pad + cr)) continue;
      const q = solNear(game, x, y, 2);
      if (q && openArea(game, q[0], q[1], 3)) { camp = { x: q[0], y: q[1] }; break; }
    }
  }
  if (!camp) { G.pp = null; G.tries += 10; return null; }
  // the workshop: in the middle of the engines' spots (a little further out), every engine within 15.5 tiles of it
  const eng = [ram, tower, ...trebs].filter(Boolean);
  const wsRot = nx ? 1 : 0;
  let ws = null, wsC = null;
  if (eng.length) {
    const cx = eng.reduce((a, q) => a + q.tx + q.fw / 2, 0) / eng.length + nx * 3, cy = eng.reduce((a, q) => a + q.ty + q.fh / 2, 0) / eng.length + ny * 3;
    for (const [ox, oy] of [[0, 0], [nx * 3, ny * 3], [tx * 3, ty * 3], [-tx * 3, -ty * 3], [-nx * 3, -ny * 3], [nx * 6, ny * 6]]) {
      ws = spotFor(game, 'siege_workshop', cx + ox - 1.5, cy + oy - 1, wsRot, 3);
      if (ws) break;
    }
  }
  if (!ws) ws = spotFor(game, 'siege_workshop', camp.x - dir.x * (cr + 4) - 1.5, camp.y - dir.y * (cr + 4) - 1, wsRot, 6);
  if (!ws) { G.pp = null; G.tries += 10; return null; }
  wsC = [ws.tx + ws.fw / 2, ws.ty + ws.fh / 2];
  const nearWs = (q) => q && Math.hypot(q.tx + q.fw / 2 - wsC[0], q.ty + q.fh / 2 - wsC[1]) <= 15.5;
  const jobs = [{ type: 'siege_workshop', tx: ws.tx, ty: ws.ty, rot: wsRot, v: 0, p: 0, id: null, role: 'ws' }];
  for (const q of trebs) if (nearWs(q)) jobs.push({ type: 'trebuchet', tx: q.tx, ty: q.ty, rot: q.rot, v: 0, p: 0, id: null, role: 'treb', target: q.target.id, tgt: [q.target.cx, q.target.cy] });
  if (nearWs(ram)) jobs.push({ type: 'battering_ram', tx: ram.tx, ty: ram.ty, rot: ram.rot, v: 0, p: 0, id: null, role: 'ram', target: ram.gate.id, end: ram.end, steps: ram.steps }); else ram = null;
  if (nearWs(tower)) jobs.push({ type: 'siege_tower', tx: tower.tx, ty: tower.ty, rot: tower.rot, v: tower.v, p: 0, id: null, role: 'tower', target: tower.wall.id, end: tower.end, steps: tower.steps }); else tower = null;
  // the infantry waits out of the archers' reach in front of the side; the archers' line is within reach of the walls
  const wallD = Math.max(...onSide.map((p) => (p.cx - C.x) * nx + (p.cy - C.y) * ny), per.A);
  const engProj = eng.length ? eng.reduce((a, q) => a + ((q.tx + q.fw / 2 - C.x) * tx + (q.ty + q.fh / 2 - C.y) * ty), 0) / eng.length : 0;
  const along = (d) => ({ x: C.x + nx * d + tx * engProj, y: C.y + ny * d + ty * engProj });
  const assembly = along(wallD + Q.laneL + 3), archLine = along(wallD + 13);
  const L = S.L, plaza = { x: L.plaza[0], y: L.plaza[1] };
  // the flow field to the plaza over a box around the place (the soldiers' ground: walls and closed gates block)
  const half = Math.ceil(Math.max(wallD + 30, Math.hypot(assembly.x - C.x, assembly.y - C.y) + 12));
  const ff = new FlowField(game, Math.floor(C.x - half), Math.floor(C.y - half), half * 2 + 1, half * 2 + 1);
  const goals = [];
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (solPass(game, Math.floor(plaza.x) + dx, Math.floor(plaza.y) + dy)) goals.push([plaza.x + dx, plaza.y + dy]);
  G.pp = null;
  return { S, L, per, C, A: dir, army: A, side, camp, jobs, assembly, archLine, plaza, ff, goals, wallD, s, onSide: onSide.map((p) => p.id), laneL: Q.laneL };
}
// a free spot for a building (the player's placement rules; the workshop rule checked when it is built); near: [x, y] its
// middle must stay within 15.5 tiles of
function spotFor(game, type, x, y, rot, R = 4, near = null) {
  const [fw, fh] = dimsOf(type, rot);
  for (let r = 0; r <= R; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const tx = Math.round(x) + dx, ty = Math.round(y) + dy;
    if (near && Math.hypot(tx + fw / 2 - near[0], ty + fh / 2 - near[1]) > 15.5) continue;
    const pr = planReason(game, type, tx, ty, rot);
    if (pr) { if (!r) why(type + '@' + tx + ',' + ty, pr); continue; }
    if (!openArea(game, tx + fw / 2, ty + fh / 2, Math.max(fw, fh) / 2 + 1)) { if (!r) why(type + '@' + tx + ',' + ty, 'apertado'); continue; }
    return { tx, ty, rot, fw, fh };
  }
  return null;
}
function planReason(game, type, tx, ty, rot) {
  const r = placeReason(game, type, tx, ty, null, rot);
  if (!r || (typeof r === 'string' && r.startsWith('Construa perto de uma Oficina'))) return null; // (the workshop comes first)
  return r;
}
// passable ground all around (x, y) (room for the camp / an engine and the soldiers around it)
function openArea(game, x, y, R) {
  let bad = 0, n = 0;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { n++; if (!solPass(game, Math.floor(x + dx), Math.floor(y + dy))) bad++; }
  return bad <= n * 0.12;
}
// a pushed engine's lane: its start `L` tiles out from the target piece (out of the archers' reach, outside the town
// land), front toward the wall, every step of the way clear (the same test as a push: placeReason ignoring itself, the
// terrain's steps) -> { tx, ty, rot, fw, fh, v (a tower's stories), end [tx, ty] at the wall, steps }
const WHY = [];
export const planWhy = () => WHY.slice(-60); // (tests / debug: why lanes / spots were refused)
const why = (t, r) => { WHY.push(t + ': ' + r); if (WHY.length > 200) WHY.splice(0, 100); return null; };
function laneFor(game, type, p, side, s, L) {
  const [nx, ny] = side, rot = rotFacing(-nx, -ny), [fw, fh] = dimsOf(type, rot);
  const pw = p.gate ? (nx ? 1 : 2) : 1, ph = p.gate ? (nx ? 2 : 1) : 1; // (a gate: 2 tiles along the wall)
  let x0, y0;
  if (ny === 1) { x0 = p.x; y0 = p.y + ph; } else if (ny === -1) { x0 = p.x; y0 = p.y - fh; } else if (nx === 1) { x0 = p.x + pw; y0 = p.y; } else { x0 = p.x - fw; y0 = p.y; }
  let v = 0;
  if (type === 'siege_tower') {
    // two wall pieces side by side under its front, the same height, a walkable wall walk where the ramp lands
    const fr = frontTiles({ tx: x0, ty: y0, fw, fh, rot });
    v = towerStoriesFor(game, fr);
    if (!v || fr.some(([x, y]) => towerStoriesFor(game, [x, y]) !== v)) return why(type + '@' + p.x + ',' + p.y, 'altura ' + fr.map(([x, y]) => towerStoriesFor(game, [x, y])).join('/'));
    if (fr.some(([x, y]) => !surfAt(game, v, x + 0.5, y + 0.5))) return why(type + '@' + p.x + ',' + p.y, 'sem adarve');
  }
  let k = Math.max(L, 2);
  while (k < 50 && Math.hypot(x0 + nx * k + fw / 2 - s.x, y0 + ny * k + fh / 2 - s.y) <= s.r + 1.5) k++;
  const fake = { id: '~lane' };
  for (let j = 0; j <= k; j++) {
    const tx = x0 + nx * j, ty = y0 + ny * j;
    { const r = placeReason(game, type, tx, ty, null, rot, fake, 0); if (r) return why(type + '@' + p.x + ',' + p.y, `passo ${j} ${tx},${ty}: ${r}`); }
    if (j && game.world.hasHeight && Math.abs(game.world.heightAt(tx + fw / 2, ty + fh / 2) - game.world.heightAt(tx - nx + fw / 2, ty - ny + fh / 2)) > 0.7) return why(type + '@' + p.x + ',' + p.y, `passo ${j}: íngreme`);
  }
  const sx = x0 + nx * k, sy = y0 + ny * k;
  { const r = planReason(game, type, sx, sy, rot); if (r) return why(type + '@' + p.x + ',' + p.y, 'início: ' + r); }
  return { tx: sx, ty: sy, rot, fw, fh, v, end: [x0, y0], steps: k };
}

// ---------- every force tick (0.5 s) ----------
export function siegeTick(game, F) {
  const G = F.sg, dt = WAR.tick;
  G.t += dt;
  if (!G.plan && F.phase !== 'retreat') {
    G.plan = plan(game, F);
    if (!G.plan) { if (++G.tries > 120) { setPhase(game, F, 'retreat'); } formationAt(game, F, F.anchor.x, F.anchor.y, F.face.x, F.face.y, 0); return; }
    const P = G.plan;
    F.face = { x: -P.A.x, y: -P.A.y }; F.fx = F.face.x; F.fy = F.face.y;
    G.ffV = flowSig(game, F); G.ffT = game.worldTime;
    P.ff.want(P.goals, G.ffV);
    F.ff = P.ff;
    adoptEngines(game, F);
  }
  const P = G.plan;
  // keep the flow field fresh when the structures change (a gate broken, a breach), at most every 2 s
  if (P && game.worldTime - G.ffT > 2) { const sg = flowSig(game, F); if (sg !== G.ffV) { G.ffV = sg; G.ffT = game.worldTime; P.ff.want(P.goals, sg); } }
  const ents = [...F.live.values()].filter((m) => !m.dead);
  switch (F.phase) {
    case 'march': {
      if (!P) break;
      const dx = P.camp.x - F.anchor.x, dy = P.camp.y - F.anchor.y, d = Math.hypot(dx, dy);
      if (d > 3) {
        const s = Math.min(d, WAR.speed.march * dt), lag = laggers(F);
        if (lag < 0.4) { F.anchor.x += (dx / d) * s; F.anchor.y += (dy / d) * s; }
        formationAt(game, F, F.anchor.x, F.anchor.y, dx / d, dy / d, 0, true);
      } else { setPhase(game, F, 'camp'); shout(game, F, `O exército do Reino de ${F.name} acampa diante de ${P.s.name}`); }
      break;
    }
    case 'camp': {
      formationAt(game, F, P.camp.x - P.A.x * 3, P.camp.y - P.A.y * 3, -P.A.x, -P.A.y, 0);
      raiseCamp(game, F, ents);
      if (G.campDone) setPhase(game, F, 'build');
      break;
    }
    case 'build': {
      formationAt(game, F, P.camp.x - P.A.x * 3, P.camp.y - P.A.y * 3, -P.A.x, -P.A.y, 0);
      buildEngines(game, F, ents);
      if (G.jobs.some((j) => j.role === 'treb' && j.done)) setPhase(game, F, 'bombard', `Os trabucos do Reino de ${F.name} começam o bombardeio de ${P.s.name}`);
      else if (!G.jobs.some((j) => j.role === 'treb') && G.jobs.filter((j) => j.role !== 'ws').every((j) => j.done || j.failed)) setPhase(game, F, 'assault');
      break;
    }
    case 'bombard': {
      formationAt(game, F, P.camp.x - P.A.x * 3, P.camp.y - P.A.y * 3, -P.A.x, -P.A.y, 0);
      buildEngines(game, F, ents);
      bombard(game, F, ents);
      const op = openingOnSide(game, F);
      const pushReady = G.jobs.some((j) => (j.role === 'ram' || j.role === 'tower') && j.done);
      if (op || (pushReady && F.t > 25) || F.t > WAR.siege.breachWait) setPhase(game, F, 'assault', op ? CRIES.breach : CRIES.charge);
      break;
    }
    case 'assault': {
      buildEngines(game, F, ents);
      bombard(game, F, ents);
      assault(game, F, ents);
      capture(game, F, ents);
      break;
    }
    case 'held': {
      // the place is theirs: to the plaza (the new garrison), then gone into the houses / the keep when nobody sees
      for (const m of ents) {
        m.job = null;
        if (F.t > WAR.siege.holdT) { if (m.order?.k !== 'flee') m.order = { k: 'flee', x: P.plaza.x + ((m.soldier.i % 7) - 3), y: P.plaza.y + (((m.soldier.i / 7) | 0) % 3), fx: 0, fy: 1 }; }
        else m.order = { k: 'flow', ff: P.ff, eng: 6, x: P.plaza.x, y: P.plaza.y };
      }
      if (F.t > WAR.siege.holdT + 40 || (F.t > WAR.siege.holdT && !ents.length)) { F.phase = 'end'; game.warfare.dematerialize?.(F.id); }
      break;
    }
    case 'retreat': {
      const bx = (P ? P.camp.x : F.anchor.x) + (P ? P.A.x : -F.face.x) * 40, by = (P ? P.camp.y : F.anchor.y) + (P ? P.A.y : -F.face.y) * 40;
      for (const m of ents) { m.job = null; if (m.order?.k !== 'flee') m.order = { k: 'flee', x: bx + ((m.soldier.i % 9) - 4) * 2, y: by + (((m.soldier.i / 9) | 0) % 4) * 2, fx: -(P ? P.A.x : 0), fy: -(P ? P.A.y : 0) }; }
      releaseEngines(game, F);
      if (F.t > 45 || !ents.length) { F.phase = 'end'; game.warfare.dematerialize?.(F.id); }
      break;
    }
  }
  // the end of the siege: heavy losses / morale broken / too long → retreat
  if (P && (F.phase === 'bombard' || F.phase === 'assault' || F.phase === 'build') && (F.dead >= F.n0 * WAR.siege.lossRetreat || F.morale < WAR.morale.routSiege || F.T > WAR.siege.maxT || F.n <= 2)) {
    setPhase(game, F, 'retreat', CRIES.rout);
    shout(game, F, `${P.s.name} resistiu! O exército do Reino de ${F.name} recua`);
    repelled(game, F);
  }
}
// what the way in depends on: the structures, the town's state (pieces destroyed), its gates open or shut
function flowSig(game, F) {
  const L = F.sg.plan?.L;
  let g = '';
  if (L) for (const k of L.gates) { const o = game.world.objById.get(`t${F.sg.sid}.${k}`); g += o ? (o.open ? 'o' : 'c') : 'x'; }
  return `${game.build.v}|${game.towns?.v || 0}|${g}`;
}
// how many are far behind their spots (the column waits for them)
function laggers(F) { let far = 0, c = 0; for (const m of F.live.values()) { if (m.dead || !m.order || m.order.k !== 'slot' || m.state === 'chase') continue; c++; if (Math.hypot(m.order.x - m.x, m.order.y - m.y) > 4) far++; } return c ? far / c : 0; }

// ---------- formations: lines at a spot (infantry in front, the archers behind, the general in the middle) ----------
// the soldiers with a job (engineers at work, crews, climbers) keep it
function formationAt(game, F, ax, ay, fx, fy, eng = 4, column = false, only = null) {
  F.anchor = { x: ax, y: ay }; F.face = { x: fx, y: fy };
  const rx = -fy, ry = fx, B = WAR.battle;
  const inf = [], arch = [], gen = [];
  for (const m of F.live.values()) {
    if (m.dead || m.job || (only && !only(m))) continue;
    const r = m.soldier.role;
    if (r === 'archer') arch.push(m); else if (r === 'general') gen.push(m); else if (r !== 'eng' || !F.sg?.plan || F.phase === 'march') inf.push(m); else inf.push(m);
  }
  const Wi = column ? 3 : Math.max(5, Math.min(14, Math.ceil(inf.length / 2))), Wa = column ? 3 : Math.max(4, Math.min(12, Math.ceil(arch.length / 2)));
  const rows = Math.ceil(inf.length / Wi);
  const put = (m, c, r, W, back, e) => {
    const x = ax + rx * (c - (W - 1) / 2) * B.lineW - fx * (back + r * B.rowD), y = ay + ry * (c - (W - 1) / 2) * B.lineW - fy * (back + r * B.rowD);
    const O = m.order && m.order.k === 'slot' ? m.order : (m.order = { k: 'slot' });
    O.x = x; O.y = y; O.fx = fx; O.fy = fy; O.eng = e; O.leash = 8; O.run = false;
  };
  inf.sort((a, b) => a.soldier.i - b.soldier.i).forEach((m, j) => put(m, j % Wi, Math.floor(j / Wi), Wi, 0, eng));
  const ab = rows * B.rowD + 2;
  arch.sort((a, b) => a.soldier.i - b.soldier.i).forEach((m, j) => put(m, j % Wa, Math.floor(j / Wa), Wa, ab, column ? 0 : Math.max(eng, 6)));
  gen.forEach((m) => put(m, 0, 0, 1, Math.max(1.5, ab - 1.2), 3));
}
function slotOf(F, u) {
  const P = F.sg.plan;
  if (!P) return [F.anchor.x - F.face.x * 6 + ((u.i % 7) - 3), F.anchor.y - F.face.y * 6];
  return [P.camp.x + P.A.x * 2 + ((u.i % 7) - 3) * 1.1, P.camp.y + P.A.y * 2 + (((u.i / 7) | 0) % 4) * 1.1];
}

// ---------- the camp ----------
function campSpots(P) {
  const out = [], { camp, A } = P, cr = WAR.siege.campR, tx = -A.y, ty = A.x;
  const rot = (th) => [A.x * Math.cos(th) - A.y * Math.sin(th), A.x * Math.sin(th) + A.y * Math.cos(th)];
  // tents in a crescent behind the middle (away from the walls), banners in front facing the place, fires between
  for (let k = 0; k < CAMP.tents; k++) { const [ux, uy] = rot(-1.15 + (k / Math.max(1, CAMP.tents - 1)) * 2.3); out.push(['war_tent', camp.x + ux * cr * 0.8, camp.y + uy * cr * 0.8]); }
  for (let k = 0; k < CAMP.banners; k++) out.push(['war_banner', camp.x - A.x * (cr - 1) + tx * (k - (CAMP.banners - 1) / 2) * 3.4, camp.y - A.y * (cr - 1) + ty * (k - (CAMP.banners - 1) / 2) * 3.4]);
  for (let k = 0; k < CAMP.fires; k++) out.push(['campfire', camp.x + tx * (k ? 2.6 : -2.6) - A.x * 1.4, camp.y + ty * (k ? 2.6 : -2.6) - A.y * 1.4]);
  return out;
}
// the engineers raise the camp: one walks to each spot, hammers a moment, and the piece stands
function raiseCamp(game, F, ents) {
  const G = F.sg, P = G.plan, spots = G.spots || (G.spots = campSpots(P));
  const engs = ents.filter((m) => m.soldier.role === 'eng');
  if (G.made >= spots.length) { G.campDone = true; for (const m of engs) if (m.job?.camp) m.job = null; return; }
  const [type, x, y] = spots[G.made];
  const m = engs[G.made % Math.max(1, engs.length)] || null;
  if (m && !(m.job?.camp && m.job.at === G.made)) m.job = campJob(x, y, G.made);
  G.campT = (G.campT || 0) + WAR.tick;
  const there = !m || Math.hypot(m.x - x, m.y - y) < 2.8;
  if (!(there && G.campT >= 0.6) && G.campT < 7) return;
  G.campT = 0; G.made++;
  const [fw, fh] = dimsOf(type, 0), q = spotFor(game, type, x - fw / 2, y - fh / 2, 0, 3);
  if (q) addStructures(game, F, [[type, q.tx, q.ty, q.rot, 1]], G.camp);
}
const campJob = (x, y, at) => {
  const f = (game, F, m, dt) => {
    const d = Math.hypot(x - m.x, y - m.y);
    if (d > 1.6) { const s = stepTo(game, m, x, y, WAR.speed.run, dt, 1.4); if (s === 'stuck') unstick(game, m, x, y); return true; }
    m.moving = false; m.facing = facingFrom(x - m.x, y - m.y, m.facing);
    if (!m.action) m.action = { type: 'build', t: 0, dur: 0.8 };
    return true;
  };
  f.camp = true; f.at = at;
  return f;
};
// host: structures of the army (complete or blueprints) — op struct.add + war.mark (o.realm = k)
function addStructures(game, F, rows, keep) {
  const list = [], ids = [];
  for (const [type, tx, ty, rot, done, v] of rows) {
    const id = game.net.newId('s');
    list.push([id, type, tx, ty, v | 0, done ? 1 : 0, Math.round(game.worldTime), rot | 0, 1, 0, '', '']);
    ids.push(id);
  }
  if (!list.length) return [];
  const bz = baseFor(game, rows[0][0], rows.map((r) => [r[1], r[2], r[3]]));
  game.net.emit('struct.add', bz != null ? { list, bz: Math.round(bz * 100) } : { list });
  game.net.emit('war.mark', { ids, k: F.k });
  if (keep) keep.push(...ids);
  return ids;
}

// ---------- building the engines (engineers hammering at real blueprints) ----------
function adoptEngines(game, F) {
  const G = F.sg, P = G.plan;
  G.jobs = P.jobs.map((j) => ({ ...j }));
  // (engines of this kingdom already standing there — a siege taken up again: 3a hands the army back)
  for (const j of G.jobs) {
    for (const o of game.build.structures) {
      if (o.type !== j.type || o.realm !== F.k || o.removed || Math.hypot(o.tx - j.tx, o.ty - j.ty) > 30) continue;
      if (G.jobs.some((q) => q.id === o.id)) continue;
      j.id = o.id; j.done = !o.blueprint; j.p = o.blueprint ? o.progress || 0 : 1; j.tx = o.tx; j.ty = o.ty;
      break;
    }
  }
}
function buildEngines(game, F, ents) {
  const G = F.sg, P = G.plan, engs = ents.filter((m) => m.soldier.role === 'eng');
  const ws = G.jobs.find((j) => j.role === 'ws');
  const open = G.jobs.filter((j) => !j.done && !j.failed && (j.role === 'ws' || ws?.done));
  // the engineers not operating / pushing: the jobs in order, two on the first, one on each other
  const free = engs.filter((m) => !m.job || m.job.build);
  for (const m of free) if (m.job?.build && (m.job.build.done || m.job.build.failed)) m.job = null;
  let k = 0;
  for (const j of open) {
    const n = k === 0 ? 2 : 1;
    for (let c = 0; c < n; c++) { const m = free.find((q) => !q.job); if (m) m.job = buildJob(j); }
    k++;
  }
  // progress: per engineer hammering at it
  for (const j of open) {
    const work = ents.filter((m) => m.job?.build === j && m._atJob).length;
    if (!work) continue;
    if (!j.id) {
      // the blueprint goes down (the player's rule: the workshop finished nearby for an engine)
      const why = placeReason(game, j.type, j.tx, j.ty, null, j.rot);
      if (why) { j.fails = (j.fails || 0) + 1; if (j.fails > 10) { j.failed = true; if (j.role === 'ws') setPhase(game, F, 'retreat'); } continue; }
      j.id = addStructures(game, F, [[j.type, j.tx, j.ty, j.rot, 0, j.v]], null)[0];
      continue;
    }
    const o = game.world.objById.get(j.id);
    if (!o || o.removed) { j.failed = true; continue; }
    if (!o.blueprint) { j.done = true; continue; }
    const T = (BUILDINGS[j.type].time || 10) * WAR.siege.buildK;
    j.p = Math.min(1, j.p + (WAR.tick * Math.min(2, work)) / T * (work > 1 ? 0.75 : 1));
    if (j.p >= 1) { game.net.emit('struct.complete', { id: j.id, by: 'npc', xp: 0, toast: '' }); j.done = true; if (j.role !== 'ws') shout(game, F, `${BUILDINGS[j.type].name} do Reino de ${F.name} pronto`, o.tx, o.ty); }
    else if (Math.floor(j.p * 8) !== Math.floor((j.p - (WAR.tick * work) / T) * 8)) game.net.emit('struct.progress', { id: j.id, p: +j.p.toFixed(3), by: 'npc' });
  }
}
function buildJob(j) {
  const f = (game, F, m, dt) => {
    if (j.done || j.failed) { m.job = null; m._atJob = false; return false; }
    const [fw, fh] = dimsOf(j.type, j.rot), cx = j.tx + fw / 2, cy = j.ty + fh / 2;
    // beside its footprint, the side toward the camp
    const P = F.sg.plan, sx = cx + P.A.x * (fh / 2 + 0.9) + ((m.soldier.i % 3) - 1) * 0.9, sy = cy + P.A.y * (fh / 2 + 0.9);
    const d = Math.hypot(sx - m.x, sy - m.y);
    if (d > 0.9) { m._atJob = false; const s = stepTo(game, m, sx, sy, WAR.speed.run, dt, 0.5); if (s === 'stuck') unstick(game, m, sx, sy); return true; }
    m._atJob = true; m.moving = false;
    m.facing = facingFrom(cx - m.x, cy - m.y, m.facing);
    if (!m.action) { m.action = { type: 'build', t: 0, dur: 0.85 }; game.later(0.3, () => { if (!m.dead && m.action?.type === 'build') game.audio?.play('build_hit', { x: m.x, y: m.y, volume: 0.4 }); }); }
    return true;
  };
  f.build = j;
  return f;
}

// ---------- the bombardment: an engineer on each trebuchet ----------
function bombard(game, F, ents) {
  const G = F.sg;
  for (const j of G.jobs) {
    if (j.role !== 'treb' || !j.done) continue;
    const o = game.world.objById.get(j.id);
    if (!isEngineObj(o)) { j.lost = true; continue; }
    let crew = j.crew && F.live.get(j.crew);
    if (!crew || crew.dead) {
      crew = ents.find((m) => m.soldier.role === 'eng' && (!m.job || m.job.build)) || null;
      if (!crew) continue;
      j.crew = crew.soldier.i;
      crew.job = operateJob(j);
    }
  }
}
// the next piece to throw at: the target, then the pieces beside it (a breach two pieces wide), then the rest of the side
function nextTarget(game, F, j) {
  const o = game.world.objById.get(j.target);
  if (o && !o.removed) return [o.tx + 0.5, o.ty + 0.5];
  const P = F.sg.plan, [tx, ty] = j.tgt;
  let best = null, bd = 1e9;
  for (const id of P.onSide) {
    const q = game.world.objById.get(id);
    if (!q || q.removed || isGate(game, q)) continue;
    const d = Math.hypot(q.tx + 0.5 - tx, q.ty + 0.5 - ty);
    if (d < bd) { bd = d; best = q; }
  }
  if (!best) return null;
  j.target = best.id; j.tgt = [best.tx + 0.5, best.ty + 0.5];
  return j.tgt;
}
function operateJob(j) {
  const f = (game, F, m, dt) => {
    const o = game.world.objById.get(j.id);
    if (!isEngineObj(o) || F.phase === 'retreat') { if (o?.user === '~' + m.nid) game.net.emit('siege.set', { id: o.id, user: 0 }); m.job = null; return false; }
    const me = '~' + m.nid, [px, py] = pivotOf(o), S = ARTY[o.type];
    const tgt = nextTarget(game, F, j);
    const want = tgt ? Math.atan2(tgt[1] - py, tgt[0] - px) : aimOf(o), dist = tgt ? Math.hypot(tgt[0] - px, tgt[1] - py) : S.range[1];
    const seat = seatSpot(game, o, aimOf(o)) || [px, py];
    if (o.user !== me) {
      const d = Math.hypot(seat[0] - m.x, seat[1] - m.y);
      if (d > 0.6) { const s = stepTo(game, m, seat[0], seat[1], WAR.speed.run, dt, 0.4); if (s === 'stuck') unstick(game, m, seat[0], seat[1]); return true; }
      if (o.user && o.user[0] !== '~') { m.moving = false; return true; } // (a player on it: it waits)
      game.net.emit('siege.set', { id: o.id, user: me });
      return true;
    }
    // at the winch, facing where it points; the frame turns at its speed (siege.set aim), then the shot (fireShot)
    m.x += (seat[0] - m.x) * Math.min(1, dt * 6); m.y += (seat[1] - m.y) * Math.min(1, dt * 6);
    m.moving = false;
    const cur = aimOf(o), diff = angDiff(want, cur);
    m.facing = facingFrom(Math.cos(cur), Math.sin(cur), m.facing);
    if (!tgt) return true;
    j.aimT = (j.aimT || 0) - dt;
    if ((Math.abs(diff) > 0.01 || Math.abs((o.dist || 0) - dist) > 0.3) && j.aimT <= 0) {
      j.aimT = 0.25;
      const na = cur + Math.max(-S.turn * 0.25, Math.min(S.turn * 0.25, diff));
      game.net.emit('siege.set', { id: o.id, aim: +na.toFixed(4), dist: +Math.max(S.range[0], Math.min(S.range[1], dist)).toFixed(2) });
      return true;
    }
    if (Math.abs(diff) <= 0.012 && !(o._reload > 0)) {
      const r = fireShot(game, o, cur, dist, me);
      if (r === undefined) { F.sg.shots++; m.action = { type: 'build', t: 0, dur: 0.6 }; }
    }
    return true;
  };
  f.op = j;
  return f;
}

// ---------- the assault ----------
function openingOnSide(game, F) {
  const P = F.sg.plan, [nx, ny] = P.side;
  return (game.townDefense?.openings(F.sg.sid) || []).find((o) => o.fx * nx + o.fy * ny > 0.5) || null;
}
function assault(game, F, ents) {
  const G = F.sg, P = G.plan, used = new Set();
  // the ram and the tower: their crews push (the host steps them: siege.js hostPush), the ram strikes, the tower docks
  for (const j of G.jobs) {
    if ((j.role !== 'ram' && j.role !== 'tower') || !j.done || j.over) continue;
    const o = game.world.objById.get(j.id);
    if (!isEngineObj(o)) { j.over = true; continue; }
    if (j.role === 'ram' && (!game.world.objById.get(j.target) || game.world.objById.get(j.target).removed)) {
      // the gate is down: the crew lets go and runs in
      if (!G.gateDown) { G.gateDown = true; shout(game, F, CRIES.gate, o.tx, o.ty); }
      game.net.emit('siege.set', { id: o.id, push: [] }); o._drive?.clear(); j.over = true;
      continue;
    }
    if (j.role === 'tower' && o.ramp) {
      if (!G.rampDown) { G.rampDown = true; shout(game, F, CRIES.tower, o.tx, o.ty); game.net.emit('siege.set', { id: o.id, push: [] }); o._drive?.clear(); }
      climbers(game, F, j, o, ents, used);
      continue;
    }
    const want = j.role === 'ram' ? 4 : 3, crew = (j.crewI || []).map((i) => F.live.get(i)).filter((m) => m && !m.dead);
    const cand = ents.filter((m) => !crew.includes(m) && !used.has(m) && !m.job?.op && !m.job?.push && !m.job?.climb && !m._climbed && m.z < 0.5 && m.soldier.role !== 'general' && m.soldier.role !== 'archer')
      .sort((a, b) => (a.soldier.role === 'eng' ? 0 : 1) - (b.soldier.role === 'eng' ? 0 : 1) || Math.hypot(a.x - o.x, a.y - o.y) - Math.hypot(b.x - o.x, b.y - o.y));
    while (crew.length < want && cand.length) crew.push(cand.shift());
    j.crewI = crew.map((m) => m.soldier.i);
    crew.forEach((m, k) => { used.add(m); if (m.job?.push !== j) m.job = pushJob(j, k); });
    const ids = [0, 0, 0, 0];
    crew.forEach((m, k) => { if (m._atSlot) ids[k] = '~' + m.nid; });
    const cur = (o.push || []).join('|'), nxt = ids.join('|');
    if (cur !== nxt && (ids.some(Boolean) || o.push)) game.net.emit('siege.set', { id: o.id, push: ids });
    const D = o._drive || (o._drive = new Map());
    D.clear();
    for (const q of ids) if (q) D.set(q, o.rot & 3); // (everyone pushes toward its front)
    // the ram at the gate: blows
    if (j.role === 'ram') {
      const touch = frontTiles(o).some(([x, y]) => { const q = game.build.grid.main.get(game.world.idx(x, y)); return q && isGate(game, q); });
      if (touch && ids.filter(Boolean).length) { D.clear(); ramBlow(game, o); }
    }
  }
  // everyone else: the archers to their line, the infantry through the openings (the flow field) or waiting at the
  // assembly point, the general rallying behind
  const [nx, ny] = P.side;
  const waiting = [];
  for (const m of ents) {
    if (used.has(m) || m.job) continue;
    const r = m.soldier.role;
    if (r === 'archer') { const sp = spread(P.archLine, P.side, m.soldier.i, 1.3); m.order = { k: 'slot', x: sp[0], y: sp[1], fx: -nx, fy: -ny, eng: WAR.archer.range * 1.2, rangeK: WAR.archer.wallBonus, leash: 6 }; continue; }
    if (r === 'general') { m.order = { k: 'slot', x: P.assembly.x + nx * 4, y: P.assembly.y + ny * 4, fx: -nx, fy: -ny, eng: 3 }; continue; }
    if (m.order?.k === 'flow' && P.ff.dist(m.x, m.y) < 65535) continue; // (already on its way in)
    if (P.ff.dist(m.x, m.y) < 65535 && P.ff.d) { m.order = { k: 'flow', ff: P.ff, eng: 8, x: P.plaza.x, y: P.plaza.y }; continue; }
    waiting.push(m);
  }
  // (the ones with no way in: in line at the assembly point, out of the archers' reach)
  waiting.sort((a, b) => a.soldier.i - b.soldier.i).forEach((m, j) => { const sp = spread(P.assembly, P.side, j, 1.15, 12); m.order = { k: 'slot', x: sp[0], y: sp[1], fx: -nx, fy: -ny, eng: 5, leash: 8 }; });
}
// spot j of a line at p along the wall of the side
function spread(p, side, j, w = 1.2, W = 14) {
  const [nx, ny] = side, tx = -ny, ty = nx, c = (j % W) - (W - 1) / 2, r = Math.floor(j / W);
  return [p.x + tx * c * w + nx * r * 1.3, p.y + ty * c * w + ny * r * 1.3];
}
function pushJob(j, k) {
  const f = (game, F, m, dt) => {
    const o = game.world.objById.get(j.id);
    if (!isEngineObj(o) || j.over) { m.job = null; m._atSlot = false; return false; }
    const [sx, sy] = toWorld(o, ...slotLocal(o, k));
    const d = Math.hypot(sx - m.x, sy - m.y);
    if (d > 0.5 && !m._atSlot) { const s = stepTo(game, m, sx, sy, WAR.speed.run, dt, 0.35); if (s === 'stuck') unstick(game, m, sx, sy); return true; }
    m._atSlot = true;
    // following the engine as it slides (like a player's pusher: siege.js push)
    m.x += (sx - m.x) * Math.min(1, dt * 8); m.y += (sy - m.y) * Math.min(1, dt * 8);
    m.moving = o._slT > 0.02;
    if (m.moving) m.moveT = (m.moveT || 0) + dt * 1.5;
    m.facing = facingFrom(Math.cos(frontAng(o)), Math.sin(frontAng(o)), m.facing);
    if (Math.hypot(sx - m.x, sy - m.y) > 2.5) m._atSlot = false;
    return true;
  };
  f.push = j;
  return f;
}
// up the tower: to its ladder, up (0.55 s a story, like a player), onto the deck, across the ramp onto the wall walk;
// on the wall: fight the defenders there, then down an inner stair and on to the plaza
function climbers(game, F, j, o, ents, used) {
  const G = F.sg, want = 10;
  const crew = (j.climbI || []).map((i) => F.live.get(i)).filter((m) => m && !m.dead && !m._climbed);
  for (const m of ents) {
    if (crew.length >= want) break;
    if (crew.includes(m) || used.has(m) || m.job || m._climbed || m.soldier.role === 'general' || m.soldier.role === 'archer' || m.soldier.role === 'eng') continue;
    if (m.order?.k === 'flow' && G.plan.ff.dist(m.x, m.y) < 400) continue; // (already inside / at a breach)
    crew.push(m);
  }
  j.climbI = crew.map((m) => m.soldier.i);
  for (const m of crew) { used.add(m); if (!m.job?.climb) m.job = climbJob(j); }
}
function climbJob(j) {
  const f = (game, F, m, dt) => {
    const o = game.world.objById.get(j.id), P = F.sg.plan;
    const T = m._climb || (m._climb = { st: 'ladder', t: 0 });
    if ((!isEngineObj(o) || !o.ramp) && T.st !== 'wall' && T.st !== 'down') { if (m.z > 0.3 && T.st !== 'wall') { m.z = 0; m.lv = 0; } m.job = null; m._climb = null; return false; }
    const n = o ? towerN(o) : 1;
    if (T.st === 'ladder') {
      const [lx, ly] = toWorld(o, ...ladderLocal(o), false);
      const d = Math.hypot(lx - m.x, ly - m.y);
      if (d > 0.5) { const s = stepTo(game, m, lx, ly, WAR.speed.run, dt, 0.35); if (s === 'stuck') unstick(game, m, lx, ly); return true; }
      // one at a time on the ladder
      if (o._ladderBy && o._ladderBy !== m && !o._ladderBy.dead && o._ladderBy._climb?.st === 'up') { m.moving = false; return true; }
      o._ladderBy = m; T.st = 'up'; T.t = 0; m.x = lx; m.y = ly;
      return true;
    }
    if (T.st === 'up') {
      T.t += dt; m.moving = true; m.moveT = (m.moveT || 0) + dt * 2;
      m.facing = facingFrom(Math.cos(frontAng(o)), Math.sin(frontAng(o)), m.facing);
      m.z = Math.min(n, (T.t / (PUSH.siege_tower.climb * n)) * n); m.lv = 0;
      if (T.t >= PUSH.siege_tower.climb * n) {
        const [dx, dy] = toWorld(o, ...deckLocal(o), false);
        m.x = dx; m.y = dy; m.lv = n; m.z = n; T.st = 'cross'; o._ladderBy = null;
        F.sg.climbed++;
      }
      return true;
    }
    if (T.st === 'cross') {
      // across the ramp onto the wall walk (forward from the deck)
      const a = frontAng(o), gx = toWorld(o, 0, (o.fh || 2) / 2 + 1.4, false);
      const s = stepTo(game, m, gx[0], gx[1], WAR.speed.walk, dt, 0.35);
      m.facing = facingFrom(Math.cos(a), Math.sin(a), m.facing);
      if (s === 'here' || s === 'stuck') { T.st = 'wall'; T.t = 0; F.sg.onWall++; }
      return true;
    }
    if (T.st === 'wall') {
      // on the wall walk: the defenders up here first (the brain fights them: order 'wall'), then to a stair head and down
      T.t += dt;
      const lv = m.lv | 0;
      const foes = (F.foes || []).filter((e) => !e.dead && Math.abs((e.z || 0) - lv) < 0.6 && Math.hypot(e.x - m.x, e.y - m.y) < 14);
      f.eng = 14;
      if (foes.length && T.t < 60) { const e = foes.sort((a, b) => Math.hypot(a.x - m.x, a.y - m.y) - Math.hypot(b.x - m.x, b.y - m.y))[0]; m.order = { k: 'wall', eng: 14, x: e.x, y: e.y }; m.foe = e; m.state = 'chase'; return false; }
      f.eng = 0;
      // a stair head of this story near (the archers' spots: hooks.archers), else here
      if (!T.down) {
        let best = null, bd = 16;
        for (const [x, y, l] of P.L.hooks.archers || []) { if ((l | 0) !== lv) continue; const d = Math.hypot(x - m.x, y - m.y); if (d < bd && surfAt(game, lv, x, y)) { bd = d; best = [x, y]; } }
        T.down = best || [m.x, m.y];
      }
      const s = stepTo(game, m, T.down[0], T.down[1], WAR.speed.walk, dt, 0.5);
      if (s === 'here' || s === 'stuck' || T.t > 40) { T.st = 'down'; T.t = 0; }
      return true;
    }
    if (T.st === 'down') {
      f.eng = 0;
      // down the inner stair (a moment), at its foot inside the walls
      T.t += dt; m.moving = true;
      const [nx, ny] = P.side;
      if (!T.foot) T.foot = solNear(game, m.x - nx * 2.2, m.y - ny * 2.2, 3) || solNear(game, m.x - nx * 4, m.y - ny * 4, 4) || [m.x, m.y];
      const k = Math.min(1, T.t / 1.3);
      m.z = Math.max(0, (m.lv | 0) * (1 - k));
      if (k >= 1) { m.x = T.foot[0]; m.y = T.foot[1]; m.z = 0; m.lv = 0; m.job = null; m._climb = null; m._climbed = true; m.order = { k: 'flow', ff: P.ff, eng: 8, x: P.plaza.x, y: P.plaza.y }; }
      return true;
    }
    return false;
  };
  f.climb = j;
  return f;
}

// ---------- the capture ----------
function capture(game, F, ents) {
  const G = F.sg, P = G.plan, cR = WAR.siege.captureR, dR = WAR.siege.defR;
  const at = ents.filter((m) => m.z < 0.5 && Math.hypot(m.x - P.plaza.x, m.y - P.plaza.y) < cR).length;
  let def = 0;
  const rec = game.people?.live?.get(G.sid);
  if (rec) for (const m of rec.ents.values()) if (!m.dead && m.npc.guard && Math.hypot(m.x - P.plaza.x, m.y - P.plaza.y) < dR) def++;
  G.capAt = at; G.capDef = def;
  if (at >= 2 && !def) G.capT += WAR.tick; else G.capT = Math.max(0, G.capT - WAR.tick * (def ? 2 : 1));
  if (G.capT >= WAR.siege.captureT) {
    const from = ownerOf(game, G.sid);
    G.captured = true;
    game.realms?.capture?.(G.sid, F.k);
    game.events.emit('wartaken', { sid: G.sid, from, to: F.k });
    setPhase(game, F, 'held');
    shout(game, F, `${P.s.name} foi tomada pelo Reino de ${F.name}!`, P.plaza.x, P.plaza.y);
    releaseEngines(game, F);
  }
}

// ---------- the end ----------
function releaseEngines(game, F) {
  for (const j of F.sg?.jobs || []) {
    const o = j.id ? game.world.objById.get(j.id) : null;
    if (!o || o.removed) continue;
    if (o.user && o.user[0] === '~') game.net.emit('siege.set', { id: o.id, user: 0 });
    if (o.push && o.push.some((q) => q && q[0] === '~')) game.net.emit('siege.set', { id: o.id, push: [] });
    o._drive?.clear();
  }
}
// the camp is struck and the engines left behind are dismantled (a force that ends near the players)
export function siegeEnd(game, F) {
  const G = F.sg;
  if (!G) return;
  releaseEngines(game, F);
  for (const id of [...(G.camp || []), ...G.jobs.map((j) => j.id).filter(Boolean)]) if (game.world.objById.has(id)) game.net.emit('struct.remove', { id, quiet: 1, fx: 'decon' });
}
// the side the army comes from (game.townDefense threat: the defense takes the walls of that side)
export function siegeThreat(game, F) {
  const P = F.sg?.plan;
  const ax = P ? P.A.x : F.sg ? F.sg.at[0] - game.towns.realm.settlements[F.sg.sid].x : 0, ay = P ? P.A.y : F.sg ? F.sg.at[1] - game.towns.realm.settlements[F.sg.sid].y : 1;
  const a = Math.atan2(ay, ax), sector = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8, sa = sector * (Math.PI / 4);
  return { fx: Math.cos(sa), fy: Math.sin(sa), sector, n: F.n, army: F.id };
}
// what the force has (3a's numbers): engines standing and finished
export function siegeReport(game, F) {
  const out = { treb: 0, cat: 0, ram: 0, tower: 0 };
  for (const j of F.sg?.jobs || []) { const o = j.id ? game.world.objById.get(j.id) : null; if (!o || o.removed || o.blueprint) continue; if (j.role === 'treb') out.treb++; else if (j.role === 'ram') out.ram++; else if (j.role === 'tower') out.tower++; }
  return out;
}
// tests / debug
export function siegeStatus(game, F) {
  const G = F.sg, P = G?.plan;
  if (!G) return null;
  return {
    planned: !!P, camp: P ? [r2(P.camp.x), r2(P.camp.y)] : null, side: P ? P.side : null, centre: P ? [r2(P.C.x), r2(P.C.y)] : null, assembly: P ? [r2(P.assembly.x), r2(P.assembly.y)] : null,
    plaza: P ? [r2(P.plaza.x), r2(P.plaza.y)] : null, campIds: (G.camp || []).slice(), shots: G.shots, gateDown: G.gateDown, rampDown: G.rampDown, climbed: G.climbed, onWall: G.onWall,
    capT: r2(G.capT), capAt: G.capAt || 0, capDef: G.capDef || 0, captured: !!G.captured, flowReady: !!P?.ff?.d,
    jobs: (G.jobs || []).map((j) => ({ type: j.type, role: j.role, id: j.id, tx: j.tx, ty: j.ty, rot: j.rot, v: j.v, p: r2(j.p || 0), done: !!j.done, failed: !!j.failed, target: j.target || null, end: j.end || null, crew: j.crew ?? null, crewI: j.crewI || [], climbI: j.climbI || [] })),
  };
}
export function siegeLoad() { /* (a saved siege is re-planned from its place and adopts the engines still standing: adoptEngines) */ }
void allPlayers; void inAnyView; void r2; void atWar; void DIR;
