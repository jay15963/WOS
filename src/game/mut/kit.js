// Style / detail kits of construction pieces + training dummies (agent K). Every shared change goes through here.
// Op: struct.style (blueprints only) · dummy.hit   Intents: struct.style · dummy.hit
//
// Shared structure fields: o.style ('' = default look) and o.det (canonical detail string, content/kits.js), fixed
// at placement (build.place → struct.add rows [.., style, det]); only BLUEPRINTS can change them (struct.style):
// a finished piece must be deconstructed and built again. Derived on every peer (cosmetic, `_` prefix): o._k (decoded
// look, shared cache object), o._cm (carpet neighbour mask), kit light (sconces, lanterns) in o.light.
// Training dummy: a finished `dummy` building joins game.props (attackable, never breaks); hits are intents
// (the hitter rolls the amount, like every player hit) → op dummy.hit on every peer (wobble, numbers, sound);
// the host gives a little XP to the hitter with diminishing returns (owner effect `xp`).

import { defineIntent, defineOp } from '../../net/registry.js';
import { BUILDINGS } from '../data.js';
import { normStyle, cleanDet, decodeKit, hasKit, withDetail, hasDet } from '../content/kits.js';
import { updateMasksAround, tileHooks } from '../autotile.js';

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const structOf = (game, id) => { const o = game.world.objById.get(id); return o && o.building && !o.removed ? o : null; };
export const MAX_STYLE_DIST = 24;

// ---------- fields (appliers / snapshot only) ----------
export function applyKitFields(game, o, style, det) {
  if (!hasKit(o.type)) { if (o.style) o.style = ''; if (o.det) o.det = ''; o._k = null; return; }
  o.style = normStyle(o.type, style);
  o.det = cleanDet(o.type, det);
  o._k = o.style || o.det ? decodeKit(o.type, o.style, o.det) : null;
  kitLight(o);
}

// detail lights (sconce, lanterns) on finished pieces without a light of their own (light is cosmetic/derived)
function kitLight(o) {
  const def = BUILDINGS[o.type];
  if (def.light) return;
  const L = !o.blueprint && (o.progress ?? 1) >= 1 && o._k?.light; // (placeStructure calls this before setting o.blueprint)
  if (L) { if (!o.light || o._kl !== L) { o.light = { ...L }; o._kl = L; } }
  else if (o._kl) { delete o.light; o._kl = null; }
}

// called by completeStructure / removeStructure (mut/structures.js)
export function kitComplete(game, o) {
  kitLight(o);
  if (BUILDINGS[o.type]?.dummy) dummyOn(game, o);
}
export function kitRemove(game, o) { if (o.dummy) dummyOff(game, o); }

// derived per-tile detail masks: carpets link to carpeted neighbours (any floor) — autotile refresh hook
const D4 = [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8]];
tileHooks.push((game, o) => {
  if (!o._k || !o._k.on.carpet) { if (o._cm) o._cm = 0; return; }
  const w = game.world, g = game.build.grid.floor;
  let m = 0;
  for (const [dx, dy, bit] of D4) {
    const x = o.tx + dx, y = o.ty + dy;
    if (!w.inBounds(x, y)) continue;
    const n = g.get(w.idx(x, y) + (o.lv | 0) * w.W * w.H); // levels: same story
    if (n && hasDet(n.det, 'carpet')) m |= bit;
  }
  o._cm = m;
});

// ---------- training dummy ----------
export const DUMMY_NAME = 'Boneco de treino';
function dummyOn(game, o) {
  if (o.blueprint || o.dummy || !game.props) return;
  o.isProp = true; o.dummy = true; o.name = DUMMY_NAME; o.temper = 'neutral'; o.level = 1; o.r = 0.3; o.scale = 1;
  o.hp = 100; o.maxHp = 100; o.broken = false;
  game.props.push(o);
  game.propsById?.set(o.id, o);
}
function dummyOff(game, o) {
  const P = game.props;
  const i = P ? P.indexOf(o) : -1;
  if (i >= 0) P.splice(i, 1);
  game.propsById?.delete(o.id);
  o.isProp = false; o.dummy = false;
}

// ---------- ops ----------
defineOp('struct.style', {
  doc: 'Blueprints get a new style / detail list (finished pieces never change: deconstruct and build again). Rows [id, style, det].',
  args: { list: '[[structId, style, det]]', by: 'pid' },
  apply(game, a) {
    let any = null;
    for (const r of a.list || []) {
      const o = Array.isArray(r) ? structOf(game, r[0]) : null;
      if (!o || !o.blueprint) continue;
      applyKitFields(game, o, r[1], r[2]);
      updateMasksAround(game, o.tx, o.ty, o.tx + (o.fw || 1) - 1, o.ty + (o.fh || 1) - 1);
      any ||= o;
    }
    if (!any) return;
    game.build.v++;
    game.events.emit('tile', { tx: any.tx, ty: any.ty });
    game.audio?.play('restyle', { x: any.x, y: any.y });
  },
});

defineOp('dummy.hit', {
  doc: 'A player hit a training dummy (amount rolled by the hitter): wobble, damage number and straw for everyone; xp to `by`.',
  args: { id: 'structId', amount: 'int', crit: '0|1', dtype: 'string?', sx: 'x', by: 'pid', xp: 'int?' },
  apply(game, a, ctx) {
    const o = structOf(game, a.id);
    if (!o || !o.dummy) return;
    o._wobT = game.time; o._wobD = num(a.sx, o.x) < o.x ? 1 : -1; o._wobA = Math.min(1, 0.45 + num(a.amount) / 40) * (a.crit ? 1.3 : 1);
    o.flash = 0.6;
    game.juice.chips(o.x, o.y - 0.55, [0.86, 0.74, 0.42], a.crit ? 9 : 5, 0.45);
    game.audio?.play('dummy_hit', { x: o.x, y: o.y, volume: a.crit ? 1 : 0.8 });
    game.events.emit('dummyhit', { o, amount: num(a.amount) | 0, crit: !!a.crit, dtype: typeof a.dtype === 'string' ? a.dtype.slice(0, 8) : 'phys', mine: !!ctx.mine });
  },
});

// ---------- intents ----------
defineIntent('struct.style', {
  doc: 'Change the style / details of BLUEPRINTS of `type` (style: id | null keeps; det: full list | null keeps; add / del: one detail). Finished pieces are refused.',
  args: { ids: '[structId] (≤ 400)', type: 'buildingId', style: 'string|null', det: 'string|null', add: 'detailId?', del: 'detailId?' },
  run(game, a, actor, net) {
    const ids = Array.isArray(a.ids) ? a.ids.slice(0, 400) : [];
    const list = [];
    let built = 0, far = 0;
    for (const id of ids) {
      const o = structOf(game, id);
      if (!o || !hasKit(o.type) || (a.type && o.type !== a.type)) continue;
      if (!o.blueprint || o.moveOf) { built++; continue; }
      const e = actor.ent;
      if (e && Math.hypot(e.x - o.x, e.y - o.y) > MAX_STYLE_DIST) { far++; continue; }
      const st = typeof a.style === 'string' ? normStyle(o.type, a.style) : o.style || '';
      let dt = typeof a.det === 'string' ? cleanDet(o.type, a.det) : o.det || '';
      if (typeof a.add === 'string') dt = withDetail(o.type, dt, a.add, true);
      if (typeof a.del === 'string') dt = withDetail(o.type, dt, a.del, false);
      if (st !== (o.style || '') || dt !== (o.det || '')) list.push([o.id, st, dt]);
    }
    if (!list.length) return built ? 'Já construída: desmonte e construa de novo para mudar o estilo' : far ? 'Muito longe' : 'Nada para mudar';
    net.emit('struct.style', { list, by: actor.pid });
    return { changed: list.length, built };
  },
});

defineIntent('dummy.hit', {
  doc: 'Hit a training dummy with a rolled amount (it never breaks). The host adds training xp with diminishing returns per player.',
  args: { id: 'structId', amount: 'number', crit: '0|1', dtype: 'string?', ranged: '0|1' },
  run(game, a, actor, net) {
    const o = structOf(game, a.id);
    if (!o || !o.dummy || o.blueprint) return 'Não é um boneco de treino';
    const e = actor.ent;
    if (e && Math.hypot(e.x - o.x, e.y - o.y) > (a.ranged ? 18 : 6)) return 'Longe demais';
    const amount = Math.max(0, Math.min(5000, Math.round(num(a.amount))));
    // training xp (host bookkeeping, not shared): ~0.5 per hit, fading with the recent hit count (5 min half-life-ish),
    // nothing from level 12 on — the dummy teaches the basics, it is not an xp farm
    const T = game._train || (game._train = new Map());
    const now = game.worldTime;
    const r = T.get(actor.pid) || { n: 0, t: now, acc: 0 };
    r.n = r.n * Math.exp(-Math.max(0, now - r.t) / 300) + 1; r.t = now;
    const lvl = e?.level || 1;
    r.acc += lvl >= 12 ? 0 : 0.5 / (1 + r.n / 25);
    const xp = Math.floor(r.acc);
    r.acc -= xp;
    T.set(actor.pid, r);
    net.emit('dummy.hit', { id: o.id, amount, crit: a.crit ? 1 : 0, dtype: typeof a.dtype === 'string' ? a.dtype.slice(0, 8) : undefined, sx: e ? Math.round(e.x * 100) / 100 : o.x, by: actor.pid, xp: xp || undefined });
  },
});
