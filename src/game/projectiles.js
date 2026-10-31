// Projectiles: arrows and thrown spears flying in world space with a slight arc (lift), rotated to their
// screen-space velocity, colliding with creatures, walls/rock (world.blocked) and solid props (trunks, tents).
// Stuck player arrows are sometimes recoverable as `arrow` loot. Simulation + a render hook (B.main / B.blob).
//
// fireArrow(game, { src, faction:'player'|'bandit', x, y, tx, ty, angle?, target?, range?, speed?, kind?:'arrow'|'spear',
//                   onHit(game, entity, proj), onMiss?(game, proj), cosmetic?, id?, z0?, z1? })
// levels: z0 / z1 = stories of the shooter / the aim point (default: the source's / the target's z). The shaft
// flies that line (pr.pz), is blocked by level-0 walls only below their top and hits entities near its height.
// Multiplayer: creature shots are simulated by the host (victims: every player, damage via hurtPlayer) and
// shown on guests as COSMETIC copies (fx 'proj' / 'pend' from net/entities.js); a player's own arrows are
// simulated by the shooter (hits → mob.hit) and relayed to the others as cosmetic copies (intent proj.fire).
// A cosmetic projectile never tests victims, calls onHit/onMiss or drops loot.
// Lobbed shots (fireLob: Tiro Longo / Lançar Lança) fly a timed parabola to a host-rolled landing point instead
// (see the section below and src/game/mut/bow.js).

import { dropLoot } from './loot.js';
import { allPlayers } from './players.js';
import { STORY_H } from './levels.js';

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
  const speed = o.speed || (o.kind === 'spear' || o.kind === 'ice_spear' ? 13 : 17);
  const maxD = o.range ?? 12;
  const arcD = Math.max(1.2, Math.min(maxD, L));
  const pr = {
    kind: o.kind || 'arrow', src: o.src, faction: o.faction || 'player', target: o.target || null,
    x: o.x + ux * 0.3, y: o.y + uy * 0.3 - 0.02, ox: o.x, oy: o.y, ux, uy, speed,
    d: 0, maxD, arcD, arcH: Math.min(0.9, 0.05 * arcD + 0.08), h1: o.target ? 0.5 * (o.target.scale || 1) : 0.35,
    lift: H0, rot: Math.atan2(uy, ux), vgx: ux, vgy: uy, vl: 0, stuck: false, t: 0, alpha: 1, onHit: o.onHit, onMiss: o.onMiss,
    cosmetic: !!o.cosmetic, id: o.id || null,
    z0: o.z0 ?? (o.src?.z || 0), z1: o.z1 ?? (o.target ? o.target.z || 0 : o.src?.z || 0), zL: L, pz: 0, // levels: heights
  };
  pr.pz = pr.z0;
  P.push(pr);
  if (P.length > 80) P.splice(0, P.length - 80);
  if (!pr.cosmetic) {
    const net = game.net, args = [pr.kind, +o.x.toFixed(2), +o.y.toFixed(2), +o.tx.toFixed(2), +o.ty.toFixed(2), +(o.angle || 0).toFixed(3), speed, maxD, pr.faction, +pr.h1.toFixed(2)];
    if (pr.z0 || pr.z1) args.push(Math.round(pr.z0 * 100), Math.round(pr.z1 * 100)); // levels: heights (trailing, ×100)
    if (pr.faction !== 'player') {
      if (net.auth && game.session) { pr.id = 'h' + (++projSeq).toString(36); net.entsApi?.fx?.(['proj', pr.id, ...args], pr.x, pr.y); }
    } else if (game.session && game.session.state !== 'closed') {
      pr.id = net.pid + ':' + (++projSeq).toString(36);
      net.request('proj.fire', { id: pr.id, a: args });
    }
  }
  return pr;
}

// id for a projectile created by the authority (creature shots, lobbed player shots)
export const hostProjId = () => 'h' + (++projSeq).toString(36);

// ---------- lobbed shots (aimed ground abilities: Tiro Longo, Lançar Lança) ----------
// A parabola from (x, y) to the landing point (lx, ly) in `dur` s with apex height `apex` (tiles). The HOST owns the
// outcome (mut/bow.js rolls the landing point, its copy calls onLand to resolve the hit); every other peer flies a
// cosmetic copy from fx ['proj', id, 'lob'|'lobs', x, y, lx, ly, dur, apex, ownerPid]. The shooter's own copy
// starts at once toward the aim point and is bent onto the host's landing point by retargetLob() on the ack.
// o: { id, proj: 'arrow'|'spear', x, y, lx, ly, dur, apex, cosmetic, src, owner, onLand(game, pr) }
export function fireLob(game, o) {
  const P = game.projectiles || (game.projectiles = []);
  const gx = o.lx - o.x, gy = o.ly - o.y, gl = Math.hypot(gx, gy) || 1;
  const pr = {
    lob: true, kind: o.proj === 'spear' ? 'spear' : 'arrow', faction: 'player', id: o.id || null, cosmetic: !!o.cosmetic,
    src: o.src || null, owner: o.owner || null, onLand: o.onLand || null,
    x: o.x, y: o.y, x0: o.x, y0: o.y, ax: o.lx, ay: o.ly, lx: o.lx, ly: o.ly, k0: 0, k: 0,
    dur: Math.max(0.1, o.dur), apex: Math.max(0, o.apex), t: 0, lift: H0, rot: Math.atan2(gy - 2 * o.apex, gx), vgx: gx, vgy: gy, vl: 2 * o.apex,
    gdir: Math.atan2(gy / gl, gx / gl), stuck: false, ground: false, alpha: 1, d: 0, whoosh: false, pend: null,
  };
  P.push(pr);
  if (P.length > 80) P.splice(0, P.length - 80);
  return pr;
}

// the shooter's predicted copy learns the host's landing point (bends smoothly from here on)
export function retargetLob(pr, lx, ly, id) {
  if (!pr || !pr.lob) return;
  if (id) pr.id = id;
  if (pr.stuck) { pr.x = pr.lx = lx; pr.y = pr.ly = ly; return; }
  // keep the current position: fold the old correction into the aim path, then blend toward the new point
  const w = blendW(pr, pr.k);
  pr.ax += (pr.lx - pr.ax) * w; pr.ay += (pr.ly - pr.ay) * w;
  pr.k0 = pr.k; pr.lx = lx; pr.ly = ly;
}

const blendW = (pr, k) => (pr.k0 >= 1 ? 1 : Math.max(0, Math.min(1, (k - pr.k0) / (1 - pr.k0))));
const lobLift = (pr, k) => H0 * (1 - k) + 4 * pr.apex * k * (1 - k);
function lobAt(pr, k, out) {
  const w = blendW(pr, k);
  out[0] = pr.x0 + (pr.ax - pr.x0) * k + (pr.lx - pr.ax) * w;
  out[1] = pr.y0 + (pr.ay - pr.y0) * k + (pr.ly - pr.ay) * w;
  out[2] = lobLift(pr, k);
  return out;
}
const _a = [0, 0, 0], _b = [0, 0, 0];

// one frame of a lobbed shot; true = remove it
function stepLob(game, pr, dt) {
  pr.t += dt;
  if (pr.stuck) {
    if (pr.kind === 'spear') { if (pr.t > 0.35) pr.alpha -= dt / 0.45; } // the spear returns to the hand
    else if (pr.t > STUCK_LIFE) pr.alpha -= dt * 2;
    return pr.alpha <= 0;
  }
  const k = Math.min(1, pr.t / pr.dur);
  lobAt(pr, k, _a);
  lobAt(pr, Math.max(0, k - 0.02), _b);
  pr.x = _a[0]; pr.y = _a[1]; pr.lift = _a[2]; pr.k = k;
  // screen-space direction: ground motion minus the lift change
  const vx = _a[0] - _b[0], vy = (_a[1] - _b[1]) - (_a[2] - _b[2]);
  if (vx * vx + vy * vy > 1e-8) { pr.rot = Math.atan2(vy, vx); pr.vgx = vx; pr.vgy = _a[1] - _b[1]; pr.vl = _a[2] - _b[2]; } // (vg*, vl: a turned camera re-aims it)
  if (!pr.whoosh && k > 0.42) { pr.whoosh = true; game.audio?.play('arrow_whoosh', { x: pr.x, y: pr.y, volume: pr.kind === 'spear' ? 0.9 : 0.6 }); }
  if (pr.kind === 'arrow' && pr.lift > 0.6 && game.juice) {
    const sp = game.juice.spr('fx_soft');
    if (sp && (pr._tr = (pr._tr || 0) + dt) > 0.035) {
      pr._tr = 0;
      game.juice.emit({ spr: sp, x: pr.x, y: pr.y, life: 0.32, size: 0.22, size1: 0.05, r: 1, g: 0.97, b: 0.88, a: 0.42, a1: 0, lift: pr.lift, ground: false });
    }
  }
  if (k < 1) return false;
  return landLob(game, pr);
}

function landLob(game, pr) {
  const w = game.world, J = game.juice;
  pr.x = pr.lx; pr.y = pr.ly; pr.t = 0;
  const tx = Math.floor(pr.x), ty = Math.floor(pr.y);
  const inside = w.inBounds(tx, ty);
  const i = inside ? ty * w.W + tx : -1;
  // a roof (mountain ceiling or built roof) stops a shot coming from outside (a throw inside lands normally)
  const roofed = inside && w.roofAt(tx, ty) !== 0 && !w.roofAt(Math.floor(pr.x0), Math.floor(pr.y0));
  const wall = !inside || w.rock[i] || w.solid[i] || roofed;
  pr.blocked = !!wall;
  const water = inside && !wall && w.liquidAt(tx, ty) > 0; // (frozen: it lands on the ice)
  game.audio?.play('arrow_land', { x: pr.x, y: pr.y, volume: pr.kind === 'spear' ? 1.1 : 0.7 });
  let gone = false;
  if (water) { J?.splash(pr.x, pr.y, pr.kind === 'spear' ? 0.9 : 0.55); gone = true; }
  else {
    pr.stuck = true; pr.ground = !wall;
    pr.lift = wall ? 0.6 : 0.04;
    J?.puff(pr.x, pr.y, pr.kind === 'spear' ? 5 : 2, [0.62, 0.55, 0.45], pr.kind === 'spear' ? 0.45 : 0.3);
  }
  if (pr.owner && pr.kind === 'spear') game.events?.emit('spearback', { pid: pr.owner });
  if (!pr.cosmetic) { pr.onLand?.(game, pr); pr.onLand = null; }
  // the host's word on how it ended (hit → removed / moved) arrived before this copy landed
  const e = pr.pend;
  if (e) { pr.pend = null; if (!e.stuck) gone = true; else { pr.x = pr.lx = e.x; pr.y = pr.ly = e.y; pr.stuck = true; } }
  return gone;
}

// a projectile seen by another peer (no gameplay effect)
export function fireCosmetic(game, id, a) {
  if (!Array.isArray(a)) return null;
  const n = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  if (a[0] === 'lob' || a[0] === 'lobs') {
    const [kind, x, y, lx, ly, dur, apex, owner] = a;
    return fireLob(game, { id, cosmetic: true, proj: kind === 'lobs' ? 'spear' : 'arrow', x: n(x), y: n(y), lx: n(lx), ly: n(ly),
      dur: Math.min(4, Math.max(0.1, n(dur, 1))), apex: Math.min(8, Math.max(0, n(apex, 1))), owner: typeof owner === 'string' ? owner.slice(0, 40) : null });
  }
  const [kind, x, y, tx, ty, angle, speed, range, faction, h1, z0, z1] = a;
  const zc = (v) => Math.max(0, Math.min(3, n(v) / 100)); // levels: heights of the shot (stories)
  const pr = fireArrow(game, { id, cosmetic: true, kind: kind === 'spear' || kind === 'ice_spear' ? kind : 'arrow', x: n(x), y: n(y), tx: n(tx), ty: n(ty), angle: n(angle), speed: n(speed, 17), range: n(range, 12), faction: faction === 'player' ? 'player' : 'bandit', z0: zc(z0), z1: zc(z1) });
  pr.h1 = n(h1, 0.35);
  return pr;
}

// authority: where a creature shot ended (cosmetic copies on guests follow)
export function endCosmetic(game, id, x, y, stuck, ground) {
  const P = game.projectiles;
  if (!P) return;
  const pr = P.find((q) => q.id === id && q.cosmetic);
  if (!pr) return;
  if (pr.lob && !pr.stuck) { pr.pend = { x, y, stuck }; return; } // still in the air here: applied on landing
  if (!stuck) { P.splice(P.indexOf(pr), 1); return; }
  if (pr.lob) { pr.x = pr.lx = x; pr.y = pr.ly = y; return; }
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
  if (ground) { pr.lift = 0.04; pr.pz = 0; } // levels: lies on the ground
  game.audio?.play(ground ? 'arrow_ground' : 'arrow_wood', { x: pr.x, y: pr.y, volume: 0.8 });
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
        if (pr.lob) { if (stepLob(game, pr, dt)) P.splice(i, 1); continue; }
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
          const pz = pr.z0 === pr.z1 ? pr.z0 : pr.z0 + (pr.z1 - pr.z0) * Math.min(1, nd / Math.max(0.5, pr.zL)); // levels: shot height
          // walls / rock (a level-0 wall only below its top: shots from / to a rampart fly over the walls)
          const tx = Math.floor(nx), ty = Math.floor(ny);
          if (!w.inBounds(tx, ty) || w.rock[ty * w.W + tx] || (w.solid[ty * w.W + tx] && pz < 0.5)) { stick(game, pr, false); done = true; break; }
          // creatures / players (cosmetic copies hit nothing)
          let victim = null;
          if (pr.cosmetic) { /* no victims */ }
          else if (pr.faction === 'player') {
            for (const e of E) {
              if (e === pr.src || e === p || e.dead || !(e.isMob || e.kind === 'animal')) continue;
              const dx = e.x - nx, dy = e.y - ny, rr = e.r + 0.16;
              if (dx * dx + dy * dy < rr * rr && nl < 1.25 * (e.scale || 1) + 0.4 && Math.abs((e.z || 0) - pz) < 0.75) { victim = e; break; }
            }
          } else {
            for (const q of PL) {
              if (q.dead) continue;
              const dx = q.x - nx, dy = q.y - ny, rr = (q.r || 0.24) + 0.14;
              if (dx * dx + dy * dy < rr * rr && Math.abs((q.z || 0) - pz) < 0.75) { victim = q; break; }
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
          // trunks, boulders, tents, crates (an arrow shot at a target threads past them: the line of fire already
          // checked walls and rock — trunks used to eat most shots in a forest)
          const ob = pr.d > 0.4 && !(pr.target && pr.faction === 'player') ? hitsSolidObject(w, nx, ny, nl) : null;
          if (ob) {
            pr.x = nx - pr.ux * 0.12; pr.y = ny - pr.uy * 0.12;
            if (ob.isProp && pr.faction === 'player' && pr.src && !pr.cosmetic) pr.onHit?.(game, ob, pr);
            else stick(game, pr, false);
            if (ob.isProp) { if (!pr.stuck) reportEnd(game, pr, false, false); P.splice(i, 1); }
            done = true;
            break;
          }
          const sl = pr.lift;
          pr.x = nx; pr.y = ny; pr.d = nd; pr.lift = nl; pr.pz = pz;
          // screen-space direction: ground velocity minus the lift change
          pr.rot = Math.atan2(pr.uy * s - (nl - sl), pr.ux * s);
          pr.vgx = pr.ux * s; pr.vgy = pr.uy * s; pr.vl = nl - sl; // (ground motion + lift change: a turned camera re-aims it)
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
        // (zkRot: a turned camera sorts by the turned ground point plus the same bias)
        const d = pool[n] || (pool[n] = { type: 'fx_proj', x: 0, y: 0, pr: null, bias: 0, draw(B, A) { drawProjectile(game, B, A, this.pr); }, zkRot(rc, rs) { return -rs * this.pr.x + rc * this.pr.y + this.bias; } });
        d.bias = 0.05 + (pr.lob && !pr.stuck ? pr.lift * 0.8 : 0) + (pr.pz || 0);
        d.pr = pr; d.x = pr.x; d.y = pr.y + d.bias; n++; // high lobs draw over trees; levels: +1 tile of depth per story
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
    if (pr.lob) {
      // lob: the shadow slides along the ground path, longer and softer the higher the shaft flies
      const L = pr.kind === 'spear' || pr.kind === 'ice_spear' ? 1.3 : 0.85, h = Math.max(0, pr.lift);
      const a = Math.max(0.6, 1 - h / 7);
      B.blob.add(blob, pr.x, pr.y, (L + h * 0.06) / blob.w, (0.2 + h * 0.03) / blob.h, 1, 1, 1, a, 0, pr.gdir - (game.cam.rot || 0)); // (screen angle)
      continue;
    }
    // shadow on the ground under the shaft (sizes are multiples of the sprite's own size)
    B.blob.add(blob, pr.x, pr.y, 0.5 / blob.w, 0.09 / blob.h, 1, 1, 1, 0.45 * Math.max(0.25, 1 - pr.lift / 2));
  }
}

function drawProjectile(game, B, A, pr) {
  const arrow = A.has('proj_arrow') ? A.get('proj_arrow') : null;
  const spear = A.has('proj_spear') ? A.get('proj_spear') : arrow;
  const spark = A.has('fx_spark') ? A.get('fx_spark') : null;
  const ice = pr.kind === 'ice_spear'; // winter walkers' ice spear (art: proj_ice_spear, else the spear)
  const a = Math.max(0, pr.alpha);
  // camera turned: the screen direction = the world motion turned into the view, minus the lift change
  const yaw = game.cam.rot || 0;
  let rv = pr.rot;
  if (yaw && pr.vgx != null) { const [vx, vy] = game.toViewDir(pr.vgx, pr.vgy); if (vx * vx + vy * vy > 1e-10 || pr.vl) rv = Math.atan2(vy - pr.vl, vx); }
  let rot = rv;
  if (pr.stuck && pr.ground) rot = Math.atan2(Math.abs(Math.sin(rv)) * 0.3 + 0.55, Math.cos(rv) || 0.01);
  let lift = pr.lift + (pr.pz || 0) * STORY_H; // levels: shots from / to a height
  const spr = ice ? (A.has('proj_ice_spear') ? A.get('proj_ice_spear') : spear) : pr.kind === 'spear' ? spear : arrow;
  if (pr.lob && spr) {
    let x = pr.x, y = pr.y, sc = (pr.kind === 'spear' || ice ? 1.1 : 1.35) + Math.max(0, lift) * 0.08; // bigger high up (closer to the camera)
    if (pr.stuck && pr.ground) {
      // planted steeply: the tip in the ground at the landing point, the shaft leaning back toward the shooter
      rot = Math.atan2(1.6, Math.cos(pr.gdir - yaw) * 0.9 || 0.01);
      const half = (spr.w * 0.36);
      if (yaw) { const [dx, dy] = game.toWorldDir(-Math.cos(rot) * half, 0); x += dx; y += dy; } else x -= Math.cos(rot) * half; // (screen-space offset)
      lift = Math.sin(rot) * half; sc = 1;
    }
    B.main.add(spr, x, y, sc, sc, 1, 1, 1, a, 0, rot, 0, 1, 0, lift);
    return;
  }
  if (spr) {
    const sc = (pr.kind === 'spear' || ice) && spr === arrow ? 1.5 : 1;
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
