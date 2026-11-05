// The kingdoms' soldiers (docs/REINOS.md §14 "Fase 3b — campo de batalha e cerco"): who each one is, how it looks, how it
// walks, fights and follows the orders of its force (game/warfare.js: the field battles; game/siegeAI.js: the siege).
//
// A soldier is a host creature (species 'soldier', kind 'pawn', faction 'army', temper 'friendly') streamed to the guests
// like the townsfolk (net/entities.js): the identity rides `camp` = 'w<k>.<force tag>.<role letter><index>' and the guest
// rebuilds the look (kingdom colours, tabard, the shield's heraldry, armour by level — §7b) from it and the seed — the look
// itself never goes on the wire. Roles: spear / sword (infantry with the kingdom's shield), archer, engineer (builds,
// pushes and operates the engines), the general (the kingdom's standard, rallies the line).
//
// Who fights whom: soldiers fight the soldiers of the other side of their battle and the guards of a place they besiege
// (only kingdoms at war: game.realms.atWar); never the townsfolk who are not guards. Players (docs/REINOS.md §14
// "Jogadores"): a soldier never goes after a player on its own; a player may attack a soldier when (a) the player is a
// member of a kingdom at war with the soldier's, or (b) the soldier's force is fighting — besieging a place or in a field
// battle — and the player is not of the soldier's own kingdom or an ally (a traveller helps a side); the soldiers it hurts
// fight back for a while (m.pfoe). Everything else is protected like the townsfolk (combat.js: no friendly fire).
//
// Host only, except decorate / label / playerMayHurt / crestOf (every peer).

import { ROLES, KIT, WAR, armourOf } from './content/soldiers.js';
import { NAMES_M, NAMES_F, BYNAMES } from './content/people.js';
import { randomLook, cleanLook } from './look.js';
import { CATALOG } from '../art/look/catalog.js';
import { METALS } from '../world/realm/names.js';
import { SPECIES } from './data.js';
import { mobStats } from './stats.js';
import { allocMob } from './mobs.js';
import { weaponProfile, offhandProfile, equipArmor } from './content/weapons.js';
import { dealDamage, faceTowards, reach, hasLOS } from './combat.js';
import { fireArrow } from './projectiles.js';
import { facingFrom } from './physics.js';
import { stepGait } from './anim.js';
import { hurtPlayer, allPlayers, inAnyView } from './players.js';
import { npcMove, nearPass, lineClear } from './townnav.js';
import { heightK, STORY_H } from './levels.js';
import { uidOf, memberOf } from './eco.js';

export const CODE = /^w(\d+)\.([0-9a-z]+)\.([gepsa])(\d+)$/;
export const LETTER = { general: 'g', eng: 'e', spear: 'p', sword: 's', archer: 'a' };
export const ROLE_OF = { g: 'general', e: 'eng', p: 'spear', s: 'sword', a: 'archer' };
const hash = (a, b = 0) => { let h = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul((b | 0) + 0x7f4a7c15, 0x85ebca6b)) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d) >>> 0; h ^= h >>> 12; return h >>> 0; };
const hstr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = (r, a) => a[Math.floor(r() * a.length) % a.length];
const hex3 = (c) => c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const R01 = (m, k = 0) => { const x = Math.sin((m.id + 1) * 12.9898 + (m._rc = (m._rc || 0) + 1) * 78.233 + k) * 43758.5453; return x - Math.floor(x); }; // (cosmetic variety: no shared state depends on it)
export const atWar = (game, a, b) => a != null && b != null && a >= 0 && b >= 0 && a !== b && !!game.realms?.atWar?.(a, b);
export const ownerOf = (game, sid) => game.realms?.owner?.(sid) ?? game.towns?.realm?.settlements[sid]?.k ?? -1;

// ---------- the kingdom's colours (every peer) ----------
const CRESTS = new Map();
export function crestOf(game, k) {
  const R = game.towns?.realm, K = R?.kingdoms[k];
  if (!K) return null;
  let c = CRESTS.get(K);
  if (!c) {
    const B = K.banner || {}, metal = METALS[B.m] || METALS.or;
    c = { k, f: K.color.map((v) => v / 255), m: metal.map((v) => v / 255), fh: hex3(K.color), mh: hex3(metal), d: B.d || 'plain', name: K.name };
    CRESTS.set(K, c);
  }
  return c;
}

// ---------- identities (every peer, pure: the world seed, the kingdom, the force's tag, the role and the index) ----------
const TIER_TOP = ['6e4c32', '9a6a3a', '9aa0a8']; // (the padded coat under the tabard: leather, bronze-sewn, mail grey)
function lookOf(seed, role, crest, tier, female) {
  const r = rng(hash(seed, 77));
  const L = randomLook(hash(seed, 3));
  const D = KIT[role] || KIT.spear;
  const set = (k, v) => { if (v == null) return; L[k] = Array.isArray(v) ? pick(r, v) : v; };
  set('top', D.top); set('pattern', D.pattern || 'plain'); set('over', D.over); set('overC', D.overC);
  set('bottom', D.bottom); set('botC', D.botC); set('shoes', D.shoes); set('build', D.build);
  if (D.over === 'tabard') { L.topC = role === 'general' ? crest.fh : TIER_TOP[tier] || TIER_TOP[0]; L.overC = crest.fh; L.topC2 = crest.mh; }
  else { L.topC = crest.fh; L.topC2 = crest.mh; }
  if (role === 'general') { L.pattern = 'embroidered'; L.topC2 = crest.mh; }
  const HF = ['long', 'bun', 'single_braid', 'ponytail', 'braid', 'low_bun', 'crown_braid'], HM = ['short', 'crew', 'buzz', 'messy', 'receding', 'slick', 'medium', 'bald'];
  L.hair = pick(r, female ? HF : HM);
  L.beard = female ? 'none' : r() < 0.6 ? pick(r, ['full', 'short', 'goatee', 'mustache', 'stubble', 'stubble_heavy', 'mutton']) : 'none';
  if (/^(a8a39c|e8e4dc|ece0c4)$/.test(L.hairC)) L.hairC = pick(r, ['2a2220', '3b2e28', '4e3424', '6b4630']);
  if (L.over && !CATALOG.over.some((e) => e.id === L.over)) L.over = 'none';
  const out = cleanLook(L);
  if (D.over === 'tabard') out.crest = crest.d; // (raw field: the heraldic division on the tabard, art/look/rig.js)
  return out;
}
// { first, name, female, look, role, roleName } of soldier `letter + i` of force `tag` of kingdom k at armour tier `tier`
export function identity(game, k, tag, letter, i, tier) {
  const W = game.warfare;
  const C = W ? W.ids || (W.ids = new Map()) : new Map();
  const key = `${k}.${tag}.${letter}${i}.${tier}`;
  let id = C.get(key);
  if (id) return id;
  const crest = crestOf(game, k);
  if (!crest) return null;
  const role = ROLE_OF[letter] || 'spear';
  const seed = hash(hash((game.world.seed | 0) ^ 0x3a7, k * 977 + 13), hstr(tag) * 31 + i);
  const r = rng(seed);
  const female = r() < (role === 'general' ? 0.2 : 0.22);
  const first = pick(r, female ? NAMES_F : NAMES_M), by = pick(r, BYNAMES);
  id = { first, name: `${first} ${by}`, female, role, roleName: ROLES[role].pt[female ? 1 : 0], look: lookOf(seed, role, crest, tier, female), crest, seed };
  if (C.size > 3000) C.clear();
  C.set(key, id);
  return id;
}
export const codeOf = (k, tag, role, i) => `w${k}.${tag}.${LETTER[role] || 'p'}${i}`;

// ---------- the creature (host) ----------
export function spawnSoldier(game, F, u, x, y) {
  const role = u.role, R = ROLES[role], A = armourOf(F.lv), sp = SPECIES.soldier;
  const id = identity(game, F.k, F.tag, LETTER[role], u.i, A.t);
  if (!id) return null;
  const st = mobStats(sp, F.lv), weapon = R.weapon[A.t], wp = weaponProfile(weapon);
  const wf = 0.7 + 0.4 * (((wp.min + wp.max) / 2) / 8);
  const ids = allocMob(game);
  const m = {
    isEntity: true, isMob: true, kind: 'pawn', faction: 'army', species: 'soldier', ...ids,
    name: id.name, level: F.lv, elite: role === 'general', temper: 'friendly', camp: codeOf(F.k, F.tag, role, u.i), role: role === 'archer' ? 'archer' : 'melee',
    x, y, r: 0.24, scale: role === 'general' ? 1.06 : 1, facing: 's', moving: false, moveT: (id.seed % 1000) / 100, action: null, flash: 0, dead: false, deadT: 0,
    hp: Math.round(st.maxHp * R.hp), dmg: st.dmg * wf * R.dmg, state: 'idle', stateT: 0, swingT: 0, stunT: 0,
    look: id.look, weapon, offhand: R.shield ? 'shield_guard' : null, armor: { body: null, head: role === 'archer' ? 'hood_leather' : role === 'eng' ? (A.t ? 'helmet_copper' : null) : A.head },
    wprof: wp, shield: R.shield ? offhandProfile('shield_iron') : null, reachX: wp.reach, swingDur: wp.swing * 1.08,
    armorV: equipArmor({ body: role === 'archer' || role === 'eng' ? 'armor_leather' : A.body, head: A.head, off: R.shield ? 'shield_iron' : null }) + 4,
    aggroR: WAR.sight, specialT: 3, blockT: 4, throwT: 2, xpMul: role === 'general' ? 4 : sp.xp, noCorpse: true, crest: id.crest,
    soldier: { k: F.k, f: F.id, tag: F.tag, role, i: u.i, first: id.first, roleName: id.roleName, female: id.female },
    lv: 0, z: 0, order: null, foe: null, scanT: R01({ id: ids.id }) * 0.4, pfoe: null, _acc: 0,
    onDeath: (g, mm, killer) => { g.warfare?.onKilled?.(mm, killer); return null; }, // (a player's killing blow: combat.js killMob → reputation)
  };
  m.maxHp = m.hp;
  game.entities.push(m); // sync-ok: host-only creature list (guests get proxies from net/entities.js)
  return m;
}
// guests: a proxy gets its identity from `camp` (the look, the role, the colours)
export function decorateSoldier(game, e) {
  const q = typeof e.camp === 'string' ? CODE.exec(e.camp) : null;
  if (!q) return false;
  const k = +q[1], A = armourOf(e.level | 0), id = identity(game, k, q[2], q[3], +q[4], A.t);
  if (!id) return false;
  e.look = id.look; e.crest = id.crest;
  e.soldier = { k, f: null, tag: q[2], role: id.role, i: +q[4], first: id.first, roleName: id.roleName, female: id.female };
  return true;
}
export function soldierLabel(game, e) {
  const S = e.soldier;
  if (!S) return null;
  const c = crestOf(game, S.k);
  return `${e.name} · ${S.roleName}${c ? ' · Reino de ' + c.name : ''}  ${e.level}`;
}

// ---------- players (docs/REINOS.md §14 "Jogadores"): may this player hurt this soldier? null = yes, else why not ----------
export const FIGHTING = new Set(['camp', 'build', 'bombard', 'assault', 'held', 'retreat', 'deploy', 'advance', 'clash', 'rout', 'won']);
export function playerMayHurt(game, pl, e) {
  const S = e?.soldier;
  if (!S) return null;
  const R = game.towns?.realm, K = R?.kingdoms[S.k], kn = K ? K.name : '?';
  const pid = pl === game.player ? game.net.pid : pl?.pid || null;
  const mk = memberOf(game, uidOf(game, pid));
  if (mk === S.k) return `${e.name} é do seu próprio reino (${kn})`;
  if (mk >= 0 && atWar(game, mk, S.k)) return null; // (a member of a kingdom at war with the soldier's)
  if (mk >= 0 && game.realms?.rel?.(mk, S.k) === 'ally') return `O Reino de ${kn} é aliado do seu`;
  const F = game.warfare?.forceOfEnt?.(e);
  if (F && FIGHTING.has(F.phase)) return null; // (it is besieging a place / in a battle: a traveller may help a side)
  return `Soldado do Reino de ${kn}: só se luta com soldados de um reino em guerra com o seu, ou que estejam atacando um lugar ou outro exército`;
}

// ---------- the ground a soldier walks (host) ----------
// like the townsfolk's (townnav.js npcPass), but a closed door / gate is a wall: the soldiers break in (the ram, the
// breaches) or climb (the towers); engines, tents and the pieces of the camp block too
export function solPass(game, tx, ty) {
  const w = game.world;
  if (!w.inBounds(tx, ty)) return false;
  const i = w.idx(tx, ty);
  if (w.rock.get(i) === 1 || w.isCliff(tx, ty)) return false;
  if (w.water.get(i) === 2 && !w.iceAt(i) && !(w.deck && w.deck.get(i))) return false;
  if (game.occ && game.occ.get(i)) return false;
  const S0 = game.levels?.st[0];
  if (S0 && S0.get(i)) return false;
  return w.solid.get(i) !== 1;
}
export const solNear = (game, x, y, R = 3) => nearPass(game, x, y, R, solPass);
export const solLine = (game, x0, y0, x1, y1, r = 0) => lineClear(game, x0, y0, x1, y1, r, solPass);

// a flow field toward a set of goal tiles over a box (a siege: the plaza through any opening in the walls): Dial's
// algorithm (costs 10 / 14) in slices of a frame; dir(x, y) = the way down. Rebuilt when the structures change (a gate
// broken, a breach), the old one kept until the new one is done.
export class FlowField {
  constructor(game, x0, y0, w, h) { this.game = game; this.x0 = x0; this.y0 = y0; this.w = w; this.h = h; this.d = null; this.v = -1; this.job = null; this.at = -99; this.ms = 0; }
  want(goals, v) { if ((this.job && this.job.v === v) || (!this.job && this.v === v)) return; this.job = { v, goals, D: new Uint16Array(this.w * this.h).fill(65535), B: [], cur: 0, started: false, pass: new Uint8Array(this.w * this.h) }; }
  _open(J, n) { let v = J.pass[n]; if (!v) { v = solPass(this.game, this.x0 + (n % this.w), this.y0 + ((n / this.w) | 0)) ? 1 : 2; J.pass[n] = v; } return v === 1; }
  tick(budgetMs = 1) {
    const J = this.job;
    if (!J) return;
    const t0 = performance.now(), W = this.w, H = this.h, D = J.D, B = J.B, NB = 15;
    if (!J.started) {
      J.started = true;
      for (let k = 0; k < NB; k++) B.push([]);
      for (const [gx, gy] of J.goals) { const x = Math.floor(gx) - this.x0, y = Math.floor(gy) - this.y0; if (x < 0 || y < 0 || x >= W || y >= H) continue; const n = y * W + x; D[n] = 0; B[0].push(n); }
      J.left = J.goals.length;
    }
    let ops = 0;
    while (J.left > 0) {
      const bk = B[J.cur % NB];
      if (!bk.length) { J.cur++; if (J.cur > 65000) break; continue; }
      const n = bk.pop(); J.left--;
      const dn = D[n];
      if (dn !== J.cur) continue; // (a stale entry)
      const cx = n % W, cy = (n / W) | 0;
      for (let k = 0; k < 8; k++) {
        const dx = k < 4 ? (k === 0 ? 1 : k === 1 ? -1 : 0) : (k & 1 ? 1 : -1), dy = k < 4 ? (k === 2 ? 1 : k === 3 ? -1 : 0) : (k < 6 ? 1 : -1);
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const nn = ny * W + nx;
        if (!this._open(J, nn)) continue;
        if (dx && dy && (!this._open(J, cy * W + nx) || !this._open(J, ny * W + cx))) continue;
        const nd = dn + (dx && dy ? 14 : 10);
        if (nd < D[nn]) { D[nn] = nd; B[nd % NB].push(nn); J.left++; }
      }
      if ((++ops & 511) === 0 && performance.now() - t0 > budgetMs) { this.ms += performance.now() - t0; return; }
    }
    this.d = D; this.v = J.v; this.job = null; this.at = this.game.worldTime;
    this.ms += performance.now() - t0;
  }
  dist(x, y) { const tx = Math.floor(x) - this.x0, ty = Math.floor(y) - this.y0; if (!this.d || tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return 65535; return this.d[ty * this.w + tx]; }
  // the direction toward the goals from (x, y) (unit vector) or null (no way known from here)
  dir(x, y) {
    const D = this.d;
    if (!D) return null;
    const W = this.w, tx = Math.floor(x) - this.x0, ty = Math.floor(y) - this.y0;
    if (tx < 0 || ty < 0 || tx >= W || ty >= this.h) return null;
    const d0 = D[ty * W + tx];
    if (d0 === 65535) return null;
    if (d0 === 0) return [0, 0];
    let best = d0, bx = 0, by = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = tx + dx, ny = ty + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= this.h) continue;
      const v = D[ny * W + nx];
      if (dx && dy && (D[ty * W + nx] === 65535 || D[ny * W + tx] === 65535)) continue;
      if (v < best) { best = v; bx = dx; by = dy; }
    }
    if (!bx && !by) return null;
    // toward the middle of the next tile (from where it stands: it cuts the corners a little)
    const gx = this.x0 + tx + bx + 0.5, gy = this.y0 + ty + by + 0.5, L = Math.hypot(gx - x, gy - y) || 1;
    return [(gx - x) / L, (gy - y) / L];
  }
}

// ---------- moving (host) ----------
// toward (gx, gy): straight with sliding; 'here' | 'walk' | 'stuck'
export function stepTo(game, m, gx, gy, spd, dt, arrive = 0.25) {
  const dx0 = gx - m.x, dy0 = gy - m.y, d = Math.hypot(dx0, dy0);
  if (d <= arrive) { m.moving = false; m._stuckT = 0; return 'here'; }
  return stepDir(game, m, dx0 / d, dy0 / d, Math.min(spd * dt, d), dt);
}
export function stepDir(game, m, ux, uy, step, dt) {
  const x0 = m.x, y0 = m.y;
  if (m.z > 0.5) wallMove(game, m, ux * step, uy * step);
  else npcMove(game, m, ux * step, uy * step, solPass);
  const moved = Math.hypot(m.x - x0, m.y - y0);
  m.facing = facingFrom(ux, uy, m.facing);
  m.moving = moved > 1e-4;
  stepGait(m, moved);
  if (moved < step * 0.25) {
    m._stuckT = (m._stuckT || 0) + dt;
    if (m._stuckT > 1.4) { m._stuckT = 0; return 'stuck'; }
  } else m._stuckT = 0;
  return 'walk';
}
// up a story (a wall walk, a tower deck): only over that story's floor (levels.js surfaces)
export function surfAt(game, lv, x, y) { const L = game.levels?.sync?.(); const w = game.world; return !!L && !!L.surf[lv]?.get(w.idx(Math.floor(x), Math.floor(y))) && !L.blk?.[lv]?.get(w.idx(Math.floor(x), Math.floor(y))); }
function wallMove(game, m, dx, dy) {
  const lv = m.lv | 0, n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 0.15));
  for (let k = 0; k < n; k++) {
    if (surfAt(game, lv, m.x + dx / n, m.y)) m.x += dx / n;
    if (surfAt(game, lv, m.x, m.y + dy / n)) m.y += dy / n;
  }
}
// stuck out of sight: a little hop along its way (nobody sees it); in sight it tries a side step
export function unstick(game, m, gx, gy) {
  if (!inAnyView(game, m.x, m.y, 2, 3)) {
    const d = Math.hypot(gx - m.x, gy - m.y) || 1, s = Math.min(2.5, d);
    const q = solNear(game, m.x + ((gx - m.x) / d) * s, m.y + ((gy - m.y) / d) * s, 2);
    if (q) { m.x = q[0]; m.y = q[1]; return true; }
  }
  const a = Math.atan2(gy - m.y, gx - m.x) + (R01(m) < 0.5 ? 1.4 : -1.4);
  npcMove(game, m, Math.cos(a) * 0.5, Math.sin(a) * 0.5, solPass);
  return false;
}

// ---------- who is a foe (host) ----------
// e: a creature (soldier / town guard) or a player avatar. A soldier's foes: the soldiers of the other side (the force
// lists them: F.foes), the guards of the place it besieges, the players who hurt it lately (m.pfoe)
export function isFoe(game, m, e) {
  if (!e || e.dead || e === m) return false;
  if (e.soldier) return e.soldier.k !== m.soldier.k && atWar(game, e.soldier.k, m.soldier.k);
  if (e.npc) return !!e.npc.guard && atWar(game, m.soldier.k, ownerOf(game, e.npc.sid));
  if (m.pfoe && m.pfoe.e === e && m.pfoe.until > game.worldTime) return true;
  if (isPlayerEnt(game, e) && game.army?.soldierFoe?.(m.soldier.k, e)) return true; // (an enlisted player of a kingdom at war with it — game/army.js, docs/REINOS.md §15)
  return false;
}
// what an army arrow may hit (projectiles.js canHit): a foe of its shooter (players only if they fought it)
export const arrowHits = (game, m) => (e) => isFoe(game, m, e);

// ---------- fighting (host) ----------
const isPlayerEnt = (game, e) => e === game.player || !!e?.avatar || !!(e?.remote && e.pid);
export function hitFoe(game, m, f, amount, opts = {}) {
  if (isPlayerEnt(game, f)) return hurtPlayer(game, m, f, Math.max(1, Math.round(amount)), opts);
  return dealDamage(game, m, f, amount, opts);
}
// melee: up to it (from its own side around it), then the swing timer; true while fighting
export function melee(game, m, f, dt, spd = WAR.speed.run) {
  const d = Math.hypot(f.x - m.x, f.y - m.y), rng = reach(m, f);
  if (rng < 0 || d > rng) {
    if (rng < 0) return false; // (another story: out of its reach)
    const a = Math.atan2(m.y - f.y, m.x - f.x) + ((m.id % 5) - 2) * 0.4, k = Math.max(0.45, rng * 0.75);
    const gx = d > 3 ? f.x : f.x + Math.cos(a) * k, gy = d > 3 ? f.y : f.y + Math.sin(a) * k;
    const s = stepTo(game, m, gx, gy, spd, dt, d > 3 ? rng * 0.8 : 0.15);
    if (s === 'stuck') unstick(game, m, gx, gy);
    return true;
  }
  m.moving = false; faceTowards(m, f);
  if (m.swingT <= 0) {
    m.swingT = m.swingDur * (0.9 + R01(m) * 0.25);
    m.specialT = (m.specialT || 0) - m.swingT;
    const heavy = m.specialT <= 0;
    if (heavy) m.specialT = 6 + R01(m) * 4;
    const t = m.wprof?.type, act = t === 'spear' ? (heavy ? 'pierce' : 'stab') : t === 'axe' ? 'attack' : heavy ? 'cleave' : 'slash';
    m.action = { type: act, t: 0, dur: heavy ? 0.45 : 0.36 };
    game.audio?.play('swing', { x: m.x, y: m.y, volume: 0.45 });
    game.later(0.22, () => {
      if (m.dead || f.dead || Math.hypot(f.x - m.x, f.y - m.y) > rng + 0.6) return;
      hitFoe(game, m, f, m.dmg * (heavy ? 1.6 : 1) * (0.85 + R01(m) * 0.3), { from: m, ability: heavy ? act : undefined });
    });
  }
  return true;
}
// an archer's shot (the arrow hits only its foes: projectiles.js faction 'army' + canHit)
export function shoot(game, m, f, rangeK = 1) {
  if (m.swingT > 0) return false;
  faceTowards(m, f);
  m.swingT = (m.swingDur || 1.8) * (1 + R01(m) * 0.35);
  m.action = { type: 'shoot', t: 0, dur: 0.6 };
  const dmg = Math.max(1, Math.round(m.dmg * (0.9 + R01(m) * 0.3)));
  game.later(0.34, () => {
    if (m.dead || f.dead) return;
    const lead = 0.25;
    fireArrow(game, {
      src: m, faction: 'army', x: m.x, y: m.y, tx: f.x + (f.vx || 0) * lead, ty: f.y + (f.vy || 0) * lead, range: WAR.archer.range * 1.5 * rangeK, kind: 'arrow', target: f, z1: f.z || 0,
      canHit: arrowHits(game, m),
      onHit: (g, e, pr) => { hitFoe(g, m, e, dmg, { ranged: true, from: { x: pr.ox, y: pr.oy } }); },
    });
    game.audio?.play('bow', { x: m.x, y: m.y, volume: 0.4 });
  });
  return true;
}
// the foe a soldier fights now among `list` (+ the players it is angry with): the nearest within r, on its own story
// for melee; an archer: within its range with a line of fire (checked when picked)
export function pickFoe(game, m, list, r, archer = false, sameSide = null) {
  let best = null, bd = r * r;
  const z = m.z || 0;
  const consider = (e) => {
    if (!e || e.dead || e === m) return;
    const dx = e.x - m.x, dy = e.y - m.y, dd = dx * dx + dy * dy;
    if (dd >= bd) return;
    if (!archer && Math.abs((e.z || 0) - z) > 0.5) return;
    if (!isFoe(game, m, e)) return;
    if (sameSide && dd > 4 && !sameSide(e)) return;
    best = e; bd = dd;
  };
  for (const e of list) consider(e);
  if (m.pfoe && m.pfoe.until > game.worldTime) consider(m.pfoe.e);
  if (best && archer && !hasLOS(game.world, m.x, m.y, best.x, best.y, z, best.z || 0, m._tn, best._tn)) return null;
  return best;
}
// hurt by something (ai.js aggro → game.warfare.onHurt): a player who may hurt it becomes its foe for a while; a soldier
// / guard that hits it is fought back
export function soldierHurt(game, m, src) {
  if (!m || m.dead || m.proxy || !src || src === m) return;
  if (isPlayerEnt(game, src)) { m.pfoe = { e: src, until: game.worldTime + WAR.pfoeT }; if (!m.foe || m.foe.dead) { m.foe = src; m.scanT = 0.3; } return; }
  if (isFoe(game, m, src) && (!m.foe || m.foe.dead)) { m.foe = src; m.scanT = 0.5; }
}

// ---------- the brain (host): fight what comes near, else follow the order of its force ----------
// m.order: { k: 'slot' | 'go' | 'flow' | 'hunt' | 'hold' | 'build' | 'push' | 'operate' | 'climb' | 'wall' | 'flee' | 'idle',
//            x, y, fx, fy (facing at a slot), run, eng (how far it goes after a foe), ff (a flow field), …}
// The force (warfare.js / siegeAI.js) writes the orders; the special tasks (build, push, operate, climb) are run by
// siegeAI.js through m.task (a callback) — the brain only keeps them from wandering into fights.
export function soldierBrain(game, F, m, dt) {
  m.swingT = Math.max(0, (m.swingT || 0) - dt);
  if (m.action && !m.action.hold) { m.action.t += dt / (m.action.dur || 0.5); if (m.action.t >= 1) m.action = null; }
  if (m.stunT > 0) { m.stunT -= dt; m.moving = false; m.action = null; return; }
  const O = m.order || IDLE;
  if (O.k === 'flee') { flee(game, F, m, O, dt); return; }
  const archer = m.soldier.role === 'archer';
  // the foe: kept while it stays near, rescanned now and then
  m.scanT -= dt;
  const eng = m.job ? m.job.eng ?? 0 : O.eng ?? (O.k === 'slot' || O.k === 'hold' ? (archer ? WAR.archer.range : 5) : O.k === 'flow' ? 8 : O.k === 'hunt' ? 40 : O.k === 'wall' ? 7 : 0); // (busy with an engine / a climb: only what is right on it)
  if (m.scanT <= 0 || (m.foe && m.foe.dead)) {
    m.scanT = 0.32 + (m.id % 5) * 0.04;
    let f = m.foe && !m.foe.dead && isFoe(game, m, m.foe) && Math.hypot(m.foe.x - m.x, m.foe.y - m.y) < Math.max(eng, 3) + 3 ? m.foe : null;
    if (!f && (eng > 0 || m.pfoe)) f = pickFoe(game, m, F.foes || EMPTY, Math.max(eng, m.pfoe ? 9 : 0), archer, O.side || null);
    // (busy with an engine / a climb: only fights back what is right on it)
    if (f && eng <= 0 && Math.hypot(f.x - m.x, f.y - m.y) > 2.2 && !(m.pfoe && m.pfoe.e === f)) f = null;
    m.foe = f; m.threat = f;
    m.state = f ? 'chase' : 'idle';
  }
  const f = m.foe;
  if (f && !f.dead) {
    if (O.leash && Math.hypot(m.x - O.x, m.y - O.y) > O.leash && Math.hypot(f.x - O.x, f.y - O.y) > O.leash) { m.foe = null; m.state = 'idle'; }
    else if (archer) {
      const d = Math.hypot(f.x - m.x, f.y - m.y), rng = WAR.archer.range * heightK(m, f) * (O.rangeK || 1);
      if (d > rng || d < 1.2) {
        if (O.k === 'wall' || O.k === 'hold' || O.k === 'slot') { if (d > rng * 1.15) { m.foe = null; } else { faceTowards(m, f); m.moving = false; return; } }
        else { const s = stepTo(game, m, f.x, f.y, WAR.speed.walk, dt, rng * 0.85); if (s === 'stuck') unstick(game, m, f.x, f.y); return; }
      } else { m.moving = false; shoot(game, m, f, O.rangeK || 1); return; }
    } else if (melee(game, m, f, dt)) return;
  }
  if (m.job && m.job(game, F, m, dt) !== false) return;
  follow(game, F, m, O, dt);
}
const IDLE = { k: 'idle' }, EMPTY = [];
function follow(game, F, m, O, dt) {
  switch (O.k) {
    case 'slot': case 'hold': case 'go': {
      const d = Math.hypot(O.x - m.x, O.y - m.y);
      if (d < 0.3) {
        m.moving = false;
        if (O.fx != null && !m.action) { m.facing = facingFrom(O.fx, O.fy, m.facing); }
        if (O.idle && !m.action && R01(m, 5) < dt * 0.35) m.action = { type: O.idle, t: 0, dur: O.idle === 'talk' ? 1.7 : 1.3 }; // (a camp's life: sharpening, a chat, a bite)
        if (O.then && O.k === 'go') { m.order = O.then; }
        return;
      }
      const spd = O.run || d > 6 ? (F.phase === 'march' ? WAR.speed.walk * 1.4 : WAR.speed.run) : d > 2 ? WAR.speed.walk * 1.25 : WAR.speed.walk;
      const s = stepTo(game, m, O.x, O.y, O.spd || spd, dt, 0.25);
      if (s === 'stuck') { m._stk = (m._stk || 0) + 1; if (unstick(game, m, O.x, O.y) || m._stk > 4) m._stk = 0; }
      return;
    }
    case 'flow': {
      const ff = O.ff;
      const v = ff?.dir(m.x, m.y);
      if (v && (v[0] || v[1])) { const s = stepDir(game, m, v[0], v[1], (O.spd || WAR.speed.run) * dt, dt); if (s === 'stuck') unstick(game, m, m.x + v[0] * 3, m.y + v[1] * 3); return; }
      if (v) { m.moving = false; return; } // (there)
      // no way known from here (the field not ready, the way closed): to its waiting spot
      if (O.x != null) { const s = stepTo(game, m, O.x, O.y, WAR.speed.walk, dt, 0.4); if (s === 'stuck') unstick(game, m, O.x, O.y); return; }
      m.moving = false;
      return;
    }
    case 'hunt': { // (the clash: the nearest foe anywhere, else toward the other line)
      if (O.x != null) { const s = stepTo(game, m, O.x, O.y, WAR.speed.run, dt, 1.2); if (s === 'stuck') unstick(game, m, O.x, O.y); return; }
      m.moving = false;
      return;
    }
    case 'wall': { // (up on a wall walk: along it toward the spot, else stand)
      if (O.x != null) { const s = stepTo(game, m, O.x, O.y, WAR.speed.walk, dt, 0.3); if (s === 'here' && O.then) m.order = O.then; return; }
      m.moving = false;
      return;
    }
    default: m.moving = false;
  }
}
// running away (a rout / a retreat): to its rally point, then gone when nobody sees it
function flee(game, F, m, O, dt) {
  m.foe = null; m.state = 'idle';
  if (m.z > 0.5) { m.z = 0; m.lv = 0; const q = solNear(game, m.x - (O.fx || 0) * 2, m.y - (O.fy || 0) * 2, 3); if (q) { m.x = q[0]; m.y = q[1]; } }
  const s = stepTo(game, m, O.x, O.y, WAR.speed.retreat, dt, 1.5);
  if (s === 'stuck') unstick(game, m, O.x, O.y);
  if ((s === 'here' || Math.hypot(O.x - m.x, O.y - m.y) < 3) && !inAnyView(game, m.x, m.y, 2, 3)) m._gone = true;
}

// separation: soldiers do not walk through each other (the ones moving step aside)
export const SPACE = 0.66; // tiles between two soldiers' bodies (their sprites never stack)
export function separate(game, list) {
  const n = list.length;
  for (let i = 0; i < n; i++) {
    const a = list[i];
    if (a.dead || a.z > 0.5) continue;
    for (let j = i + 1; j < n; j++) {
      const b = list[j];
      if (b.dead || b.z > 0.5) continue;
      const rr = SPACE, dx = b.x - a.x, dy = b.y - a.y;
      if (Math.abs(dx) > rr || Math.abs(dy) > rr) continue;
      const d = Math.hypot(dx, dy);
      if (d >= rr) continue;
      const am = a.moving || a.state === 'chase', bm = b.moving || b.state === 'chase';
      const busy = (q) => !!q.job && !q.job.camp; // (at an engine / a ladder: it holds its place)
      // (two standing: both ease apart a little; a moving one steps aside from a standing one)
      const ka = busy(a) ? 0 : am ? (bm ? 1 : 2) : bm ? 0 : 0.6, kb = busy(b) ? 0 : bm ? (am ? 1 : 2) : am ? 0 : 0.6;
      if (!ka && !kb) continue;
      const ux = d < 1e-3 ? Math.cos(a.id) : dx / (d || 1), uy = d < 1e-3 ? Math.sin(a.id) : dy / (d || 1), push = (rr - d) * 0.5;
      if (ka) npcMove(game, a, -ux * push * ka * 0.5, -uy * push * ka * 0.5, solPass);
      if (kb) npcMove(game, b, ux * push * kb * 0.5, uy * push * kb * 0.5, solPass);
    }
  }
}
export const isPlayer = isPlayerEnt;
export const liftOfE = (e) => (e.z > 0 ? e.z * STORY_H : 0);
void allPlayers;
