// The defense of a settlement (docs/REINOS.md §11 "A defesa"): where the watch stands when the bell rings — the
// perimeter, not the plaza: archers up on the wall tops shooting outward, melee guards inside each gate and along the
// stretch of wall the attackers come at, crews at the ballistas, a small reserve by the keep (cities / castles) that
// hunts what got inside; civilians stay home. A destroyed piece of the wall line (wall / palisade / gate: the shared town
// state, mut/towns.js) is an OPENING: the nearest melee guards hold it (one in the gap, the others just inside) and the
// archers near it shoot what comes through first. An open village (no walls) forms up at its edge facing the threat and
// at its road entrances.
//
// Host only (game/people.js runs it), recomputed on events — the alarm starting / ending, a piece of the wall line
// destroyed / rebuilt, the attackers' side changing (8 sectors, with some hysteresis), a guard dying / coming back —
// never per frame. Phase 3 (armies besieging a place) reuses it: game.townDefense.perimeter / openings / threat / posts /
// assign (people.js installs it).

import { PEOPLE } from './content/people.js';
import { BUILDINGS } from './data.js';
import { npcPass, nearPass } from './townnav.js';
import { deadMap } from './mut/people.js';

const N = PEOPLE.def;
const KEY = (x, y) => x * 100003 + y;
const dist = (a, x, y) => Math.hypot(a.x - x, a.y - y);

// ---------- the wall line ----------
// the octagon of the plan (world/realm/layout.js buildWalls: half extent A, corners cut by C, around the rounded centre)
// and the pieces standing on it (story 0: walls, palisade logs, gates). inside(x, y): within the line (an open village:
// within its edge, the same octagon)
export function perimeterOf(S) {
  if (S._perim) return S._perim;
  const L = S.L, cx = Math.round(L.x), cy = Math.round(L.y), A = L.A || Math.max(6, Math.round(S.s.r) - 2), C = L.C || 0;
  const ring = new Set();
  const pts = [[A - C, -A], [A, -(A - C)], [A, A - C], [A - C, A], [-(A - C), A], [-A, A - C], [-A, -(A - C)], [-(A - C), -A]];
  for (let k = 0; k < 8; k++) {
    const [ax, ay] = pts[k], [bx, by] = pts[(k + 1) % 8];
    if (ax === bx || ay === by) { const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay)); for (let t = 0; t <= n; t++) ring.add(KEY(cx + ax + Math.sign(bx - ax) * t, cy + ay + Math.sign(by - ay) * t)); }
    else { const sx = Math.sign(bx - ax), sy = Math.sign(by - ay), n = Math.abs(bx - ax); for (let t = 0; t <= n; t++) { ring.add(KEY(cx + ax + sx * t, cy + ay + sy * t)); if (t < n) ring.add(KEY(cx + ax + sx * (t + 1), cy + ay + sy * t)); } }
  }
  // the outward normal of a tile of the line: the axis sides straight out, the cut corners diagonal
  const normal = (tx, ty) => { const ox = tx - cx, oy = ty - cy; if (Math.abs(ox) >= A && Math.abs(oy) <= A - C) return [Math.sign(ox), 0]; if (Math.abs(oy) >= A && Math.abs(ox) <= A - C) return [0, Math.sign(oy)]; return [Math.sign(ox) * 0.7071, Math.sign(oy) * 0.7071]; };
  const gates = new Set(L.gates), pieces = new Map();
  L.structs.forEach((row, k) => {
    if ((row[4] | 0) !== 0 || !ring.has(KEY(row[1], row[2]))) return;
    const def = BUILDINGS[row[0]];
    if (!def || def.connect !== 'wall') return;
    const gate = gates.has(k), vert = row[3] & 1, w = gate ? 2 : 1;
    const [fx, fy] = normal(row[1], row[2]);
    pieces.set(k, { k, id: `t${S.sid}.${k}`, x: row[1], y: row[2], cx: row[1] + (gate && !vert ? 1 : 0.5), cy: row[2] + (gate && vert ? 1 : 0.5), w, gate, fx, fy });
  });
  const ox = cx + 0.5, oy = cy + 0.5;
  S._perim = {
    cx: ox, cy: oy, A, C, ring, pieces, walled: pieces.size > 0,
    inside: (x, y, w = null) => { const dx = Math.abs(w ? w.dx(x, ox) : x - ox), dy = Math.abs(y - oy); return Math.max(dx, dy) < A - 0.5 && dx + dy < 2 * A - C - 0.5; },
  };
  return S._perim;
}

// ---------- openings: the gaps in the wall line ----------
// [{ id ('o' + the lowest piece index), ids (the pieces), x, y (the middle of the gap), fx, fy (outward), w (tiles), gate }]
// — neighbouring destroyed pieces (≤ 2 tiles apart) make one opening. Cached per change of the shared town state.
export function openings(game, S) {
  const T = game.towns, v = T?.v || 0;
  if (S._open && S._opV === v) return S._open;
  const per = perimeterOf(S), pre = `t${S.sid}.`, gone = [];
  if (per.walled && T?.state) for (const [id, r] of T.state) {
    if (!r.gone || !id.startsWith(pre)) continue;
    const P = per.pieces.get(+id.slice(pre.length));
    if (P && P.x === r.x && P.y === r.y) gone.push(P); // (a row kept by an older plan is not this piece)
  }
  gone.sort((a, b) => a.k - b.k);
  const out = [], used = new Set();
  for (const P of gone) {
    if (used.has(P)) continue;
    const grp = [P];
    used.add(P);
    for (let i = 0; i < grp.length; i++) for (const Q of gone) if (!used.has(Q) && Math.max(Math.abs(Q.x - grp[i].x), Math.abs(Q.y - grp[i].y)) <= 2) { used.add(Q); grp.push(Q); }
    let sx = 0, sy = 0, nx = 0, ny = 0, w = 0, gate = false;
    for (const Q of grp) { sx += Q.cx * Q.w; sy += Q.cy * Q.w; nx += Q.fx; ny += Q.fy; w += Q.w; gate = gate || Q.gate; }
    const nl = Math.hypot(nx, ny) || 1;
    out.push({ id: 'o' + P.k, ids: grp.map((q) => q.id), x: sx / w, y: sy / w, fx: nx / nl, fy: ny / nl, w, gate });
  }
  S._open = out; S._opV = v;
  return out;
}

// ---------- the threat: from where the attackers come ----------
// foes: the hostiles near the place (people.js dangerOf); the ones outside the line give the side (a unit vector and its
// sector 0..7); prev: the last threat (the side only changes when it moved well past the sector's edge)
export function threatOf(game, S, foes, prev = null) {
  const per = perimeterOf(S), w = game.world;
  let sx = 0, sy = 0, n = 0;
  for (const e of foes) {
    if (per.inside(e.x, e.y, w)) continue;
    const dx = w.dx(e.x, per.cx), dy = e.y - per.cy, d = Math.hypot(dx, dy) || 1;
    sx += dx / d; sy += dy / d; n++;
  }
  if (!n || Math.hypot(sx, sy) < 0.05 * n) return n ? (prev || null) : null; // (from all sides at once: keep the last)
  const a = Math.atan2(sy, sx);
  let sector = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;
  if (prev) { const pa = prev.sector * (Math.PI / 4), dd = Math.abs(Math.atan2(Math.sin(a - pa), Math.cos(a - pa))); if (dd < Math.PI / 8 + 0.35) sector = prev.sector; }
  const sa = sector * (Math.PI / 4);
  return { fx: Math.cos(sa), fy: Math.sin(sa), sector, n };
}

// ---------- where each guard stands ----------
// a spot of a gap: the first holder in the gap itself (an alarm), the others just inside it, side by side
function gapSpot(game, o, j, danger) {
  const tx = -o.fy, ty = o.fx, inn = danger && j === 0 ? 0 : 1.15, side = danger ? (j === 0 ? 0 : (j & 1 ? 1 : -1) * Math.ceil(j / 2) * 0.85) : (j - 0) * 0.85;
  return spot(game, o.x - o.fx * inn + tx * side, o.y - o.fy * inn + ty * side, 2);
}
// a free spot (the tile itself, else the nearest open one around it)
function spot(game, x, y, r = 2) {
  if (npcPass(game, Math.floor(x), Math.floor(y))) return [x, y];
  return nearPass(game, x, y, r) || [x, y];
}
// a wall top beside a taken one (more archers than spots): the next tile along the wall when it is a walkable top
function besideOnWall(game, d, k) {
  if (!k) return d;
  const lev = game.levels?.sync?.(), tx = -d.fy, ty = d.fx, off = (k & 1 ? 1 : -1) * Math.ceil(k / 2);
  const x = d.x + Math.round(tx) * off, y = d.y + Math.round(ty) * off;
  const ok = lev?.surf?.[d.lv]?.get(game.world.idx(Math.floor(x), Math.floor(y))) === 1;
  return ok ? { ...d, x, y } : d;
}

// the posts of the watch now: Map person index → duty { k: 'gap' | 'gate' | 'stretch' | 'reserve' | 'wall' | 'crew', x, y,
// fx, fy (facing out), lv, r (how far from it a foe is fought; 0: only the foes inside it hunts), op (the opening held),
// focus (archers: the gap they cover) }. danger false: only the gaps are held (one guard each, just inside).
// rec (optional): the creatures out now — the nearest ones are picked by where they stand
export function assignDefense(game, S, rec, ops, th, danger) {
  const D = deadMap(game), alive = (P) => !D.has(`${S.sid}.${P.i}`), per = perimeterOf(S);
  const posts = new Map();
  const melee = S.persons.filter((P) => P.job === 'guard' && alive(P)), archers = S.persons.filter((P) => P.job === 'archer' && alive(P));
  const where = (P) => { const m = rec?.ents.get(P.i); if (m && !m.dead) return m; const d = P.dutyNight?.x != null ? P.dutyNight : P.dutyDay?.x != null ? P.dutyDay : null; return d || S.plaza; };
  const free = new Set(melee);
  const take = (x, y, n) => { const L = [...free].sort((a, b) => dist(where(a), x, y) - dist(where(b), x, y)).slice(0, Math.max(0, n)); for (const P of L) free.delete(P); return L; };
  const al = (fx, fy) => (th ? fx * th.fx + fy * th.fy : 0);
  const HR = N.holdR;
  // 1. the gaps (the side of the attackers first): the nearest melee guards
  let budget = danger ? Math.max(1, Math.ceil(melee.length * 0.6)) : melee.length;
  for (const o of ops.slice().sort((a, b) => al(b.fx, b.fy) - al(a.fx, a.fy))) {
    const n = Math.min(budget, danger ? (o.w >= 3 || o.gate ? N.gapWide : N.gap) : N.gapCalm);
    const L = take(o.x, o.y, n);
    budget -= L.length;
    L.forEach((P, j) => { const q = gapSpot(game, o, j, danger); posts.set(P.i, { k: 'gap', x: q[0], y: q[1], fx: o.fx, fy: o.fy, lv: 0, r: HR.gap, op: o.id }); });
  }
  if (!danger) return { posts, ops, th: null, danger: false };
  // 2. the reserve by the keep (cities, castles): it hunts what got inside the walls
  const keep = S.homes.find((h) => h.rec.key === 'keep'), rk = N.reserve[S.kind] || 0;
  if (keep && rk > 0 && free.size) {
    take(keep.out[0], keep.out[1], Math.max(1, Math.round(melee.length * rk))).forEach((P, j) => {
      const q = spot(game, keep.out[0] + ((j % 3) - 1) * 0.9, keep.out[1] + (Math.floor(j / 3) % 2) * 0.9, 2);
      posts.set(P.i, { k: 'reserve', x: q[0], y: q[1], fx: 0, fy: 0, lv: 0, r: HR.reserve });
    });
  }
  // 3. the gates (inside each one): with the attack from one side (owner: "os soldados não estão focados apenas em uma parte
  // da muralha que é de onde estão vindo o inimigo") the gates facing it get two guards; the others keep one only when the
  // watch is big enough for it (else they stand on the side under attack — the gates are shut and the dead are not there)
  const G = S.posts.gates.slice().sort((a, b) => al(b.fx, b.fy) - al(a.fx, a.fy));
  const backGates = !th || melee.length >= 2 * G.length + 3;
  for (const g of G) { if (!free.size) break; if (th && al(g.fx, g.fy) < N.front && !backGates) continue; take(g.x, g.y, 1).forEach((P) => posts.set(P.i, { k: 'gate', x: g.x, y: g.y, fx: g.fx, fy: g.fy, lv: 0, r: HR.gate })); }
  for (const g of G) {
    if (!free.size || !th || al(g.fx, g.fy) < 0.5) continue;
    const q = spot(game, g.x - g.fy * 1.1, g.y + g.fx * 1.1, 2);
    take(g.x, g.y, 1).forEach((P) => posts.set(P.i, { k: 'gate', x: q[0], y: q[1], fx: g.fx, fy: g.fy, lv: 0, r: HR.gate }));
  }
  // 4. the ballistas (facing the attackers first), at most a share of the melee guards
  const dirOf = (c) => { const dx = c.x - per.cx, dy = c.y - per.cy, d = Math.hypot(dx, dy) || 1; return al(dx / d, dy / d); };
  const crews = S.posts.crews.slice().sort((a, b) => dirOf(b) - dirOf(a));
  const nc = Math.min(crews.length, Math.max(crews.length ? 1 : 0, Math.floor(melee.length * N.crews)));
  for (let k = 0; k < nc && free.size; k++) take(crews[k].x, crews[k].y, 1).forEach((P) => posts.set(P.i, { ...crews[k] }));
  // 5. the stretch of wall the attackers come at (walled: just inside the line; an open village: its edge) — the others
  const pts = stretchPoints(game, S, per, th);
  for (let j = 0; free.size && pts.length; j++) {
    const p = pts[j % pts.length];
    take(p.x, p.y, 1).forEach((P) => { const q = j < pts.length ? [p.x, p.y] : spot(game, p.x - p.fy * 0.9 * Math.ceil(j / pts.length), p.y + p.fx * 0.9 * Math.ceil(j / pts.length), 2); posts.set(P.i, { k: 'stretch', x: q[0], y: q[1], fx: p.fx, fy: p.fy, lv: 0, r: HR.stretch }); });
  }
  // archers: with the attack from one side, all of them along the wall walk around where it hits (spread a few tiles
  // apart, the nearest to it first — the walk: wallWalk); else the wall tops facing the attackers (the spots by a gap
  // first); an open village: behind its line
  const W = S.posts.walls.filter((w) => !ops.some((o) => Math.hypot(o.x - w.x, o.y - w.y) < 1 + o.w / 2)); // (never on a piece that is gone)
  const hit = th && per.walled ? { x: per.cx + th.fx * per.A, y: per.cy + th.fy * per.A } : null;
  const front = hit ? frontSpots(game, S, per, th, hit, archers.length, ops) : [];
  if (front.length) {
    const gapBy = (w) => ops.find((o) => Math.hypot(o.x - w.x, o.y - w.y) < 12) || null;
    archers.forEach((P, k) => { const c = front[k % front.length], o = gapBy(c); posts.set(P.i, { k: 'wall', x: c.x, y: c.y, fx: c.fx, fy: c.fy, lv: c.lv, focus: o ? { x: o.x, y: o.y } : { x: hit.x, y: hit.y } }); });
  } else if (W.length) {
    const gapBy = (w) => ops.find((o) => Math.hypot(o.x - w.x, o.y - w.y) < 12) || null;
    const sc = (w) => al(w.fx, w.fy) + (gapBy(w) ? 2 : 0);
    const order = W.slice().sort((a, b) => sc(b) - sc(a)), seen = new Map();
    archers.forEach((P, k) => {
      const w0 = order[k % order.length], n = seen.get(w0) || 0;
      seen.set(w0, n + 1);
      const w = besideOnWall(game, w0, n), o = gapBy(w0);
      posts.set(P.i, { ...w, k: 'wall', focus: o ? { x: o.x, y: o.y } : null });
    });
  } else {
    archers.forEach((P, k) => {
      const p = pts[k % Math.max(1, pts.length)] || { x: S.plaza.x, y: S.plaza.y, fx: 0, fy: 1 };
      const q = spot(game, p.x - p.fx * 2.5 + p.fy * (k & 1 ? 1 : -1), p.y - p.fy * 2.5 - p.fx * (k & 1 ? 1 : -1), 3);
      posts.set(P.i, { k: 'stretch', x: q[0], y: q[1], fx: p.fx, fy: p.fy, lv: 0, r: HR.stretch + 4 });
    });
  }
  return { posts, ops, th, danger: true };
}
// the line where the melee guards stand along the walls: walled — the patrol loop just inside the walls, the side of the
// attackers first (the back half left out when they come from one side); open — points of the edge around the threat
function stretchPoints(game, S, per, th) {
  const out = [], P = S.posts.patrol;
  if (per.walled || !th) {
    for (const [x, y] of P) { const dx = x - per.cx, dy = y - per.cy, d = Math.hypot(dx, dy) || 1; out.push({ x, y, fx: dx / d, fy: dy / d }); }
    if (th) {
      // the side under attack: the patrol points facing it (an arc of ~120°), the nearest to where it hits first; a wider
      // arc only when that side has too few
      out.sort((a, b) => (b.fx * th.fx + b.fy * th.fy) - (a.fx * th.fx + a.fy * th.fy));
      for (const lim of [N.front, 0, -0.2]) { const front = out.filter((p) => p.fx * th.fx + p.fy * th.fy > lim); if (front.length >= 2 || (lim === -0.2 && front.length)) return front.map((p) => ({ ...p, ...xy(spot(game, p.x, p.y, 2)) })); }
    }
    return out.map((p) => ({ ...p, ...xy(spot(game, p.x, p.y, 2)) }));
  }
  const a0 = Math.atan2(th.fy, th.fx), R = per.A - 1;
  for (const da of [0, 0.3, -0.3, 0.6, -0.6]) { const a = a0 + da, fx = Math.cos(a), fy = Math.sin(a); out.push({ ...xy(spot(game, per.cx + fx * R, per.cy + fy * R, 3)), fx, fy }); } // (a tighter fan: the side under attack)
  return out;
}
const xy = (q) => ({ x: q[0], y: q[1] });

// ---------- the wall walk ----------
// the walkable tops of a place's wall line (levels.surf at story 1 — a palisade — or 2 — the stone walk): the pieces of the
// line and the tile just inside each, and the archer posts (tower tops, stair heads); cached per change of the town state
// (a piece gone cuts the walk) and of the levels map. The archers stand anywhere on it (game/npc.js walks them along it)
export function wallWalk(game, S) {
  const lev = game.levels?.sync?.(), v = (game.towns?.v || 0) + ':' + (game.levels?.v || 0);
  if (S._walk && S._walkV === v) return S._walk;
  const per = perimeterOf(S), w = game.world, at = new Map(), list = [];
  const add = (x, y, lv) => { const k = x + ',' + y; if (at.has(k)) return; const dx = x + 0.5 - per.cx, dy = y + 0.5 - per.cy, d = Math.hypot(dx, dy) || 1; const s = { x: x + 0.5, y: y + 0.5, lv, tx: x, ty: y, k, fx: dx / d, fy: dy / d }; at.set(k, s); list.push(s); };
  if (lev && per.walled) for (const q of per.pieces.values()) {
    const n = q.gate ? 2 : 1, vert = q.gate && Math.abs(q.fx) > 0.5;
    for (let j = 0; j < n; j++) {
      const x0 = q.x + (vert ? 0 : j), y0 = q.y + (vert ? j : 0);
      for (const [x, y] of [[x0, y0], [x0 - Math.round(q.fx), y0 - Math.round(q.fy)]]) for (const lv of [1, 2]) if (lev.surf[lv]?.get(w.idx(x, y)) === 1) { add(x, y, lv); break; }
    }
  }
  for (const p of S.posts.walls) if ((p.lv | 0) > 0) add(Math.floor(p.x), Math.floor(p.y), p.lv | 0);
  S._walk = { at, list }; S._walkV = v;
  return S._walk;
}
// n spots of the wall walk on the side under attack, around where it hits (the nearest first), ~2.5 tiles apart (closer
// when the side is short of them)
function frontSpots(game, S, per, th, hit, n, ops) {
  if (!n) return [];
  const W = wallWalk(game, S).list.filter((c) => c.fx * th.fx + c.fy * th.fy > N.front && !ops.some((o) => Math.hypot(o.x - c.x, o.y - c.y) < 0.8 + o.w / 2));
  W.sort((a, b) => Math.hypot(a.x - hit.x, a.y - hit.y) - Math.hypot(b.x - hit.x, b.y - hit.y));
  for (const gapT of [2.5, 1.5, 0.9]) {
    const out = [];
    for (const c of W) { if (out.length >= n) break; if (out.every((q) => Math.hypot(q.x - c.x, q.y - c.y) >= gapT)) out.push(c); }
    if (out.length >= n || gapT === 0.9) return out;
  }
  return [];
}
