// Corpses on the ground (I · corpos e decomposição) — gameplay side. Shared state and its ops live in
// mut/corpses.js; the art in art/corpses.js (sprites) + art/corpseDraw.js (drawing).
//
//  · Every creature / raider / player that dies leaves a body (host death path → op corpse.add).
//  · Players: on death the bag and the equipped items move into the body (intent corpse.player); anyone can
//    take them back ("Revistar": transfer window, both sides sortable) until the end of day 2.
//  · Animals: nothing drops any more. Day 1 "Coletar" (timed work, better with a blade) gives meat / hide;
//    day 2 it is rotten ("Está podre demais"); days 3–5 skeleton: "Remover ossada" gives "Ossos"; gone after 5.
//  · Interactions plug into the controller (nearestInteractable / tap pick) and the generic work loop.

import { registerWork, hitsFor } from './gathering.js';
import { SLOTS, equipChanged } from './equipment.js';
import { ITEMS } from './data.js';
import { stageOf, corpseAge, sizeOf, isPawnCorpse, DAY_GONE } from './mut/corpses.js';
import { openContainer } from '../ui/container.js';
import { uiIcon } from '../ui/icons.js';
import { drawCorpse, drawFlies } from '../art/corpseDraw.js';

const BUTCHER_TIME = { s: 2.4, m: 3.6, l: 5.4 };      // s with a blade (bare hands: ×1.8)
const BONES_TIME = { s: 1.8, m: 2.6, l: 3.4, p: 3.0 };
const OPEN_REACH = 2.6;
const BLADE_RANK = { knife: 3, sword: 2, axe: 1 };
const r2 = (v) => Math.round(v * 100) / 100;

export function initCorpses(game) {
  game.corpses = {
    map: new Map(), v: 0, fading: [],
    forNear(x, y, r, fn) {
      for (const c of this.map.values()) {
        // (a body I drag is always at hand: its action is "Largar")
        if (c.dragBy && c.dragBy === game.net.pid) { const it = describeCorpse(game, c); if (it) fn(it); continue; }
        if (Math.abs(c.x - x) <= r && Math.abs(c.y - y) <= r) { const it = describeCorpse(game, c); if (it) fn(it); }
      }
    },
    pickAt(wx, wy, tol) {
      let best = null, bd = 1e9;
      for (const c of this.map.values()) {
        const d = Math.hypot(wx - c.x, wy - (c.y - 0.15));
        if (d < 0.6 + tol && d < bd) { const it = describeCorpse(game, c); if (it) { bd = d; best = it; } }
      }
      return best;
    },
  };
  game.net.ids.c ??= 0; // corpse ids ('c…') survive saves and bump on load
  game.events.on('death', () => onLocalDeath(game));
  game.events.on('respawn', () => {
    const c = game.player._corpse && game.corpses.map.get(game.player._corpse);
    if (c && c.store && c.store.used()) game.later(1.2, () => game.events.emit('toast', { text: 'Seus itens ficaram no seu corpo (até o 2º dia)', kind: 'warn' }));
  });
  game.events.on('corpse', (d) => onCorpseEvent(game, d));
}

// ---------- local player death: everything carried goes into the body ----------
function onLocalDeath(game) {
  const p = game.player;
  const slots = [];
  const gear = [p.equip.main || null, p.equip.off || null, p.equip.body || null, p.equip.head || null];
  for (const k of SLOTS) if (p.equip[k]) { slots.push([p.equip[k], 1]); p.equip[k] = null; }
  for (let i = 0; i < p.inv.size; i++) { const s = p.inv.slots[i]; if (s) { slots.push([s.id, s.qty]); p.inv.slots[i] = null; } }
  p.inv.version++;
  equipChanged(game);
  const refund = {};
  for (const [id, n] of slots) refund[id] = (refund[id] || 0) + n;
  game.net.request('corpse.player', { x: r2(p.x), y: r2(p.y), f: p.facing, slots, gear }, {
    refund: slots.length ? refund : undefined,
    onOk: (r) => { if (r?.id) p._corpse = r.id; },
  });
}

// cosmetic links: hide the dead creature / player drawn by the rig (the body takes over); removal animation
function onCorpseEvent(game, d) {
  const c = d.c;
  if (d.add && d.src) {
    const e = entityOf(game, d.src);
    if (e) e._corpseId = c.id;
    if (d.src === game.net.pid) game.player._corpse = c.id;
  }
  if (d.removed && d.fx === 'dust') { // removed by hand ("Remover corpo")
    game.corpses.fading.push({ c, t0: game.time });
    game.juice.puff(c.x, c.y, 10, [0.62, 0.55, 0.45], 0.7);
  }
  if (d.removed && d.fx === 'bones') {
    game.corpses.fading.push({ c, t0: game.time });
    game.juice.chips(c.x, c.y - 0.1, [0.92, 0.88, 0.78], 10, 0.55);
    game.juice.puff(c.x, c.y, 6, [0.7, 0.64, 0.55], 0.5);
  }
  if (d.butchered) game.juice.chips(c.x, c.y - 0.15, [0.7, 0.16, 0.14], 8, 0.4);
}
function entityOf(game, src) {
  if (src === game.net.pid) return game.player;
  const pl = game.session?.players?.get?.(src);
  if (pl?.ent) return pl.ent;
  if (game.net.auth) { for (const e of game.entities) if (e.nid === src) return e; return null; }
  return game.net.entsApi?.byNid?.(src) || null;
}

// ---------- interactions ----------
export function describeCorpse(game, c) {
  if (c.removed) return null;
  const st = stageOf(game, c);
  if (st === 'gone') return null;
  const base = { o: c, corpse: true, x: c.x, y: c.y, reach: 0.95 };
  // dragged: by me → "Largar" right here (it is behind me); by someone else → hands off
  if (c.dragBy) {
    if (c.dragBy !== game.net.pid) return null;
    const p = game.player;
    return { ...base, x: p.x, y: p.y, kind: 'corpse_drop', verb: 'Largar corpo', icon: 'hand', prio: 6 };
  }
  if (st === 'skeleton') return { ...base, kind: 'corpse_bones', verb: c.of === 'spider' ? 'Remover restos' : 'Remover ossada', icon: 'skull', prio: 1 };
  // people (players, raiders): searched while they carry something, else dragged — never removed before the bones
  if (isPawnCorpse(c)) return c.store ? { ...base, kind: 'corpse_open', verb: 'Revistar', icon: 'bag', prio: 3, name: c.name } : dragIt(c);
  // animals / monsters: butchered or too rotten → removed (any time from the context menu / the "Remover" button)
  if (c.butchered || st === 'rotten') return { ...discardIt(c), prio: 1 };
  return { ...base, kind: 'butcher', verb: 'Coletar', icon: 'gather', prio: 3 };
}

// best cutting tool carried (knife > sword > axe, then tier) → { id, kind, tier } | null
export function cuttingTool(p) {
  let best = null, bs = -1;
  const consider = (id) => {
    const t = ITEMS[id]?.weapon?.type;
    if (!BLADE_RANK[t]) return;
    const score = BLADE_RANK[t] * 10 + (ITEMS[id].tier || 0);
    if (score > bs) { bs = score; best = { id, kind: t, tier: ITEMS[id].tier || 0 }; }
  };
  if (p.equip?.main) consider(p.equip.main);
  for (const s of p.inv.slots) if (s) consider(s.id);
  return best;
}

const gone = (game, c) => c.removed || !game.corpses.map.has(c.id);
const err = (game, text) => game.events.emit('error', { text });

registerWork('corpse_open', {
  valid: (g, it) => !gone(g, it.o) && ['fresh', 'rotten'].includes(stageOf(g, it.o)),
  start(game, it) {
    const st = stageOf(game, it.o);
    if (st !== 'fresh' && st !== 'rotten') { err(game, 'Restou só a ossada'); return null; }
    return { type: 'pick', cycle: 0.45, need: 1, label: 'Revistando', instantHit: true };
  },
  finish(game, wk) { openCorpse(game, wk.it.o); return true; },
});

registerWork('butcher', {
  valid: (g, it) => !gone(g, it.o) && !it.o.butchered && stageOf(g, it.o) === 'fresh',
  start(game, it) {
    const c = it.o, st = stageOf(game, c);
    if (c.butchered) { err(game, 'Já foi coletado'); return null; }
    if (st === 'rotten') { err(game, 'Está podre demais'); return null; }
    if (st !== 'fresh') { err(game, 'Restou só a ossada'); return null; }
    const blade = cuttingTool(game.player);
    const base = BUTCHER_TIME[sizeOf(c)] || 3.6;
    const total = blade ? base / (1 + 0.15 * blade.tier) : base * 1.8;
    const { need, cycle } = hitsFor(total, 2);
    return { type: 'butcher', cycle, need, label: blade ? 'Coletando' : 'Coletando (sem lâmina)', tool: blade?.id || null, blade };
  },
  hit(game, wk) {
    const c = wk.it.o;
    game.juice.blood(c.x, c.y - 0.1, 2);
    game.audio?.play('butcher', { x: c.x, y: c.y, volume: 0.55 });
  },
  finish(game, wk) {
    game.net.request('corpse.butcher', { id: wk.it.o.id, blade: wk.blade?.kind || 0, tier: wk.blade?.tier || 0 }, { onReject: (why) => why && err(game, why) });
    return true;
  },
});

registerWork('corpse_bones', {
  valid: (g, it) => !gone(g, it.o) && stageOf(g, it.o) === 'skeleton',
  start(game, it) {
    if (stageOf(game, it.o) !== 'skeleton') { err(game, 'Ainda não virou ossada'); return null; }
    const { need, cycle } = hitsFor(BONES_TIME[sizeOf(it.o)] || 2.6, 2);
    return { type: 'gather_bones', cycle, need, label: 'Recolhendo ossos' };
  },
  hit(game, wk) {
    const c = wk.it.o;
    game.juice.chips(c.x, c.y - 0.1, [0.9, 0.86, 0.76], 4, 0.35);
    game.audio?.play('bones', { x: c.x, y: c.y, volume: 0.5 });
  },
  finish(game, wk) {
    game.net.request('corpse.bones', { id: wk.it.o.id }, { onReject: (why) => why && err(game, why) });
    return true;
  },
});

// people's bodies (pawn corpses) are dragged, not removed: "Arrastar corpo" (start) / "Largar corpo" (drop)
export const canDiscard = (game, c) => !isPawnCorpse(c) || stageOf(game, c) === 'skeleton';
export const canDrag = (game, c) => isPawnCorpse(c) && stageOf(game, c) !== 'skeleton' && !c.dragBy;
export const dragIt = (c) => ({ o: c, corpse: true, x: c.x, y: c.y, reach: 0.95, kind: 'corpse_drag', verb: 'Arrastar corpo', icon: 'hand', prio: 1 });
registerWork('corpse_drag', {
  valid: (g, it) => !gone(g, it.o) && canDrag(g, it.o),
  start(game, it) { if (!canDrag(game, it.o)) { err(game, 'Não dá para arrastar este corpo'); return null; } return { type: 'pick', cycle: 0.25, need: 1, label: 'Pegando o corpo', instantHit: true }; },
  finish(game, wk) {
    game.net.request('corpse.drag', { id: wk.it.o.id, on: 1 }, { onReject: (why) => why && err(game, why) });
    return true;
  },
});
registerWork('corpse_drop', {
  valid: (g, it) => !gone(g, it.o) && it.o.dragBy === g.net.pid,
  start() { return { type: 'pick', cycle: 0.2, need: 1, label: 'Largando', instantHit: true }; },
  finish(game, wk) { dropCorpse(game, wk.it.o); return true; },
});
// drop the body I drag where it is drawn (behind me)
export function dropCorpse(game, c) {
  const v = DRAG.get(c);
  game.net.request('corpse.drag', { id: c.id, on: 0, x: r2(v ? v.x : game.player.x), y: r2(v ? v.y : game.player.y) }, { onReject: (why) => why && err(game, why) });
}
// where a dragged body is drawn: behind its dragger (the side it faces away from), eased (cosmetic, per peer)
const DRAG = new WeakMap();
function draggerOf(game, pid) {
  if (pid === game.net.pid) return game.player;
  return game.session?.players?.get?.(pid)?.ent || null;
}
function dragView(game, c, dt) {
  const e = draggerOf(game, c.dragBy);
  let v = DRAG.get(c);
  if (!v) DRAG.set(c, (v = { x: c.x, y: c.y, view: {} }));
  if (e) {
    const f = e.facing || 's', bx = f === 'e' ? -0.75 : f === 'w' ? 0.75 : 0, by = f === 'n' ? 0.55 : f === 's' ? -0.45 : 0.05;
    const k = 1 - Math.exp(-(dt || 0.016) * 9);
    v.x += (e.x + bx - v.x) * k; v.y += (e.y + by - v.y) * k;
  }
  return v;
}

// "Remover corpo": animals / monsters any time, people only as bones (what it carried falls on the ground; a skeleton gives its bones)
const DISCARD_TIME = { s: 1.2, m: 1.8, l: 2.6, p: 2.2 };
export const discardIt = (c) => ({ o: c, corpse: true, x: c.x, y: c.y, reach: 0.95, kind: 'corpse_discard', verb: 'Remover corpo', icon: 'skull', prio: 0 });
registerWork('corpse_discard', {
  valid: (g, it) => !gone(g, it.o),
  start(game, it) {
    if (gone(game, it.o)) { err(game, 'Já foi removido'); return null; }
    const { need, cycle } = hitsFor(DISCARD_TIME[sizeOf(it.o)] || 2, 2);
    return { type: 'gather_bones', cycle, need, label: 'Removendo o corpo' };
  },
  hit(game, wk) { const c = wk.it.o; game.juice.puff(c.x, c.y, 3, [0.62, 0.55, 0.45], 0.4); },
  finish(game, wk) {
    game.net.request('corpse.discard', { id: wk.it.o.id }, { onReject: (why) => why && err(game, why) });
    return true;
  },
});
// the context menu of a body (desktop right click, touch long press): its usual action + "Remover corpo" (animals,
// monsters, bones) or "Arrastar corpo" (people)
export function corpseMenu(game, c) {
  const out = [], it = describeCorpse(game, c);
  if (!it) return out;
  if (it.kind !== 'corpse_bones' && it.kind !== 'corpse_drag' && it.kind !== 'corpse_discard') out.push({ id: 'use', label: it.verb, icon: 'use', run: () => game.ctl?.interact?.(describeCorpse(game, c)) });
  if (it.kind === 'corpse_drop') return out;
  if (canDrag(game, c)) out.push({ id: 'drag', label: 'Arrastar corpo', icon: 'hand', run: () => game.ctl?.interact?.(dragIt(c)) });
  else if (canDiscard(game, c)) out.push({ id: 'discard', label: it.kind === 'corpse_bones' ? it.verb : 'Remover corpo', icon: 'trash', run: () => game.ctl?.interact?.(it.kind === 'corpse_bones' ? it : discardIt(c)) });
  return out;
}

// ---------- transfer window (container adapter for the chest window) ----------
export function openCorpse(game, c) {
  openContainer(game, corpseAdapter(game, c));
  game.audio?.play('ui_open', { x: c.x, y: c.y });
}

// Body adapter for the container window (src/ui/container.js contract: id, title, label, icon, cols, items(),
// put(i, n), take(i, n), sort(mode), canOpen()). The window refreshes on game.events 'container' { id } (corpse.set),
// sorts the backpack itself, and closes as soon as canOpen() is false (far, dead, or the body is a skeleton).
export function corpseAdapter(game, c) {
  const net = game.net;
  const fail = (t) => (why) => game.events.emit('error', { text: why || t });
  return {
    id: 'corpse:' + c.id, kind: 'corpse', corpseId: c.id,
    title: c.name || 'Corpo', label: c.owner === net.pid ? 'Seu corpo' : 'Corpo', icon: uiIcon(game.A, 'bag'), cols: 6,
    items: () => (c.store ? c.store.slots : []),
    put(i, n) {
      const p = game.player, s = p.inv.slots[i];
      if (!s || !c.store) return false;
      if (c.store.room(s.id) <= 0) { game.events.emit('error', { text: 'Não cabe mais nada' }); return false; }
      const it = n >= s.qty ? p.inv.takeSlot(i) : (p.inv.remove(s.id, n), { id: s.id, qty: n });
      net.request('corpse.put', { id: c.id, item: it.id, qty: it.qty }, { refund: { [it.id]: it.qty }, onReject: fail('Não cabe mais nada') });
      return true;
    },
    take(i, n) {
      const s = c.store?.slots[i];
      if (!s) return false;
      const room = game.player.inv.room(s.id);
      if (room <= 0) { game.events.emit('error', { text: 'Mochila cheia' }); return false; }
      net.request('corpse.take', { id: c.id, slot: i, qty: Math.min(room, n ?? s.qty, s.qty) }, { onReject: fail('Não deu') });
      return true;
    },
    sort(mode) { net.request('store.sort', { kind: 'corpse', id: c.id, mode }, { onReject: fail('Não deu para ordenar') }); },
    canOpen() {
      const p = game.player;
      return !gone(game, c) && !!c.store && !p.dead && ['fresh', 'rotten'].includes(stageOf(game, c)) && Math.hypot(c.x - p.x, c.y - p.y) <= OPEN_REACH;
    },
  };
}

// ---------- system ----------
export function corpsesSystem() {
  let slowT = 0, flyT = 1, rotT = 0;
  return {
    sync: 'all', // drawing / flies (cosmetic) everywhere; expiry after 5 days only on the authority
    update(game, dt) {
      const C = game.corpses;
      if (game.net.auth) {
        slowT -= dt;
        if (slowT <= 0) {
          slowT = 2;
          const ids = [];
          for (const c of C.map.values()) if (corpseAge(game, c) >= DAY_GONE) ids.push(c.id);
          if (ids.length) game.net.emit('corpse.remove', { ids, quiet: 1 });
        }
      }
      // buzzing over rotten bodies near the local player (cosmetic): audio.js re-triggers its 3 s buzz per spot
      // (spaced), so it is fed often; at most the two nearest bodies within 14 tiles
      flyT -= dt;
      if (flyT <= 0) {
        flyT = 0.5;
        const p = game.player;
        let b1 = null, b2 = null, d1 = 14, d2 = 14;
        for (const c of C.map.values()) {
          if (!c.rotten) continue;
          const d = Math.hypot(c.x - p.x, c.y - p.y);
          if (d < d1) { b2 = b1; d2 = d1; b1 = c; d1 = d; } else if (d < d2) { b2 = c; d2 = d; }
        }
        if (b1) game.audio?.play('flies', { x: b1.x, y: b1.y, volume: 0.7 });
        if (b2) game.audio?.play('flies', { x: b2.x, y: b2.y, volume: 0.5 });
      }
      for (let i = C.fading.length - 1; i >= 0; i--) if (game.time - C.fading[i].t0 > 0.6) C.fading.splice(i, 1);
      // dragged bodies follow their draggers (drawn there); the host lets go of a body whose dragger left or died
      let mine = false;
      for (const c of C.map.values()) {
        if (!c.dragBy) { if (DRAG.has(c)) DRAG.delete(c); continue; }
        const v = dragView(game, c, dt), e = draggerOf(game, c.dragBy);
        if (c.dragBy === game.net.pid) mine = true;
        if (game.net.auth && (!e || e.dead)) game.net.emit('corpse.drop', { id: c.id, x: r2(v.x), y: r2(v.y) });
      }
      game._dragCorpse = mine; // (survival.js: dragging a body slows you down)
      // derived, cosmetic: c.rotten = the flies stage (also read by audio code); recomputed from shared time
      rotT -= dt;
      if (rotT <= 0) { rotT = 0.5; for (const c of C.map.values()) { const a = corpseAge(game, c); c.rotten = a >= 0.95 && a < 1.95; } }
    },
    render(game, B, v) {
      const A = game.A, t = game.time, C = game.corpses;
      const nFly = game.quality === 'low' ? 3 : 5;
      for (const c0 of C.map.values()) {
        let c = c0;
        if (c0.dragBy) { const d = DRAG.get(c0); if (d) c = Object.assign(d.view, c0, { x: d.x, y: d.y }); } // (drawn behind its dragger)
        if (c.x < v.x0 - 2 || c.x > v.x1 + 2 || c.y < v.y0 - 2 || c.y > v.y1 + 2) continue;
        const age = corpseAge(game, c0);
        drawCorpse(B, A, c, age, t - (c0._t0 ?? -100), t);
        if (age > 0.9 && age < 2) drawFlies(B, A, c, Math.min(1, (age - 0.9) * 10) * Math.min(1, (2 - age) * 10), t, nFly);
      }
      for (const f of C.fading) {
        const c = f.c;
        if (c.x < v.x0 - 2 || c.x > v.x1 + 2 || c.y < v.y0 - 2 || c.y > v.y1 + 2) continue;
        drawCorpse(B, A, c, Math.min(4.8, corpseAge(game, c)), 99, t, Math.min(1, (t - f.t0) / 0.6));
      }
    },
  };
}
