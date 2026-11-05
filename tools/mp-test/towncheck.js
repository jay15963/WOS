// Settlement validator (docs/REINOS.md "Fase 2 — correções e desempenho"): every door of every building has a free tile
// right inside and right outside, and the game's own pathfinding (levels.findPath over nav.walkable — the collision the
// creatures and the phase-2 citizens use) reaches every bed, workplace and chest inside from the plaza; on walled places
// every stretch of the wall walk and every tower top is reached by its stairs. Two ways:
//   checkPrefabs(game, X, x, y)  every prefab × 4 rotations stamped on clear ground near (x, y) (then taken away)
//   checkTown(game, X, sid)      a settlement made in the world (its chunks loaded, its pieces placed)
// X = the frame's own modules (townMods). The doors are opened for the walk (a citizen opens them): their tiles are made
// free in world.solid for the check and put back. Pure test code: works on a solo frame (it touches the world).

const FRONT = [[0, 1], [-1, 0], [0, -1], [1, 0]]; // a prefab's front for R = 0..3 (S, W, N, E)
const imp = (f, p) => f.win.Function('u', 'return import(u)')(new URL('src/' + p, f.win.location.href).href);
export async function townMods(f) {
  const [nav, levels, physics, prefabs, layout, structs, data] = await Promise.all(['game/nav.js', 'game/levels.js', 'game/physics.js', 'world/realm/prefabs.js', 'world/realm/layout.js', 'game/mut/structures.js', 'game/data.js'].map((p) => imp(f, p)));
  return { nav, levels, physics, prefabs, layout, structs, data };
}

// what keeps tile (x, y) from being walked on the ground (null = free): the same rules as nav.walkable
export function blocker(game, x, y) {
  const w = game.world;
  if (!w.inBounds(x, y)) return 'fora';
  const i = w.idx(x, y);
  if (w.rock.get(i) === 1) return 'rocha';
  if (w.water.get(i) === 2 && !w.iceAt(i)) return 'água funda';
  if (w.height.isCliff(x, y)) return 'barranco';
  if (w.solid.get(i) === 1) { const o = game.build.grid.main.get(i); return o ? o.type : 'sólido'; }
  if (game.occ.get(i)) {
    let t = 'objeto';
    w.forChunks(x - 1, y - 1, x + 2, y + 2, (c) => { for (const o of c.objects) if (o._occ === i) t = o.type; });
    return t;
  }
  if (game.levels?.st[0]?.get(i)) return 'escada';
  return null;
}
const free = (game, x, y) => blocker(game, x, y) == null;

// open every closed door / gate in a rect for the walk (returns the undo)
function openDoors(game, x0, y0, x1, y1) {
  const w = game.world, back = [];
  for (const o of game.build.doors) {
    if (o.lv || o.removed || o.blueprint || o.open) continue;
    if (o.tx + (o.fw || 1) <= x0 || o.tx > x1 || o.ty + (o.fh || 1) <= y0 || o.ty > y1) continue;
    for (let y = o.ty; y < o.ty + (o.fh || 1); y++) for (let x = o.tx; x < o.tx + (o.fw || 1); x++) { const i = w.idx(x, y); back.push([i, w.solid.get(i)]); w.solid.set(i, 0); } // sync-ok: test only (put back right after)
  }
  return () => { for (const [i, v] of back) w.solid.set(i, v); }; // sync-ok: test only
}

// tiles a citizen can stand on to use a piece (beside its footprint, on its story)
function spotsOf(game, o) {
  const lv = o.lv | 0, L = game.levels, w = game.world, out = [];
  const fw = o.fw || 1, fh = o.fh || 1;
  for (let y = o.ty - 1; y <= o.ty + fh; y++) for (let x = o.tx - 1; x <= o.tx + fw; x++) {
    const inside = x >= o.tx && x < o.tx + fw && y >= o.ty && y < o.ty + fh, diag = (x < o.tx || x >= o.tx + fw) && (y < o.ty || y >= o.ty + fh);
    if (inside || diag) continue;
    if (lv ? L._walk(lv, x, y, false) : free(game, x, y)) out.push([x, y]);
    void w;
  }
  return out;
}
const near = (path, x, y, lv) => path && path.complete && (() => { const q = path.path[path.path.length - 1]; return q && Math.floor(q[0]) === x && Math.floor(q[1]) === y && (q[2] | 0) === lv; })();
// a complete path from tile a (level la) to one of the spots of piece o
function reach(game, a, la, o, budget = 6000) {
  const L = game.levels, lv = o.lv | 0;
  const S = spotsOf(game, o);
  if (!S.length) return { ok: false, why: 'sem lugar livre ao lado' };
  if (S.some(([x, y]) => x === a[0] && y === a[1] && lv === la)) return { ok: true };
  S.sort((p, q) => Math.hypot(p[0] - a[0], p[1] - a[1]) - Math.hypot(q[0] - a[0], q[1] - a[1]));
  for (const [x, y] of S.slice(0, 4)) {
    const r = L.findPath(a[0], a[1], la, x, y, lv, budget);
    if (near(r, x, y, lv)) return { ok: true, len: r.path.length };
  }
  return { ok: false, why: 'caminho não chega' };
}

// one building: its door (tile + outward direction), the pieces to reach (beds, work, chests), where the walk starts
// (null: the doorstep). Returns the problems (strings).
export function checkBuilding(game, b) {
  const out = [], [dx, dy] = b.door, [fx, fy] = b.dir, tag = b.tag;
  const ix = dx - fx, iy = dy - fy, ox = dx + fx, oy = dy + fy;
  const bi = blocker(game, ix, iy), bo = blocker(game, ox, oy);
  if (bi) out.push(`${tag}: porta ${dx},${dy} — o tile de dentro (${ix},${iy}) está ocupado (${bi})`);
  if (bo) out.push(`${tag}: porta ${dx},${dy} — o tile de fora (${ox},${oy}) está ocupado (${bo})`);
  if (bi || bo) return out;
  const L = game.levels;
  if (b.from) {
    const r = L.findPath(b.from[0], b.from[1], 0, ox, oy, 0, b.budget || 30000);
    if (!near(r, ox, oy, 0)) out.push(`${tag}: da praça / rua (${b.from}) não se chega à porta ${dx},${dy}`);
  }
  for (const o of b.targets) {
    const r = reach(game, [ox, oy], 0, o, o.lv ? 12000 : 6000);
    if (!r.ok) out.push(`${tag}: ${o.type}${o.lv ? ' (andar ' + o.lv + ')' : ''} em ${o.tx},${o.ty} — ${r.why} (da porta ${dx},${dy})`);
  }
  return out;
}

// ---------- prefabs × rotations ----------
// a clear rect (w × h tiles, every one walkable, nothing built) near (x, y): rings outward
function clearSite(game, x, y, w, h, avoid) {
  const G = game.build.grid, W = game.world;
  const ok = (x0, y0) => {
    for (let yy = y0; yy < y0 + h; yy++) for (let xx = x0; xx < x0 + w; xx++) {
      if (!free(game, xx, yy)) return false;
      const i = W.idx(xx, yy);
      if (G.main.has(i) || G.floor.has(i) || G.rug?.has(i) || G.roof?.has(i) || W.road?.get(i) || W.tileSlope(xx, yy) > 0.35) return false;
      if (avoid.some(([a, b, c, d]) => xx >= a && xx <= c && yy >= b && yy <= d)) return false;
    }
    return true;
  };
  for (let r = 0; r <= 110; r += 2) for (let k = 0; k < Math.max(1, r * 2); k++) {
    const a = (k / Math.max(1, r * 2)) * Math.PI * 2, x0 = Math.round(x + Math.cos(a) * r), y0 = Math.round(y + Math.sin(a) * r);
    if (!W.isLoaded(W.chunkIndex(x0, y0)) || !W.isLoaded(W.chunkIndex(x0 + w, y0 + h))) continue;
    if (ok(x0, y0)) return [x0, y0];
  }
  return null;
}
export function checkPrefabs(game, X, x, y, keys = null) {
  const { prefabs: PF, structs: MS } = X, problems = [], done = [];
  const avoid = [];
  let n = 0, id = 0;
  for (const key of keys || Object.keys(PF.PREFABS)) for (let R = 0; R < 4; R++) {
    const [lw, lh] = PF.lotOf(key, R);
    const site = clearSite(game, x, y, lw + 4, lh + 4, avoid);
    if (!site) { problems.push(`${key} R${R}: sem lugar livre para o teste`); continue; }
    const x0 = site[0] + 2, y0 = site[1] + 2;
    avoid.push([site[0], site[1], site[0] + lw + 3, site[1] + lh + 3]);
    const made = [];
    let b = null;
    game.net.withApply(() => {
      b = PF.stampPrefab(key, x0, y0, R, (type, tx, ty, rot, lv, style, det) => {
        const o = MS.placeStructure(game, type, tx, ty, { id: `fxp${++id}`, rot, lv, style, det, progress: 1, open: false, builtAt: 0 });
        made.push(o);
        return made.length - 1;
      });
    });
    game.levels.sync();
    const box = b.box, pick = (ks) => ks.map((k) => made[k]).filter(Boolean);
    const chests = made.filter((o) => o.type === 'chest');
    const targets = [...new Set([...pick(b.beds), ...pick(b.work), ...chests])];
    const undo = openDoors(game, box[0] - 1, box[1] - 1, box[2] + 1, box[3] + 1);
    try {
      if (!b.door) problems.push(`${key} R${R}: sem porta`);
      else problems.push(...checkBuilding(game, { tag: `${key} R${R}`, door: b.door, dir: FRONT[R & 3], targets, from: null }));
    } finally { undo(); }
    done.push(made);
    n++;
  }
  // take them away (upper stories first)
  game.net.withApply(() => { for (const made of done) for (const o of made.slice().reverse()) if (!o.removed) MS.removeStructure(game, o, { quiet: true }); });
  return { n, problems };
}

// ---------- every settlement of a seed, from its plan alone (no terrain, nothing placed) ----------
// The doors' inside / outside tiles against the plan's own pieces (what the layout puts in front of a door: lamps, wells,
// stairs, a neighbour's yard…) and the archer spots on a wall top. Cheap: all ~240 places of a seed in a few seconds.
export function checkLayout(L, X) {
  const B = X.data.BUILDINGS, out = [], at = new Map();
  for (const r of L.structs) {
    const [type, tx, ty, rot, lv] = r, def = B[type];
    if (!def || lv || def.roof || def.layer !== 'main') continue;
    const [fw, fh] = X.structs.dimsOf(type, X.structs.normRot(type, rot));
    for (let y = ty; y < ty + fh; y++) for (let x = tx; x < tx + fw; x++) { const k = x + ',' + y; let a = at.get(k); if (!a) at.set(k, (a = [])); a.push(type); }
  }
  const blocks = (x, y) => (at.get(x + ',' + y) || []).find((t) => { const d = B[t]; return d.block === 'tile' || d.block === 'stairs' || (d.block === 'door' && !d.gate2 && t !== 'door_wood') || (typeof d.block === 'number' && d.block > 0); }) || null;
  for (const b of L.buildings) {
    if (!b.door) { out.push(`${L.kind} ${L.sid} ${b.key}: sem porta`); continue; }
    const [fx, fy] = doorDir(b), [dx, dy] = b.door;
    const i = blocks(dx - fx, dy - fy), o = blocks(dx + fx, dy + fy);
    if (i) out.push(`${L.kind} ${L.sid} ${b.key} ${b.box[0]},${b.box[1]}: dentro da porta ${dx},${dy}: ${i}`);
    if (o) out.push(`${L.kind} ${L.sid} ${b.key} ${b.box[0]},${b.box[1]}: fora da porta ${dx},${dy}: ${o}`);
  }
  // archer spots: on the top of a wall / gate of the story below (story 2: a stone wall's upper course)
  const wallAt = new Set();
  for (const r of L.structs) { const d = B[r[0]]; if (d && d.connect === 'wall' && (d.block === 'tile' || d.block === 'door')) { const [fw, fh] = X.structs.dimsOf(r[0], X.structs.normRot(r[0], r[3])); for (let y = r[2]; y < r[2] + fh; y++) for (let x = r[1]; x < r[1] + fw; x++) wallAt.add(`${x},${y},${r[4]}`); } }
  for (const [x, y, lv] of L.hooks.archers) if (!wallAt.has(`${Math.floor(x)},${Math.floor(y)},${lv - 1}`)) out.push(`${L.kind} ${L.sid}: posto de arqueiro ${Math.floor(x)},${Math.floor(y)} (andar ${lv}) fora do topo da muralha`);
  return out;
}

// ---------- a settlement made in the world ----------
// the outward direction of a layout building's door (it is on the edge of its box)
export function doorDir(b) {
  const [x0, y0, x1, y1] = b.box, [x, y] = b.door;
  return y === y1 ? [0, 1] : y === y0 ? [0, -1] : x === x0 ? [-1, 0] : [1, 0];
}
// the nearest free ground tile to (x, y)
function freeNear(game, x, y, r = 6) {
  for (let d = 0; d <= r; d++) for (let yy = Math.floor(y) - d; yy <= Math.floor(y) + d; yy++) for (let xx = Math.floor(x) - d; xx <= Math.floor(x) + d; xx++) {
    if (Math.max(Math.abs(xx - Math.floor(x)), Math.abs(yy - Math.floor(y))) !== d) continue;
    if (free(game, xx, yy)) return [xx, yy];
  }
  return null;
}
// rec = game.towns.live.get(sid) (the placed pieces by layout index)
export function checkTown(game, X, sid, { walls = true } = {}) {
  const T = game.towns, L = T.layout(sid), rec = T.live.get(sid), problems = [];
  if (!rec) return { problems: [`lugar ${sid}: não está no mundo`], buildings: 0, targets: 0 };
  const objAt = (k) => rec.objs.get(k) || null;
  const [px, py] = L.plaza, from = freeNear(game, px, py);
  if (!from) problems.push(`lugar ${sid}: a praça (${px},${py}) não tem tile livre`);
  const A = (L.A || L.r) + 8;
  const undo = openDoors(game, L.x - A - 30, L.y - A - 30, L.x + A + 30, L.y + A + 30);
  let nb = 0, nt = 0, skipped = 0;
  try {
    game.levels.sync();
    for (const b of L.buildings) {
      if (!b.door) { problems.push(`${b.key} em ${b.box}: sem porta`); continue; }
      // (all of it placed here: its door and pieces)
      const dk = L.structs.findIndex((r, k) => r[0] === 'door_wood' && r[1] === b.door[0] && r[2] === b.door[1] && !r[4] && objAt(k));
      if (dk < 0) { skipped++; continue; }
      const inBox = (o) => o.tx >= b.box[0] && o.tx <= b.box[2] && o.ty >= b.box[1] && o.ty <= b.box[3];
      const targets = [...new Set([...b.beds, ...b.ws].map(objAt).filter(Boolean))];
      for (const o of rec.objs.values()) if (o.type === 'chest' && inBox(o) && !targets.includes(o)) targets.push(o);
      nb++; nt += targets.length;
      problems.push(...checkBuilding(game, { tag: `${b.key} ${b.box[0]},${b.box[1]}`, door: b.door, dir: doorDir(b), targets, from }));
    }
    // the mural: a free tile in front of it (south: its face), reached from the plaza
    const mu = L.mural >= 0 ? objAt(L.mural) : null;
    if (mu && from) {
      const front = [];
      for (let x = mu.tx; x < mu.tx + (mu.fw || 1); x++) if (free(game, x, mu.ty + 1)) front.push(x);
      const ok = front.some((x) => near(game.levels.findPath(from[0], from[1], 0, x, mu.ty + 1, 0, 20000), x, mu.ty + 1, 0) || (x === from[0] && mu.ty + 1 === from[1]));
      if (!ok) problems.push(`lugar ${sid}: o mural (${mu.tx},${mu.ty}) não tem lugar livre na frente que se alcance da praça (${front.length} livres)`);
    }
    // the wall walk: every archer spot (stairs ends, tower tops) and a sample of the wall tops, from the plaza
    if (walls && from && L.hooks.archers.length) {
      for (const [x, y, lv] of L.hooks.archers) {
        const tx = Math.floor(x), ty = Math.floor(y);
        if (!game.levels.isSurface(lv, game.world.idx(tx, ty))) { problems.push(`lugar ${sid}: posto de arqueiro ${tx},${ty} (andar ${lv}) não é chão de andar`); continue; }
        const r = game.levels.findPath(from[0], from[1], 0, tx, ty, lv, 40000);
        if (!near(r, tx, ty, lv)) problems.push(`lugar ${sid}: posto de arqueiro ${tx},${ty} (andar ${lv}) — a escada / o adarve não chega lá`);
      }
    }
  } finally { undo(); }
  return { problems, buildings: nb, targets: nt, skipped, total: L.buildings.length };
}
