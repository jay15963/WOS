// Projectiles: arrows and thrown spears flying in world space with a slight arc (lift), rotated to their
// screen-space velocity, colliding with creatures, walls/rock (world.blocked) and solid props (trunks, tents).
// Stuck player arrows are sometimes recoverable as `arrow` loot. Simulation + a render hook (B.main / B.blob).
//
// fireArrow(game, { src, faction:'player'|'bandit', x, y, tx, ty, angle?, target?, range?, speed?, kind?:'arrow'|'spear',
//                   onHit(game, entity, proj), onMiss?(game, proj), cosmetic?, id? })
// Multiplayer: creature shots are simulated by the host (victims: every player, damage via hurtPlayer) and
// shown on guests as COSMETIC copies (fx 'proj' / 'pend' from net/entities.js); a player's own arrows are
// simulated by the shooter (hits → mob.hit) and relayed to the others as cosmetic copies (intent proj.fire).
// A cosmetic projectile never tests victims, calls onHit/onMiss or drops loot.

import { dropLoot } from './loot.js';
import { allPlayers } from './players.js';

let projSeq = 0;

const STEP = 0.22;          // collision sub-step (tiles)
const STUCK_LIFE = 5;       // seconds a stuck arrow stays visible
const H0 = 0.8;             // release height (bow / shoulder)

export function fireArrow(game, o) {
  const P = game.projectiles || (game.projectiles = []);
  let ux = o.tx - o.x, uy = o.ty - o.y;
  const L = Math.hypot(ux, uy) || 1;
  ux /= L; uy /= L;
  if (o.angle) { const c = Math.cos(o.angle), s = Math.sin(o.angle); const rx = ux * c - uy * s; uy = ux * s + uy * c; ux = rx; }
  const speed = o.speed || (o.kind === 'spear' ? 13 : 17);
  const maxD = o.range ?? 12;
  const arcD = Math.max(1.2, Math.min(maxD, L));
  const pr = {
    kind: o.kind || 'arrow', src: o.src, faction: o.faction || 'player', target: o.target || null,
    x: o.x + ux * 0.3, y: o.y + uy * 0.3 - 0.02, ox: o.x, oy: o.y, ux, uy, speed,
    d: 0, maxD, arcD, arcH: Math.min(0.9, 0.05 * arcD + 0.08), h1: o.target ? 0.5 * (o.target.scale || 1) : 0.35,
    lift: H0, rot: Math.atan2(uy, ux), stuck: false, t: 0, alpha: 1, onHit: o.onHit, onMiss: o.onMiss,
    cosmetic: !!o.cosmetic, id: o.id || null,
  };
  P.push(pr);
  if (P.length > 80) P.splice(0, P.length - 80);
  if (!pr.cosmetic) {
    const net = game.net, args = [pr.kind, +o.x.toFixed(2), +o.y.toFixed(2), +o.tx.toFixed(2), +o.ty.toFixed(2), +(o.angle || 0).toFixed(3), speed, maxD, pr.faction, +pr.h1.toFixed(2)];
    if (pr.faction !== 'player') {
      if (net.auth && game.session) { pr.id = 'h' + (++projSeq).toString(36); net.entsApi?.fx?.(['proj', pr.id, ...args], pr.x, pr.y); }
    } else if (game.session && game.session.state !== 'closed') {
      pr.id = net.pid + ':' + (++projSeq).toString(36);
      net.request('proj.fire', { id: pr.id, a: args });
    }
  }
  return pr;
}

// a projectile seen by another peer (no gameplay effect)
export function fireCosmetic(game, id, a) {
  if (!Array.isArray(a)) return null;
  const n = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const [kind, x, y, tx, ty, angle, speed, range, faction, h1] = a;
  const pr = fireArrow(game, { id, cosmetic: true, kind: kind === 'spear' ? 'spear' : 'arrow', x: n(x), y: n(y), tx: n(tx), ty: n(ty), angle: n(angle), speed: n(speed, 17), range: n(range, 12), faction: faction === 'player' ? 'player' : 'bandit' });
  pr.h1 = n(h1, 0.35);
  return pr;
}

// authority: where a creature shot ended (cosmetic copies on guests follow)
export function endCosmetic(game, id, x, y, stuck, ground) {
  const P = game.projectiles;
  if (!P) return;
  const pr = P.find((q) => q.id === id && q.cosmetic);
  if (!pr) return;
  if (!stuck) { P.splice(P.indexOf(pr), 1); return; }
  pr.x = x; pr.y = y; pr.stuck = true; pr.t = 0; pr.ground = !!ground;
  if (ground) pr.lift = 0.04;
}

function reportEnd(game, pr, stuck, ground) {
  if (pr.cosmetic || !pr.id || pr.faction === 'player' || !game.net.auth) return;
  game.net.entsApi?.fx?.(['pend', pr.id, +pr.x.toFixed(2), +pr.y.toFixed(2), stuck ? 1 : 0, ground ? 1 : 0], pr.x, pr.y);
}

function liftAt(pr, d) {
  const k = d / pr.arcD;
  if (k <= 1) return H0 + (pr.h1 - H0) * k + pr.arcH * 4 * k * (1 - k);
  return pr.h1 - (d - pr.arcD) * 0.45; // past the aim point: keep dropping
}

function hitsSolidObject(world, x, y, lift) {
  let hit = null;
  world.forChunks(x - 1.2, y - 1.2, x + 1.2, y + 1.2, (c) => {
    if (hit) return;
    for (const o of c.objects) {
      if (!o.solid || o.stump || o.fall || o.broken) continue;
      const tall = o.type?.startsWith?.('tree_') ? 3 : o.isProp ? 0.7 : 1.1;
      if (lift > tall) continue;
      const dx = x - o.x, dy = y - o.y, rr = o.solid + 0.04;
      if (dx * dx + dy * dy < rr * rr) { hit = o; return; }
    }
  });
  return hit;
}

function stick(game, pr, ground) {
  pr.stuck = true; pr.t = 0;
  pr.ground = ground;
  if (ground) pr.lift = 0.04;
  game.audio?.play(ground ? 'step' : 'chop', { x: pr.x, y: pr.y, volume: 0.35 });
  if (pr.cosmetic) return;
  reportEnd(game, pr, true, ground);
  if (pr.faction === 'player' && pr.kind === 'arrow' && Math.random() < (ground ? 0.5 : 0.3)) {
    pr.recover = true; // becomes a pickable arrow after a beat (shooter's side: loot.drop)
  }
  pr.onMiss?.(game, pr);
  pr.onMiss = null;
}

export function projectilesSystem() {
  return {
    sync: 'all', // flight on every peer; hits resolved by the shooter (players) or the host (creatures)
    update(game, dt) {
      const P = game.projectiles;
      if (!P || !P.length) return;
      const w = game.world, p = game.player, E = game.entities, PL = allPlayers(game);
      for (let i = P.length - 1; i >= 0; i--) {
        const pr = P[i];
        pr.t += dt;
        if (pr.stuck) {
          if (pr.recover && pr.t > 0.6) {
            dropLoot(game, pr.x, pr.y, 'arrow', 1, 0.15);
            P.splice(i, 1);
            continue;
          }
          if (pr.t > STUCK_LIFE) { pr.alpha -= dt * 2; if (pr.alpha <= 0) P.splice(i, 1); }
          continue;
        }
        // soft homing for the player's aimed arrows (keeps mobile aim forgiving; walls/trunks still stop them)
        const T = pr.target;
        if (T && !T.dead && !T.broken && pr.faction === 'player') {
          const dx = T.x - pr.x, dy = T.y - pr.y, L = Math.hypot(dx, dy);
          if (L > 0.3) {
            const k = Math.min(1, dt * 7);
            let nx = pr.ux + (dx / L - pr.ux) * k, ny = pr.uy + (dy / L - pr.uy) * k;
            const nl = Math.hypot(nx, ny) || 1;
            pr.ux = nx / nl; pr.uy = ny / nl;
          }
        }
        let travel = pr.speed * dt;
        let done = false;
        while (travel > 0 && !done) {
          const s = Math.min(STEP, travel);
          travel -= s;
          const nx = pr.x + pr.ux * s, ny = pr.y + pr.uy * s;
          const nd = pr.d + s;
          const nl = liftAt(pr, nd);
          // walls / rock
          const tx = Math.floor(nx), ty = Math.floor(ny);
          if (!w.inBounds(tx, ty) || w.rock[ty * w.W + tx] || w.solid[ty * w.W + tx]) { stick(game, pr, false); done = true; break; }
          // creatures / players (cosmetic copies hit nothing)
          let victim = null;
          if (pr.cosmetic) { /* no victims */ }
          else if (pr.faction === 'player') {
            for (const e of E) {
              if (e === pr.src || e === p || e.dead || !(e.isMob || e.kind === 'animal')) continue;
              const dx = e.x - nx, dy = e.y - ny, rr = e.r + 0.16;
              if (dx * dx + dy * dy < rr * rr && nl < 1.25 * (e.scale || 1) + 0.4) { victim = e; break; }
            }
          } else {
            for (const q of PL) {
              if (q.dead) continue;
              const dx = q.x - nx, dy = q.y - ny, rr = (q.r || 0.24) + 0.14;
              if (dx * dx + dy * dy < rr * rr) { victim = q; break; }
            }
          }
          if (victim && pr.d > 0.25) {
            pr.x = nx; pr.y = ny;
            pr.onHit?.(game, victim, pr);
            reportEnd(game, pr, false, false);
            game.juice.chips(nx, ny, [0.85, 0.75, 0.55], 3, nl);
            P.splice(i, 1);
            done = true;
            break;
          }
          // trunks, boulders, tents, crates
          const ob = pr.d > 0.4 ? hitsSolidObject(w, nx, ny, nl) : null;
          if (ob) {
            pr.x = nx - pr.ux * 0.12; pr.y = ny - pr.uy * 0.12;
            if (ob.isProp && pr.faction === 'player' && pr.src && !pr.cosmetic) pr.onHit?.(game, ob, pr);
            else stick(game, pr, false);
            if (ob.isProp) { if (!pr.stuck) reportEnd(game, pr, false, false); P.splice(i, 1); }
            done = true;
            break;
          }
          const sl = pr.lift;
          pr.x = nx; pr.y = ny; pr.d = nd; pr.lift = nl;
          // screen-space direction: ground velocity minus the lift change
          pr.rot = Math.atan2(pr.uy * s - (nl - sl), pr.ux * s);
          if (nl <= 0.03 || nd >= pr.maxD + 4) { stick(game, pr, true); done = true; break; }
        }
      }
    },

    // Optional core hook (see report): systems may add y-sorted drawables { x, y, type, draw(B, A, t) } to the
    // render list. When the core calls it, render() below skips the late (unsorted) draw for this frame.
    collect(game, list, v) {
      const P = game.projectiles;
      if (!P || !P.length) return;
      game._projSorted = game.time;
      const pool = game._projPool || (game._projPool = []);
      let n = 0;
      for (const pr of P) {
        if (pr.x < v.x0 - 1 || pr.x > v.x1 + 1 || pr.y < v.y0 - 1 || pr.y > v.y1 + 2) continue;
        const d = pool[n] || (pool[n] = { type: 'fx_proj', x: 0, y: 0, pr: null, draw(B, A) { drawProjectile(game, B, A, this.pr); } });
        d.pr = pr; d.x = pr.x; d.y = pr.y + 0.05; n++;
        list.push(d);
      }
    },

    render(game, B, v) {
      const P = game.projectiles;
      if (!P || !P.length) return;
      const A = game.A;
      if (game._projSorted === game.time) { // drawn y-sorted already; shadows still go to the blob batch here
        drawShadows(game, B, A, v);
        return;
      }
      drawShadows(game, B, A, v);
      for (const pr of P) {
        if (pr.x < v.x0 - 1 || pr.x > v.x1 + 1 || pr.y < v.y0 - 1 || pr.y > v.y1 + 2) continue;
        drawProjectile(game, B, A, pr);
      }
    },
  };
}

function drawShadows(game, B, A, v) {
  const blob = A.has('fx_blob') ? A.get('fx_blob') : null;
  if (!blob) return;
  for (const pr of game.projectiles) {
    if (pr.stuck || pr.x < v.x0 - 1 || pr.x > v.x1 + 1 || pr.y < v.y0 - 1 || pr.y > v.y1 + 2) continue;
    // shadow on the ground under the shaft (sizes are multiples of the sprite's own size)
    B.blob.add(blob, pr.x, pr.y, 0.5 / blob.w, 0.09 / blob.h, 1, 1, 1, 0.45 * Math.max(0.25, 1 - pr.lift / 2));
  }
}

function drawProjectile(game, B, A, pr) {
  const arrow = A.has('proj_arrow') ? A.get('proj_arrow') : null;
  const spear = A.has('proj_spear') ? A.get('proj_spear') : arrow;
  const spark = A.has('fx_spark') ? A.get('fx_spark') : null;
  const a = Math.max(0, pr.alpha);
  let rot = pr.rot;
  if (pr.stuck && pr.ground) rot = Math.atan2(Math.abs(Math.sin(pr.rot)) * 0.3 + 0.55, Math.cos(pr.rot) || 0.01);
  const lift = pr.lift;
  const spr = pr.kind === 'spear' ? spear : arrow;
  if (spr) {
    const sc = pr.kind === 'spear' && spr === arrow ? 1.5 : 1;
    B.main.add(spr, pr.x, pr.y, sc, sc, 1, 1, 1, a, 0, rot, 0, 1, 0, lift);
  } else if (spark) {
    // stand-in until proj_arrow exists: a dark shaft streak + a pale fletch/tip glint
    const len = pr.kind === 'spear' ? 1.25 : 0.78, th = pr.kind === 'spear' ? 0.1 : 0.075;
    const cx = Math.cos(rot) * len * 0.42, cy = Math.sin(rot) * len * 0.42;
    B.main.add(spark, pr.x, pr.y, len / spark.w, th / spark.h, 0.34, 0.24, 0.14, a, 0, rot, 0, 1, 0, lift);
    B.main.add(spark, pr.x + cx, pr.y + cy, 0.16 / spark.w, 0.1 / spark.h, 0.85, 0.85, 0.8, a, 0, rot, 0, 1, 0, lift);
    B.main.add(spark, pr.x - cx, pr.y - cy, 0.16 / spark.w, 0.13 / spark.h, 0.9, 0.86, 0.78, a * 0.9, 0, rot, 0, 1, 0, lift);
  }
}
