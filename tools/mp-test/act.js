// Player actions and world queries for the tests, built on the game's own player-facing APIs (controller goals,
// work handlers, build mode, abilities, combat rolls, UI panels) so they keep working when those APIs start
// routing through game.net (intents → host → ops). Modules are imported INSIDE each frame's realm, so the
// harness talks to the very same module instances the running game uses.

import { CFG, Fail, now, short } from './harness.js';

// ---------------- frame modules ----------------
const PATHS = {
  gathering: 'game/gathering.js', building: 'game/building.js', mining: 'game/mining.js', farming: 'game/farming.js',
  combat: 'game/combat.js', abilities: 'game/abilities.js', physics: 'game/physics.js', nav: 'game/nav.js',
  player: 'game/player.js', save: 'game/save.js', loot: 'game/loot.js', flora: 'game/flora.js', ai: 'game/ai.js',
  equipment: 'game/equipment.js', data: 'game/data.js', autotile: 'game/autotile.js', items: 'game/content/items.js',
  worldgen: 'world/worldgen.js', stats: 'game/stats.js',
};
const CACHE = new WeakMap();
export async function mods(f) {
  const w = f.win;
  if (!w) throw new Fail(`${f.label}: frame has no window`);
  let c = CACHE.get(w);
  if (c) return c;
  const imp = w.Function('u', 'return import(u)');
  const base = new URL('src/', w.location.href);
  const entries = await Promise.all(Object.entries(PATHS).map(async ([k, p]) => {
    try { return [k, await imp(new URL(p, base).href)]; } catch (e) { return [k, { __error: e.message }]; }
  }));
  c = Object.fromEntries(entries);
  CACHE.set(w, c);
  return c;
}

// ---------------- basics ----------------
export const P = (f) => f.game.player;
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const count = (f, id) => f.game.player.inv.count(id);

export function teleport(f, x, y) {
  const g = f.game, p = g.player;
  p.x = x; p.y = y;
  p.moving = false; p.autoMove = null; p.work = null; p.action = null;
  if (g.ctl) g.ctl.goal = null;
  if (p.nav) { p.nav.path = null; p.nav.fails = 0; }
  g.cam.x = x; g.cam.y = y - 0.4;
}

// walkable point near (x, y): rings from rMin to rMax, angles closest to `prefer` (radians) first
export function freeSpot(f, M, x, y, { rMin = 0.6, rMax = 1.4, prefer = 0, r = 0.27, avoid = null } = {}) {
  const w = f.game.world;
  const angles = [];
  for (let k = 0; k < 24; k++) angles.push((k / 24) * Math.PI * 2);
  const ad = (a) => { const d = Math.abs(((a - prefer) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI); return d; };
  angles.sort((a, b) => ad(a) - ad(b));
  const radii = rMin <= 0 ? [0] : [];
  for (let rr = Math.max(rMin, 0.15); rr <= rMax + 1e-6; rr += 0.15) radii.push(rr);
  for (const rr of radii) {
    for (const a of rr === 0 ? [0] : angles) {
      const cx = x + Math.cos(a) * rr, cy = y + Math.sin(a) * rr;
      const tx = Math.floor(cx), ty = Math.floor(cy);
      if (!w.inBounds(tx, ty) || w.waterAt(tx, ty) === 2) continue;
      if (M.physics.collides(w, cx, cy, r, null, true)) continue;
      if (avoid && avoid(cx, cy)) continue;
      return [cx, cy];
    }
  }
  return null;
}

// straight walkable line (player radius) from a to b
export function clearLine(f, M, x0, y0, x1, y1, r = 0.3) {
  const w = f.game.world, L = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(L / 0.2);
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
    if (M.physics.collides(w, x, y, r, null, true) || w.waterAt(Math.floor(x), Math.floor(y))) return false;
  }
  return true;
}

// Holds a movement direction on the frame's input (the game's own movement + collision code moves the player)
export function holdMove(f, dx, dy) {
  const inp = f.game.input;
  inp.move = () => [dx, dy];
  return () => { delete inp.move; };
}

export function ensure(f, items) {
  const p = f.game.player;
  for (const id in items) { const have = p.inv.count(id); if (have < items[id]) p.inv.add(id, items[id] - have); }
  f.game.events.emit('inventory', {});
}
export function invSnap(f) {
  const out = {};
  for (const s of f.game.player.inv.slots) if (s) out[s.id] = (out[s.id] || 0) + s.qty;
  return out;
}
export function invDiff(a, b) {
  const out = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = (b[k] || 0) - (a[k] || 0); if (d) out[k] = d; }
  return out;
}
export function equip(f, id) {
  const g = f.game, p = g.player;
  if (p.equip.main === id || p.equip.off === id || p.equip.body === id || p.equip.head === id) return true;
  if (!p.inv.count(id)) p.inv.add(id, 1);
  return g.econ.equipItem(id);
}

// keeps a player alive and fed while a scenario runs (owner-local state)
export function keepAlive(t, f, { hp = true } = {}) {
  t.watch(() => {
    const p = f.game?.player;
    if (!p || p.dead) return;
    if (hp) p.hp = p.maxHp;
    p.hunger = Math.max(p.hunger ?? 100, 80);
    p.energy = Math.max(p.energy ?? 0, (p.maxEnergy ?? 100) * 0.6);
  }, 60);
}

// both players alive, idle, auto-work paused, near the spawn
export async function reset(t, H, MH, G, MG) {
  for (const [f, M] of [[H, MH], [G, MG]]) {
    if (!f) continue;
    const g = f.game, p = g.player;
    f.hookUi();
    if (p.dead) { try { M.player.respawnPlayer(g); } catch { /* ignore */ } }
    try { M.building.exitBuildMode(g); } catch { /* ignore */ }
    if (g.mining) g.mining.mode = false;
    if (g.work) g.work.paused = true;
    p.hp = p.maxHp; p.energy = p.maxEnergy; p.hunger = Math.max(p.hunger ?? 100, 80);
    p.target = null; p.autoAttack = false; p.work = null; p.action = null; p.combatT = 0;
    if (g.ctl) g.ctl.goal = null;
    delete g.input.move;
    try { g.events.emit('closepanels', {}); } catch { /* ignore */ }
  }
  const sp = H.game.world.spawn;
  pacify(H, sp.x, sp.y, 24, 90); // the spawn ring holds only passive animals; strays from earlier scenarios calm down
  const a = freeSpot(H, MH, sp.x, sp.y, { rMin: 0, rMax: 4 });
  if (a) teleport(H, a[0], a[1]);
  if (G) {
    const b = freeSpot(G, MG, sp.x + 2.5, sp.y, { rMin: 0, rMax: 4 });
    if (b) teleport(G, b[0], b[1]);
  }
  await t.sleep(300); // presence catches up
}

// ---------------- world queries ----------------
export const isTree = (o) => !!o?.type?.startsWith?.('tree_');
export const standingTree = (o) => isTree(o) && !o.stump && !(o.fall > 0) && !o.gone && (o.age ?? 1) >= 0.9;
export const objOn = (f, id) => f.game.world.objById.get(id) || null;
export const structOn = (f, id) => f.game.build.structures.find((o) => o.id === id) || null;

// world objects on A that also exist (same id, same predicate) on B, nearest to (x, y) first
export function shared(A, B, x, y, r, pred, claimed = null) {
  const out = A.game.world.query(x, y, r, (o) => pred(o) && !(claimed && claimed.has(o.id)));
  return out.filter((o) => { const q = B ? objOn(B, o.id) : o; return q && pred(q); })
    .sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
}

// a tree with free standing room on both sides (for one or two choppers)
export function pickTree(A, MA, B, x, y, claimed, { r = 40, sides = 1, maxS = 1.15 } = {}) {
  for (const o of shared(A, B, x, y, r, standingTree, claimed)) {
    if ((o.s || 1) > maxS) continue;
    const w = freeSpot(A, MA, o.x, o.y, { rMin: 0.7, rMax: 0.9, prefer: Math.PI });
    const e = freeSpot(A, MA, o.x, o.y, { rMin: 0.7, rMax: 0.9, prefer: 0 });
    if (!w || (sides > 1 && (!e || Math.hypot(e[0] - w[0], e[1] - w[1]) < 1))) continue;
    claimed?.add(o.id);
    return { o, west: w, east: e };
  }
  return null;
}

export function mobs(f, pred = () => true) { return f.game.entities.filter((e) => e.isMob && pred(e)); }
export function hostMobs(H, pred = () => true) { return mobs(H, (e) => !e.proxy && !e.dead && pred(e)); }
export function nidOf(m) { return m?.nid ?? null; }
export function proxyOf(G, m) {
  const nid = nidOf(m);
  if (nid == null) return null;
  return G.game.entities.find((e) => e.nid === nid) || G.net?.entsApi?.byNid?.(nid) || null;
}
// the drawn (interpolated) copy of player `pid` on frame f (remote players live in session.players)
export function avatarOn(f, pid) { return f.session?.players?.get?.(pid)?.ent || null; }
// host side: the authoritative avatar (latest received position; what AI / intent validation use)
export function authAvatarOn(f, pid) { const pl = f.session?.players?.get?.(pid); return pl?.av || pl?.ent || null; }

// ore tiles: rock with ore, an open 4-neighbour to stand on; nearest to (cx, cy)
export function oreTiles(f, M, cx, cy, maxR = 160, maxTier = 4) {
  const w = f.game.world, out = [];
  const minTier = M.items.ORE_MIN_TIER || [];
  const x0 = Math.max(1, Math.floor(cx - maxR)), x1 = Math.min(w.W - 2, Math.floor(cx + maxR));
  const y0 = Math.max(1, Math.floor(cy - maxR)), y1 = Math.min(w.H - 2, Math.floor(cy + maxR));
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    const i = w.idx(tx, ty);
    if (w.rock[i] !== 1 || !w.ore[i] || (minTier[w.ore[i]] || 0) > maxTier) continue;
    const opens = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const j = w.idx(tx + dx, ty + dy);
      if (!w.rock[j] && w.water[j] !== 2 && w.solid[j] !== 1) opens.push([tx + dx, ty + dy]);
    }
    if (!opens.length) continue;
    out.push({ tx, ty, i, ore: w.ore[i], opens, d: Math.hypot(tx - cx, ty - cy) });
  }
  return out.sort((a, b) => a.d - b.d);
}

// placement sites: origin (x0, y0) whose tiles (shape(x0, y0)) are all valid for `type` on every frame
export function findSite(fs, Ms, type, shape, cx, cy, { rMin = 3, rMax = 16, avoidPts = [], rot = 0 } = {}) {
  for (let r = rMin; r <= rMax; r++) {
    for (let k = 0; k < 8 * r; k++) {
      const a = (k / (8 * r)) * Math.PI * 2;
      const x0 = Math.floor(cx + Math.cos(a) * r), y0 = Math.floor(cy + Math.sin(a) * r);
      const tiles = shape(x0, y0);
      let ok = true;
      for (const [tx, ty] of tiles) {
        if (avoidPts.some(([px, py]) => Math.abs(px - (tx + 0.5)) < 1.6 && Math.abs(py - (ty + 0.5)) < 1.6)) { ok = false; break; }
        for (let i = 0; i < fs.length && ok; i++) {
          const rs = Ms[i].building.placeReason(fs[i].game, type, tx, ty, null, rot);
          if (rs !== null) ok = false;
        }
        if (!ok) break;
      }
      if (ok) return { x0, y0, tiles };
    }
  }
  return null;
}

// ---------------- actions ----------------
// Walk the frame's player to the interactable and work it (controller goal → work loop)
export function interact(f, it) {
  if (!it) throw new Fail(`${f.label}: nothing to interact with`);
  f.game.ctl.interact(it);
}

// Interact, then keep re-issuing the interaction whenever the player went idle (knock-back from a creature,
// path hiccup) until done() — up to `retries` restarts. makeIt() is re-evaluated each time (state changes).
export async function workUntil(t, f, makeIt, done, ms, label, { retries = 6, stand = null } = {}) {
  const g = f.game, p = g.player, t0 = now();
  let restarts = 0, idleSince = null;
  if (stand) stand();
  interact(f, makeIt());
  await t.waitFor(() => {
    if (done()) return true;
    const idle = !p.work && !g.ctl.goal;
    if (!idle) { idleSince = null; return false; }
    idleSince ??= now();
    if (now() - idleSince > Math.max(700, CFG.budget * 3) && restarts < retries && now() - t0 < ms - 500) {
      restarts++; idleSince = null;
      t.log(`${f.label}: ${label} interrupted (${f.lastUi(1) || 'idle'}) — restarting`);
      if (stand) stand();
      const it = makeIt();
      if (it) interact(f, it);
    }
    return false;
  }, ms, `${f.label}: ${label}`, () => `work=${short(p.work?.label)} goal=${g.ctl.goal?.type ?? '-'} restarts=${restarts} ui: ${f.lastUi()}`);
}

// the host validates guest intents against its own view of the guest (pl.av): after teleporting a guest far,
// wait until that view caught up before acting
export async function hostSees(t, H, G, ms = 3000) {
  const p = G.game.player;
  await t.waitFor(() => { const av = authAvatarOn(H, G.pid); return av && Math.hypot(av.x - p.x, av.y - p.y) < 0.35; }, ms,
    'host sees the guest at its new position', () => { const av = authAvatarOn(H, G.pid); return `host view ${av?.x?.toFixed(2)},${av?.y?.toFixed(2)} guest ${p.x.toFixed(2)},${p.y.toFixed(2)}`; });
}

// host-side test setup: hostile creatures near a work site stop aggroing for a while (authority AI fields)
export function pacify(H, x, y, r = 14, secs = 600) {
  let n = 0;
  for (const m of H.game.entities) {
    if (!m.isMob || m.proxy || m.dead || Math.hypot(m.x - x, m.y - y) > r) continue;
    if ((m.temper || '') !== 'hostile') continue;
    m.calmT = secs;
    if (m.state === 'chase') { m.state = 'idle'; m.stateT = 1; m.threat = null; }
    n++;
  }
  return n;
}

export async function chop(t, f, M, o, { tool = 'axe_copper', until = 'fall', ms = 20000 } = {}) {
  ensure(f, { [tool]: 1 });
  const mk = () => M.gathering.describeObject(f.game, o);
  const it = mk();
  if (!it || it.kind !== 'tree') throw new Fail(`${f.label}: tree ${o.id} is not choppable here (descriptor ${it?.kind ?? 'null'})`);
  t.log(`${f.label} chops ${o.type} ${o.id} (s=${(o.s || 1).toFixed(2)})`);
  if (until === 'none') { interact(f, it); return; }
  const pred = until === 'stump' ? () => o.stump : () => o.fall > 0 || o.stump;
  await workUntil(t, f, () => (o.fall > 0 || o.stump ? null : mk()), pred, ms, `tree ${o.id} ${until}`);
}

// any natural-object work (pick, forage, boulder, stump): finishes when the object is gone
export async function gather(t, f, M, o, { ms = 15000 } = {}) {
  const it = M.gathering.describeObject(f.game, o);
  if (!it) throw new Fail(`${f.label}: ${o.type} ${o.id} has no interaction`);
  t.log(`${f.label} ${it.verb} ${o.type} ${o.id}`);
  await workUntil(t, f, () => M.gathering.describeObject(f.game, o), () => o.gone || !objOn(f, o.id), ms, `${o.type} ${o.id} gone`);
}

// place blueprints through build mode: single tile (a) or a drag from a to b (rot: orientation); returns
// structures created on f
export function place(f, M, type, a, b = a, rot = null) {
  const g = f.game;
  const before = new Set(g.build.structures.map((o) => o.id));
  M.building.enterBuildMode(g, type);
  const m = g.build.mode;
  if (!m || m.kind !== 'place') throw new Fail(`${f.label}: enterBuildMode(${type}) refused (${f.lastUi(1)})`);
  if (rot != null) m.rot = rot;
  if (M.data.BUILDINGS[type].drag) { m.anchor = [a[0], a[1]]; m.end = [b[0], b[1]]; m.hover = [b[0], b[1]]; }
  else m.hover = [a[0], a[1]];
  m.locked = true;
  const ok = M.building.commitPlacement(g);
  M.building.exitBuildMode(g);
  if (!ok) throw new Fail(`${f.label}: commitPlacement(${type}) failed (${f.lastUi(1)})`);
  return g.build.structures.filter((o) => !before.has(o.id));
}

// structure at tile on a frame (any layer)
export function structAt(f, M, tx, ty, layer = null) {
  const g = f.game;
  if (layer) return M.autotile.structureAt(g, tx, ty, layer);
  return M.autotile.structureAt(g, tx, ty, 'main') || M.autotile.structureAt(g, tx, ty, 'rug') || M.autotile.structureAt(g, tx, ty, 'floor');
}

// stand next to a structure (outside its footprint)
export function standBy(f, M, o, prefer = Math.PI / 2) {
  const def = M.data.BUILDINGS[o.type];
  const sw = o.fw || def.size[0], sh = o.fh || def.size[1];
  const cx = o.tx + sw / 2, cy = o.ty + sh / 2;
  const s = freeSpot(f, M, cx, cy, { rMin: Math.max(sw, sh) / 2 + 0.45, rMax: Math.max(sw, sh) / 2 + 1.3, prefer,
    avoid: (x, y) => x > o.tx - 0.3 && x < o.tx + sw + 0.3 && y > o.ty - 0.3 && y < o.ty + sh + 0.3 });
  if (!s) throw new Fail(`${f.label}: no free spot next to ${o.type} ${o.id}`);
  teleport(f, s[0], s[1]);
}

// build blueprints (by id) one by one with the frame's player
export async function buildAll(t, f, M, ids, { ms = 20000 } = {}) {
  for (const id of ids) {
    const o = structOn(f, id);
    if (!o) throw new Fail(`${f.label}: structure ${id} missing`);
    if (!o.blueprint) continue;
    const mk = () => { const q = structOn(f, id); return q && q.blueprint ? M.building.describeStructure(f.game, q) : null; };
    await workUntil(t, f, mk, () => !structOn(f, id)?.blueprint, ms, `builds ${o.type} ${id}`, { stand: () => standBy(f, M, structOn(f, id) || o) });
  }
}

export async function decon(t, f, M, id, { ms = 20000 } = {}) {
  const g = f.game, o = structOn(f, id);
  if (!o) throw new Fail(`${f.label}: structure ${id} missing`);
  standBy(f, M, o);
  M.building.toggleDecon(g, o, true);
  await t.waitFor(() => g.build.decon.has(structOn(f, id)) || !structOn(f, id), ms / 4, `${f.label}: ${id} marked for deconstruction`);
  const mk = () => { const q = structOn(f, id); return q && g.build.decon.has(q) ? M.building.describeStructure(g, q) : null; };
  await workUntil(t, f, mk, () => !structOn(f, id), ms, `deconstructs ${id}`);
}

export async function mine(t, f, M, tx, ty, { ms = 20000, stand = null } = {}) {
  const g = f.game, i = g.world.idx(tx, ty);
  await workUntil(t, f, () => (g.world.rock[i] === 1 ? M.mining.rockIt(g, tx, ty) : null), () => g.world.rock[i] === 0, ms, `mines (${tx},${ty})`, { stand });
}

export async function plant(t, f, M, plot, { ms = 10000 } = {}) {
  const g = f.game;
  const it = M.building.describeStructure(g, plot);
  if (!it || it.kind !== 'plant' || (it.prio ?? 0) < 0) throw new Fail(`${f.label}: plot ${plot.id} not plantable (${it?.kind ?? 'null'} ${it?.verb ?? ''})`);
  const mk = () => { const q = M.building.describeStructure(g, plot); return q?.kind === 'plant' ? q : null; };
  await workUntil(t, f, mk, () => M.farming.cropAt(g, plot.tx, plot.ty), ms, `plants at (${plot.tx},${plot.ty})`);
}

export async function harvest(t, f, M, plot, { ms = 10000 } = {}) {
  const g = f.game;
  const it = M.building.describeStructure(g, plot);
  if (!it || it.kind !== 'harvest') throw new Fail(`${f.label}: plot ${plot.id} not harvestable (${it?.kind ?? 'null'})`);
  const mk = () => { const q = M.building.describeStructure(g, plot); return q?.kind === 'harvest' ? q : null; };
  await workUntil(t, f, mk, () => !M.farming.cropAt(g, plot.tx, plot.ty), ms, `harvests (${plot.tx},${plot.ty})`);
}

// one rolled hit from the frame's player (the attacker's own combat pipeline: local mob, or mob.hit on a guest)
export function hit(f, M, target, amount = 9999, opts = {}) {
  return M.combat.applyPlayerHit(f.game, target, { amount, crit: false }, opts);
}

export function ability(f, M, id, target) {
  const g = f.game, p = g.player;
  M.abilities.rebuildBar(g);
  p.energy = p.maxEnergy; p.gcdT = 0; p.cds[id] = 0; p.stunT = 0;
  if (target) { g.ctl.setTarget(target); M.combat.faceTowards(p, target); }
  return M.abilities.useAbility(g, id);
}

export async function walkTo(t, f, x, y, { ms = 15000 } = {}) {
  const g = f.game, p = g.player;
  g.ctl.walkTo(x, y);
  await t.waitFor(() => Math.hypot(p.x - x, p.y - y) < 0.5 || !g.ctl.goal, ms, `${f.label} walks to (${x.toFixed(1)},${y.toFixed(1)})`);
  return Math.hypot(p.x - x, p.y - y) < 0.6;
}

export function useBed(f, M, bed) { M.building.useStructure(f.game, M.building.describeStructure(f.game, bed)); }

// open / close a door the way a player does (E / tap → describeStructure kind 'door' → useStructure → door.toggle)
export function useDoor(f, M, door) {
  const it = M.building.describeStructure(f.game, door);
  if (!it || it.kind !== 'door') throw new Fail(`${f.label}: ${door.id} is not a usable door (${it?.kind})`);
  M.building.useStructure(f.game, it);
}

// put an inventory item into a chest through the chest panel (the UI path a player uses)
export async function chestPut(t, f, M, chest, item) {
  const g = f.game;
  const it = M.building.describeStructure(g, chest);
  if (!it || it.kind !== 'chest') throw new Fail(`${f.label}: ${chest.id} is not an usable chest (${it?.kind})`);
  M.building.useStructure(g, it);
  const btn = await t.waitFor(() => {
    const i = g.player.inv.slots.findIndex((s) => s && s.id === item);
    return i >= 0 && f.doc.querySelector(`[data-slot="${i}"]`);
  }, 3000, `${f.label}: chest panel shows inventory slot with ${item}`);
  btn.click();
  await t.sleep(30);
  g.events.emit('closepanels', {});
}

// ---------------- recorders ----------------
// Every loot row that appears on each frame (first-seen item/qty), so ids can be compared even after pick-up.
export function lootRecorder(t, fs) {
  const base = fs.map((f) => new Set(f.game.loot.map((l) => String(l.id))));
  const seen = fs.map(() => new Map());
  const tick = () => fs.forEach((f, i) => {
    for (const l of f.game?.loot || []) {
      const k = String(l.id);
      if (!base[i].has(k) && !seen[i].has(k)) seen[i].set(k, { id: k, item: l.item, qty: l.qty, t: now() });
    }
  });
  const w = t.watch(tick, 4);
  return {
    stop() { tick(); w.stop(); },
    rows(i) { return [...seen[i].values()]; },
    items(i) { const o = {}; for (const r of seen[i].values()) o[r.item] = (o[r.item] || 0) + r.qty; return o; },
    // ids/items/qty equal between frames i and j
    compare(i = 0, j = 1) {
      const a = seen[i], b = seen[j];
      const onlyA = [...a.keys()].filter((k) => !b.has(k)), onlyB = [...b.keys()].filter((k) => !a.has(k));
      const diff = [...a.keys()].filter((k) => b.has(k) && (a.get(k).item !== b.get(k).item || a.get(k).qty !== b.get(k).qty));
      const fmt = (m, ks) => ks.slice(0, 12).map((k) => `${k}:${m.get(k).item}×${m.get(k).qty}`).join(' ');
      return {
        ok: !onlyA.length && !onlyB.length && !diff.length, n: a.size,
        detail: `${fs[i].label} ${a.size} rows, ${fs[j].label} ${b.size} rows` + (onlyA.length ? ` · only ${fs[i].label}: ${fmt(a, onlyA)}` : '')
          + (onlyB.length ? ` · only ${fs[j].label}: ${fmt(b, onlyB)}` : '') + (diff.length ? ` · different: ${diff.slice(0, 6).join(' ')}` : ''),
        lag: (() => { let mx = 0; for (const [k, r] of a) if (b.has(k)) mx = Math.max(mx, b.get(k).t - r.t); return mx; })(),
      };
    },
  };
}

export function xpRecorder(t, f) {
  const rec = { total: 0, events: [] };
  t.on(f, 'xp', (d) => { rec.total += d?.amount || 0; rec.events.push(d?.amount || 0); });
  return rec;
}

// first time (harness clock) each predicate became true; rising-edge counter
export function edgeWatch(t, preds) {
  const out = {};
  const prev = {};
  for (const k in preds) { out[k] = { first: null, edges: 0 }; prev[k] = false; }
  t.watch(() => {
    for (const k in preds) {
      let v = false;
      try { v = !!preds[k](); } catch { v = false; }
      if (v && !prev[k]) { out[k].edges++; if (out[k].first == null) out[k].first = now(); }
      prev[k] = v;
    }
  }, 4);
  return out;
}

// view rect test with the same margins flora.js uses for "never spawn in view"
export function inView(f, x, y) {
  const v = f.game.view();
  const tx = Math.floor(x), ty = Math.floor(y);
  return tx + 1 > v.x0 - 2 && tx < v.x1 + 2 && ty + 1 > v.y0 - 3 && ty < v.y1 + 4;
}
