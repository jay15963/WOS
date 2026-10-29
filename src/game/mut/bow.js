// Aimed ground throws (Tiro Longo with a bow, Lançar Lança): the shooter sends the aim point and its own damage
// roll; the HOST validates (weapon kind, cooldown, origin, range clamp), rolls the scatter, flies the authoritative
// projectile (projectiles.js fireLob) and, when it lands, applies the hit to the creature nearest to the landing
// point. Guests see cosmetic copies through the projectile fx (['proj', id, 'lob'|'lobs', …], ['pend', …]).
// The arrow is paid by the shooter (request refund on a reject); a lost arrow may be recovered as ground loot.

import { defineIntent } from '../../net/registry.js';
import { ABILITIES } from '../content/combat.js';
import { lobSpec, lobScatter, lobFlight } from '../content/weapons.js';
import { dealDamage, isMob } from '../combat.js';
import { aggro } from '../ai.js';
import { fireLob, hostProjId } from '../projectiles.js';
import { dropLoot } from './loot.js';
import { r3 } from './roll.js';

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const LAST = new Map(); // host: `${pid}|${ability}` → worldTime of the last accepted throw

defineIntent('lob.fire', {
  doc: 'A player fires an aimed ground ability (long shot / spear throw) at a point; the host rolls the scatter, flies the projectile and resolves the hit on landing.',
  args: { ab: "'long_shot'|'throw_spear'", w: 'main-hand item id', x: 'origin x', y: 'origin y', ax: 'aim x', ay: 'aim y', amount: 'rolled damage', crit: '0|1', skin: '0|1 (has a knife)' },
  run(game, a, actor, net) {
    const ab = ABILITIES[a.ab];
    const src = actor.ent;
    if (!ab || !ab.lob || !src) return 'inválido';
    if (src.dead) return 'Você está morto';
    // the host's own hand, or the weapon the owner reports (its equipment is owner state, like its inventory)
    const wid = actor.local ? src.equip?.main : typeof a.w === 'string' ? a.w.slice(0, 40) : null;
    const S = lobSpec(wid);
    if (!S || S.type !== ab.lob) return ab.lob === 'bow' ? 'Sem arco nas mãos' : 'Sem lança nas mãos';
    if (S.open && game.world.roofAtPoint(src.x, src.y)) return 'Teto baixo demais para atirar para o alto';
    const key = actor.pid + '|' + a.ab, last = LAST.get(key);
    if (last != null && game.worldTime - last < (ab.cd || 0) * 0.8) return 'Ainda não está pronto';
    // origin: the shooter's reported position when it agrees with what the host sees
    let ox = num(a.x, src.x), oy = num(a.y, src.y);
    if (Math.hypot(ox - src.x, oy - src.y) > 3) { ox = src.x; oy = src.y; }
    // aim: clamped to the weapon's range
    let dx = num(a.ax, ox) - ox, dy = num(a.ay, oy) - oy, d = Math.hypot(dx, dy);
    if (d < 0.05) { dx = 0; dy = 1; d = 1; }
    const D = Math.min(Math.max(d, 1), S.range);
    const ax = ox + (dx / d) * D, ay = oy + (dy / d) * D;
    // scatter: centre-weighted inside the radius for this distance (host randomness → everybody's same landing)
    const R = lobScatter(S, D), ang = net.roll() * Math.PI * 2, rr = R * net.roll();
    const W = game.world;
    const lx = r3(Math.max(0.5, Math.min(W.W - 0.5, ax + Math.cos(ang) * rr)));
    const ly = r3(Math.max(0.5, Math.min(W.H - 0.5, ay + Math.sin(ang) * rr)));
    const { dur, apex } = lobFlight(S, D);
    LAST.set(key, game.worldTime);
    const id = hostProjId();
    const hit = { ab: a.ab, amount: Math.max(0, Math.min(5000, num(a.amount))), crit: !!a.crit, skin: !!a.skin, ox, oy };
    fireLob(game, { id, proj: S.proj, x: ox, y: oy, lx, ly, dur, apex, src, owner: actor.pid, onLand: (g, pr) => resolve(g, pr, S, hit) });
    const kind = S.proj === 'spear' ? 'lobs' : 'lob';
    net.entsApi?.fx?.(['proj', id, kind, r3(ox), r3(oy), lx, ly, r3(dur), r3(apex), actor.pid], ox, oy, actor.local ? null : actor.pid);
    return { id, lx, ly };
  },
});

// host, on landing: hit the creature closest to the landing point (small radius); a miss startles the ones near
function resolve(game, pr, S, h) {
  const src = pr.src, net = game.net;
  if (src?.gone || pr.blocked) return; // came down on a wall / rock / a mountain roof
  const x = pr.lx, y = pr.ly;
  let best = null, bd = 1e9;
  for (const e of game.entities) {
    if (!isMob(e) || e.dead || e.proxy) continue;
    const d = Math.hypot(e.x - x, e.y - y);
    if (d <= S.hitR + (e.r || 0.3) && d < bd) { bd = d; best = e; }
  }
  const fx = (stuck, px, py) => net.entsApi?.fx?.(['pend', pr.id, r3(px), r3(py), stuck ? 1 : 0, 1], px, py);
  if (best) {
    best.lastHitSkin = h.skin;
    dealDamage(game, src, best, h.amount, { crit: h.crit, ability: h.ab, ranged: true, from: { x: h.ox, y: h.oy }, knock: S.knock });
    game.juice?.chips(best.x, best.y, [0.85, 0.75, 0.55], 4, 0.4);
    if (pr.kind === 'spear') { pr.x = pr.lx = best.x; pr.y = pr.ly = best.y; pr.stuck = true; pr.ground = true; pr.lift = 0.04; fx(true, best.x, best.y); }
    else { pr.alpha = 0; fx(false, x, y); }
    return;
  }
  for (const e of game.entities) {
    if (!isMob(e) || e.dead || e.proxy || e.state === 'chase') continue;
    if (Math.hypot(e.x - x, e.y - y) < 2) aggro(game, e, src, false);
  }
  // a lost arrow on open ground is sometimes recoverable (the spear always flies back to its owner)
  if (pr.kind === 'arrow' && pr.stuck && pr.ground && net.roll() < 0.5) {
    game.later(0.6, () => {
      dropLoot(game, x, y, 'arrow', 1, 0.15);
      pr.alpha = 0;
      fx(false, x, y);
    });
  }
}
