// Owner effects: the only place where replicated ops touch the LOCAL player (docs/SYNC.md §3.2 rule 6).
// Any op may carry { by, xp, give: {item: qty}, giveAt: [x, y], toast, toastKind, tip: [key, text, max, kind],
// quiet, respawn: bedId }. After the applier ran, the peer whose net.pid === args.by calls
// applyOwnerEffects(game, args). Owner messages (host → one player): defineOwn handlers below.

import { gainXp } from '../player.js';
import { defineOwn } from '../../net/registry.js';
import { dealDamage } from '../combat.js';
import { afterHurt } from '../players.js';
import { findMob } from './combat.js';

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// add items to the local inventory; what does not fit is dropped (loot.drop intent) at `at` or the player
export function giveItems(game, items, at = null, quiet = false) {
  const p = game.player;
  let any = false;
  for (const id in items) {
    const n = items[id] | 0;
    if (n <= 0) continue;
    const left = p.inv.add(id, n);
    if (n - left > 0) { any = true; if (!quiet) game.events.emit('loot', { item: id, qty: n - left }); }
    if (left > 0) {
      const x = at ? at[0] : p.x, y = at ? at[1] : p.y;
      game.net.request('loot.drop', { item: id, qty: left, x, y, spread: 0.6, split: 1 });
    }
  }
  if (any) game.events.emit('inventory', {});
}

export function applyOwnerEffects(game, a) {
  if (a.xp > 0) gainXp(game, a.xp);
  if (a.give) giveItems(game, a.give, a.giveAt || null, !!a.quiet);
  if (a.respawn) game.player.respawn = a.respawn; // a bed the player built
  if (a.toast) game.events.emit('toast', { text: a.toast, kind: a.toastKind || 'good' });
  if (Array.isArray(a.tip)) {
    const [key, text, max = 1, kind = 'warn'] = a.tip;
    const h = game.ctl?.hinted;
    const k = (h && h[key]) || 0;
    if (h && k < max) { h[key] = k + 1; game.events.emit('toast', { text, kind }); }
  }
}

// ---------- owner messages ----------
const dotArg = (d) => (d && typeof d === 'object' ? { dur: Math.min(30, num(d.dur, 6)), tick: Math.max(0.2, num(d.tick, 1)), dmg: Math.min(500, num(d.dmg, 1)) } : null);

// A host creature hit THIS player: the owner rolls dodge / armor / block (dealDamage) and applies the
// extra effects (poison, bleed, stun) only when the hit landed.
defineOwn('player.hurt', {
  doc: 'Damage from a host creature to the owning player.',
  args: { src: 'mobNid|0', sx: 'x', sy: 'y', slv: 'level', amount: 'number', crit: '0|1', ability: 'string|0', dtype: 'string|0', ranged: '0|1', from: '[x, y]|0', noDodge: '0|1', poison: '{dur,tick,dmg}|0', bleed: '{dur,tick,dmg}|0', stun: 'seconds|0' },
  apply(game, a) {
    const p = game.player;
    if (p.dead) return;
    const src = findMob(game, a.src) || { x: num(a.sx, p.x), y: num(a.sy, p.y), level: num(a.slv, 1), r: 0.3 };
    const amount = Math.max(0, Math.min(5000, num(a.amount)));
    const opts = {
      crit: !!a.crit, ability: a.ability || undefined, dtype: a.dtype || undefined, ranged: !!a.ranged, noDodge: !!a.noDodge,
      from: Array.isArray(a.from) ? { x: num(a.from[0], src.x), y: num(a.from[1], src.y) } : undefined,
    };
    const got = dealDamage(game, src, p, amount, opts);
    if (got > 0) afterHurt(game, p, src, { poison: dotArg(a.poison), bleed: dotArg(a.bleed), stun: Math.min(5, num(a.stun)) });
  },
});
