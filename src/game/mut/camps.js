// Bandit camps — layout and breakable props (crates).
// installCamps(game): DETERMINISTIC camp layout (tents, crates, campfire, banner, cleared area), run on
// every client right after the world exists and before any save / snapshot, from the pristine world only
// (seeded rngs, ids 'camp<i>:<k>'). Raiders (bandits.js populateCamps) are host-only creatures.
// Op: prop.set (crate hp / broken / restored). Intent: prop.hit.

import { defineIntent, defineOp } from '../../net/registry.js';
import { mulberry32 } from '../../engine/noise.js';
import { occAdd, occAddTiles, occRemove } from '../nav.js';

const CAMP_MIN_D = 60;
// set by bandits.js (host side of a crate break: loot table, camp aggro)
export const campHooks = { crateBreak: null };
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// ---------- camp placement ----------
function openSpot(game, x, y, R) {
  const w = game.world;
  if (!w.inBounds(Math.floor(x - R - 2), Math.floor(y - R - 2)) || !w.inBounds(Math.floor(x + R + 2), Math.floor(y + R + 2))) return false;
  let trees = 0;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    if (dx * dx + dy * dy > R * R) continue;
    const i = w.idx(Math.floor(x + dx), Math.floor(y + dy));
    if (w.rock0[i] || w.water[i]) return false; // pristine world only (never player structures / mined tiles)
  }
  w.forChunks(x - R, y - R, x + R, y + R, (c) => { for (const o of c.objects) if (o.type.startsWith('tree_') && Math.hypot(o.x - x, o.y - y) < R) trees++; });
  return trees <= 9;
}

export function findCampSpots(game) {
  const w = game.world, sx = w.spawn.x, sy = w.spawn.y;
  const zones = (w.zones || []).filter((z) => z.type === 'bandit_camp');
  if (zones.length) return zones.slice(0, 4).map((z) => ({ x: z.x, y: z.y, r: z.r || 6, zone: true }));
  const rand = mulberry32((w.seed | 0) * 131 + 17);
  const cands = [];
  for (const z of w.zones || []) {
    if (z.type !== 'clearing' && z.type !== 'meadow' && z.type !== 'birch' && z.type !== 'forest') continue;
    const d = Math.hypot(z.x - sx, z.y - sy);
    if (d < CAMP_MIN_D) continue;
    cands.push({ x: z.x, y: z.y, d, score: (z.type === 'clearing' ? 2 : z.type === 'meadow' ? 1.2 : 0.6) + rand() });
  }
  for (let k = 0; k < 400; k++) {
    const x = 12 + rand() * (w.W - 24), y = 12 + rand() * (w.H - 24);
    const d = Math.hypot(x - sx, y - sy);
    if (d >= CAMP_MIN_D) cands.push({ x, y, d, score: rand() * 0.8 });
  }
  cands.sort((a, b) => b.score - a.score);
  const out = [];
  for (const c of cands) {
    if (out.length >= 3) break;
    const x = Math.floor(c.x) + 0.5, y = Math.floor(c.y) + 0.5;
    if (out.some((o) => Math.hypot(o.x - x, o.y - y) < 48)) continue;
    if (!openSpot(game, x, y, 5)) continue;
    out.push({ x, y, r: 6 });
  }
  return out;
}

function clearArea(game, x, y, R) {
  const w = game.world;
  const kill = [];
  w.forChunks(x - R - 1, y - R - 1, x + R + 1, y + R + 1, (c) => {
    for (const o of c.objects) {
      if (o.building || o.camp) continue;
      if (Math.hypot(o.x - x, o.y - y) > R) continue;
      if (/^(tree_|bush|berrybush|boulder|pebble|stick|fibergrass|wild_)/.test(o.type)) kill.push(o);
    }
    if (c.decor) c.decor = c.decor.filter((d) => d.t === 'grass' || Math.hypot(d.x - x, d.y - y) > R - 0.5);
  });
  for (const o of kill) { occRemove(game, o); w.removeObject(o); o.gone = true; }
}

function addCampObject(game, camp, o) {
  const w = game.world;
  // reuse an object the world generator may already have placed here
  let found = null;
  w.forChunks(o.x - 1, o.y - 1, o.x + 1, o.y + 1, (c) => {
    for (const q of c.objects) if (!found && q.type === o.type && Math.hypot(q.x - o.x, q.y - o.y) < 1.2) found = q;
  });
  const obj = found || w.addObject({ v: 0, s: 1, f: 1, ...o, id: camp.id + ':' + camp.objects.length });
  Object.assign(obj, { camp: camp.id });
  if (!found && obj.solid) occAdd(game, obj);
  camp.objects.push(obj);
  return obj;
}

function makeCrate(game, camp, x, y) {
  const o = addCampObject(game, camp, { type: 'crate_0', x, y, solid: 0.32, f: camp.rand() < 0.5 ? 1 : -1 });
  Object.assign(o, { isProp: true, name: 'Caixote', temper: 'neutral', level: 1, r: 0.34, scale: 0.9, hp: 3, maxHp: 3, broken: false });
  game.props.push(o);
  game.propsById.set(o.id, o);
  camp.crates.push(o);
  return o;
}

function buildCamp(game, spot, id, tier, rand) {
  const camp = { id: 'camp' + id, x: spot.x, y: spot.y, r: spot.r, tier, objects: [], crates: [], members: [], rand };
  if (!spot.zone) clearArea(game, spot.x, spot.y, 4.6);
  const cx = spot.x, cy = spot.y;
  addCampObject(game, camp, {
    type: 'campfire', x: cx, y: cy + 0.12, solid: 0.3, fire: true,
    light: { r: 1, g: 0.62, b: 0.3, radius: 6, intensity: 1.3, flicker: 0.25, lift: 0.3 },
  });
  addCampObject(game, camp, { type: 'banner', x: cx + 1.6, y: cy - 1.1, solid: 0.12 });
  const a0 = rand() * Math.PI * 2;
  for (let k = 0; k < 2; k++) {
    const a = a0 + k * Math.PI * (0.85 + rand() * 0.3);
    const tx = Math.floor(cx + Math.cos(a) * 3.3) + 0.5, ty = Math.floor(cy + Math.sin(a) * 2.6) + 1;
    const t = addCampObject(game, camp, { type: 'tent_' + (k % 2), x: tx, y: ty, solid: 0.62, f: Math.cos(a) > 0 ? -1 : 1 });
    occAddTiles(game, t, [[Math.floor(tx) - 1, Math.floor(ty - 0.05)], [Math.floor(tx) + 1, Math.floor(ty - 0.05)]]);
    makeCrate(game, camp, tx + (Math.cos(a) > 0 ? -1.5 : 1.5), ty + 0.6);
  }
  if (rand() < 0.6) makeCrate(game, camp, cx - 1.8, cy + 1.4);
  return camp;
}

// every client, before loadGame / the join snapshot
export function installCamps(game) {
  const w = game.world;
  game.camps = [];
  game.props = [];
  game.propsById = new Map();
  game.net.withApply(() => {
    findCampSpots(game).forEach((s, i) => {
      const rand = mulberry32((w.seed | 0) * 977 + i * 31 + 3);
      const d = Math.hypot(s.x - w.spawn.x, s.y - w.spawn.y);
      game.camps.push(buildCamp(game, s, i + 1, d > 95 ? 1 : 0, rand));
    });
  });
  return game.camps;
}

// ---------- crates ----------
export const propById = (game, id) => game.propsById?.get(id) || null;

export function setPropBroken(game, o, broken, at) {
  if (broken && !o.broken) {
    o.broken = true; o.brokenAt = at; o.hp = 0;
    occRemove(game, o);
    game.world.removeObject(o); // the art never sees a broken crate; it comes back with the camp
  } else if (!broken && o.broken) {
    o.broken = false; o.hp = o.maxHp; o.flash = 0;
    game.world.addObject(o);
    occAdd(game, o);
  }
}

defineOp('prop.set', {
  doc: 'Crate state: hit (hp), broken (removed, `at` = host time) or restored by the camp.',
  args: { id: 'propId', hp: 'int', broken: '0|1', at: 'worldTime?', hit: '0|1', by: 'pid?', toast: 'string?' },
  apply(game, a, ctx) {
    const o = propById(game, a.id);
    if (!o) return;
    if (a.hit) {
      o.flash = 1; o.shake = 1;
      (game.shaking ||= new Set()).add(o);
      game.juice.chips(o.x, o.y - 0.2, [0.62, 0.46, 0.28], 7, 0.45);
      game.audio?.play('chop', { x: o.x, y: o.y, volume: 0.8 });
      game.events.emit('damage', { target: o, src: null, amount: 0, kind: 'prop' });
    }
    if (a.broken && !o.broken) {
      setPropBroken(game, o, true, a.at ?? game.worldTime);
      game.juice.puff(o.x, o.y, 10, [0.62, 0.5, 0.36], 0.8);
      game.juice.chips(o.x, o.y, [0.62, 0.46, 0.28], 14, 0.3);
      if (ctx.mine) game.juice.shake(0.15);
      game.events.emit('kill', { target: o });
    } else if (!a.broken && o.broken) setPropBroken(game, o, false);
    else o.hp = a.hp;
  },
});

defineIntent('prop.hit', {
  doc: 'A player hit a crate with a rolled amount (≥ 18 counts double); breaking it rolls the camp loot and alerts the camp.',
  args: { id: 'propId', amount: 'number' },
  run(game, a, actor, net) {
    const o = propById(game, a.id);
    if (!o || o.broken) return 'Já quebrado';
    const e = actor.ent;
    if (e && Math.hypot(e.x - o.x, e.y - o.y) > 18) return 'Longe demais';
    const dmg = num(a.amount) >= 18 ? 2 : 1;
    const hp = Math.max(0, o.hp - dmg);
    if (hp > 0) { net.emit('prop.set', { id: o.id, hp, broken: 0, hit: 1, by: actor.pid }); return; }
    net.emit('prop.set', { id: o.id, hp: 0, broken: 1, at: Math.round(game.worldTime), hit: 1, by: actor.pid, toast: 'Caixote quebrado', toastKind: 'info' });
    campHooks.crateBreak?.(game, o, e);
  },
});
