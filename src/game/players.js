// Every player in the world, for HOST code (AI, respawns, regrowth, decay): the local player plus the
// avatars of synced remote players (session.js keeps `pl.av` at the latest received position — not the
// 120 ms-delayed interpolated copy that is drawn). Never use game.player alone in host-only code.
//
// allPlayers(game) · nearestPlayer(game, x, y, maxD, { alive }) · minPlayerDist(game, x, y)
// inAnyView(game, x, y, mx, my) · hurtPlayer(game, src, target, amount, opts)

import { dealDamage, addDot } from './combat.js';
import { stunPlayer, addBuff } from './player.js';

const SOLO = new WeakMap();
export function allPlayers(game) {
  const s = game.session;
  if (s && s.allList && s.allList.length > 1) return s.allList;
  let l = SOLO.get(game);
  if (!l || l[0] !== game.player) { l = [game.player]; SOLO.set(game, l); }
  return l;
}

export function nearestPlayer(game, x, y, maxD = 1e9, { alive = true } = {}) {
  let best = null, bd = maxD;
  const w = game.world;
  for (const p of allPlayers(game)) {
    if (alive && p.dead) continue;
    const d = Math.hypot(w.dx(p.x, x), p.y - y); // (the planet wraps: docs/STREAMING.md)
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

export function minPlayerDist(game, x, y) {
  let bd = 1e9;
  const w = game.world;
  for (const p of allPlayers(game)) bd = Math.min(bd, Math.hypot(w.dx(p.x, x), p.y - y));
  return bd;
}

// inside the local view (with margins) or inside a 24×14 box around any remote avatar
export function inAnyView(game, x, y, mx = 2, my = 3) {
  const v = game.view(), w = game.world;
  const xv = w.near(x, (v.x0 + v.x1) / 2);
  if (xv > v.x0 - mx && xv < v.x1 + mx && y > v.y0 - my && y < v.y1 + my) return true;
  const L = allPlayers(game);
  for (let i = 1; i < L.length; i++) {
    const p = L[i];
    if (Math.abs(w.dx(x, p.x)) < 12 + mx && Math.abs(y - p.y) < 7 + my) return true;
  }
  return false;
}

// Damage from a host creature to a player. Local player: applied now. Remote: owner message player.hurt
// (the owner rolls dodge / armor / block and applies the extra effects only if the hit landed).
// opts may hold poison / bleed: { dur, tick, dmg } and stun: seconds (already rolled by the attacker).
export function hurtPlayer(game, src, target, amount, opts = {}) {
  // a creature's blow on another creature (monsters vs the settlements' people and back — game/people.js): applied here
  if (target && target !== game.player && !target.pid && target.isMob) return target.proxy ? 0 : dealDamage(game, src, target, amount, opts);
  const hr = game.horses?.hurtRedirect(target, src, amount, opts); // (a mounted player: the horse takes the blow now and then, docs/HORSE.md)
  if (hr != null) return hr;
  if (target === game.player) {
    const got = dealDamage(game, src, target, amount, opts);
    if (got > 0) afterHurt(game, target, src, opts);
    return got;
  }
  if (!target || !target.pid || target.dead) return 0;
  const f = opts.from;
  game.net.toOwner(target.pid, 'player.hurt', {
    src: src?.nid || 0, sx: +(src?.x ?? 0).toFixed(2), sy: +(src?.y ?? 0).toFixed(2), slv: src?.level || 1,
    amount, crit: opts.crit ? 1 : 0, ability: opts.ability || 0, dtype: opts.dtype || 0, ranged: opts.ranged ? 1 : 0,
    from: f ? [+f.x.toFixed(2), +f.y.toFixed(2)] : 0, noDodge: opts.noDodge ? 1 : 0,
    knock: opts.knock != null ? +(+opts.knock).toFixed(2) : undefined, noKnock: opts.noKnock ? 1 : 0, // (the push happens on the owner)
    poison: opts.poison || 0, bleed: opts.bleed || 0, stun: opts.stun || 0, curse: opts.curse || undefined,
  });
  return -1; // resolved on the owner's client
}

// extra effects of a landed creature hit (runs on the owner)
export function afterHurt(game, p, src, opts) {
  if (p.dead) return;
  if (opts.poison) {
    const fresh = !p.buffs.some((b) => b.id === 'poison');
    addDot(game, p, 'poison', { ...opts.poison, src });
    if (fresh) game.events.emit('error', { text: 'Você foi envenenado!' });
  }
  if (opts.bleed) addDot(game, p, 'bleed', { ...opts.bleed, src });
  if (opts.stun) stunPlayer(game, opts.stun);
  // a mummy's curse (game/undead.js): slower for a few seconds (player.js speed)
  if (opts.curse > 0) {
    const fresh = !p.buffs.some((b) => b.id === 'curse');
    addBuff(p, 'curse', Math.min(8, opts.curse));
    if (fresh) game.events.emit('error', { text: 'Maldição da múmia: você está mais lento!' });
  }
}
