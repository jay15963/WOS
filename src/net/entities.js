// Creature replication (docs/SYNC.md §3.6 / §3.7). Creatures exist on the HOST only; guests draw AI-less
// proxies fed by a 10 Hz interest-managed stream, plus cosmetic events (damage numbers, creature
// projectiles) relayed per frame.
//
// {t:'ents', ht, add:[full…], up:[dyn…], del:[nid…]}
//   full = [nid, kind('a'|'p'), species, name, level, elite, temper, faction|0, scale, maxHp, variant|0, look|0,
//           weapon|0, offhand|0, armorBody|0, armorHead|0, camp|0, ...dyn]
//   up   = [nid, ...dyn]   (trailing zeros trimmed)
//   dyn  = [x*100|0, y*100|0, bits, hp, actType|0, actT*100|0, actDur*100|0, actSeq, castName|0, castT*100|0, castDur*100|0, tgtPid|0]
//   bits = facing (0 s,1 n,2 e,3 w) | moving<<2 | dead<<3 | blocking<<4 | stunned<<5 | chase<<6 | bleed<<7 |
//          poison<<8 | burn<<9 | dazed<<10 | feared<<11
// {t:'fx', l:[['dmg', tgt, src, amount, kind, crit, dtype, ability, blocked, dot, text] | ['proj', id, ...args] |
//            ['pend', id, x, y, stuck, ground]]}   refs: 'm:'+nid | 'p:'+pid | 'o:'+propId
// A new creature species needs nothing here: SPECIES + art contract names are enough.

import { SPECIES } from '../game/data.js';
import { stepGait } from '../game/anim.js';
import { enterCombat } from '../game/player.js';
import { fireCosmetic, endCosmetic } from '../game/projectiles.js';
import { propById } from '../game/mut/camps.js';

const IN_X = 40, IN_Y = 30, OUT_X = 46, OUT_Y = 36;
const TICK = 0.1, REFRESH = 5, INTERP = 0.15;
const FACE = { s: 0, n: 1, e: 2, w: 3 }, FACES = ['s', 'n', 'e', 'w'];
const DOTS = ['bleed', 'poison', 'burn'];
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v, n = 32) => (typeof v === 'string' ? v.slice(0, n) : null);

// min-filtered clock offset between a sender clock and performance.now() (s); slowly relaxes upward
export class ClockSync {
  constructor() { this.off = 0; this.ready = false; this.lastT = 0; }
  sample(ts) {
    const now = performance.now() / 1000, o = now - ts;
    if (!this.ready) { this.off = o; this.ready = true; } else {
      this.off += Math.min(0.5, now - this.lastT) * 0.002;
      if (o < this.off) this.off = o;
    }
    this.lastT = now;
  }
}

// ---------- host ----------
export class EntityServer {
  constructor(game, session) {
    this.game = game;
    this.s = session;
    this.acc = 0;
    this.guests = new Map(); // pid -> { known: Map<nid, { dyn, t, st }> }
    this.fxq = [];           // [entry, x, y, exceptPid]
    game.net.entsApi = this;
    game.events.on('damage', (d) => this._onDamage(d));
  }

  resetGuest(pid) { this.guests.set(pid, { known: new Map() }); }
  dropGuest(pid) { this.guests.delete(pid); }
  byNid(nid) { for (const e of this.game.entities) if (e.nid === nid) return e; return null; }

  _ref(e) {
    if (!e) return 0;
    if (e === this.game.player) return 'p:' + this.s.pid;
    if (e.avatar || (e.remote && e.pid)) return 'p:' + e.pid;
    if (e.nid) return 'm:' + e.nid;
    if (e.isProp) return 'o:' + e.id;
    return 0;
  }
  _onDamage(d) {
    if (!this.s.players.size || d.kind === 'prop') return;
    const t = this._ref(d.target);
    if (!t) return;
    this.fx(['dmg', t, this._ref(d.src), d.amount | 0, d.kind, d.crit ? 1 : 0, d.dtype || 0, d.ability || 0, d.blocked ? 1 : 0, d.dot ? 1 : 0, d.text || 0], d.target.x, d.target.y);
  }
  // queue a cosmetic event (sent at the end of the frame to guests near x, y)
  fx(entry, x, y, exceptPid = null) {
    if (!this.s.players.size) return;
    this.fxq.push([entry, x, y, exceptPid]);
  }
  _flushFx() {
    if (!this.fxq.length) return;
    const Q = this.fxq;
    this.fxq = [];
    for (const pl of this.s.syncedGuests()) {
      const av = pl.av, l = [];
      for (const [e, x, y, ex] of Q) {
        if (ex === pl.pid) continue;
        if (x != null && av && (Math.abs(x - av.x) > OUT_X || Math.abs(y - av.y) > OUT_Y)) continue;
        l.push(e);
      }
      if (l.length) this.s._sendTo(pl.key, { t: 'fx', l });
    }
  }

  _dyn(m) {
    if (m.action !== m._actObj) { m._actObj = m.action; if (m.action) m._actSeq = ((m._actSeq || 0) + 1) % 1000; }
    const dots = m.dots || [];
    const bits = (FACE[m.facing] || 0) | (m.moving ? 4 : 0) | (m.dead ? 8 : 0) | (m.blocking ? 16 : 0) | (m.stunT > 0 ? 32 : 0)
      | (m.state === 'chase' ? 64 : 0) | (dots.some((d) => d.id === 'bleed') ? 128 : 0) | (dots.some((d) => d.id === 'poison') ? 256 : 0)
      | (dots.some((d) => d.id === 'burn') ? 512 : 0) | (m.dazeT > 0 ? 1024 : 0) | (m.fearT > 0 ? 2048 : 0);
    const a = m.action, c = m.cast;
    const thr = m.state === 'chase' ? m.threat : null;
    const tgt = thr ? (thr === this.game.player ? this.s.pid : thr.pid || 0) : 0;
    return [Math.round(m.x * 100), Math.round(m.y * 100), bits, Math.max(0, Math.round(m.hp)),
      a ? a.type : 0, a ? Math.round((a.t || 0) * 100) : 0, a ? (a.hold ? 0 : Math.round((a.dur || 0.5) * 100)) : 0, a ? m._actSeq : 0,
      c ? c.name : 0, c ? Math.round(c.t * 100) : 0, c ? Math.round(c.dur * 100) : 0, tgt];
  }
  _static(m) {
    return [m.nid, m.kind === 'pawn' ? 'p' : 'a', m.species, m.name, m.level, m.elite ? 1 : 0, m.temper || 0, m.faction || 0,
      +(m.scale || 1).toFixed(3), Math.round(m.maxHp), m.variant | 0, m.look || 0, m.weapon || 0, m.offhand || 0,
      m.armor?.body || 0, m.armor?.head || 0, m.camp || 0];
  }

  tick(dt) {
    this._flushFx();
    this.acc += dt;
    if (this.acc < TICK) return;
    this.acc = 0;
    const now = performance.now() / 1000;
    const mobs = [];
    for (const e of this.game.entities) if (e.isMob && e.nid && !e.proxy) mobs.push(e);
    const ht = +now.toFixed(3);
    for (const pl of this.s.syncedGuests()) {
      const G = this.guests.get(pl.pid) || (this.guests.set(pl.pid, { known: new Map() }), this.guests.get(pl.pid));
      const av = pl.av;
      if (!av) continue;
      const add = [], up = [], del = [], seen = new Set();
      for (const m of mobs) {
        const k = G.known.get(m.nid);
        const dx = Math.abs(m.x - av.x), dy = Math.abs(m.y - av.y);
        const mine = m.state === 'chase' && m.threat === av;
        if (!(mine || (k ? !(dx > OUT_X || dy > OUT_Y) : dx <= IN_X && dy <= IN_Y))) continue;
        seen.add(m.nid);
        const dyn = this._dyn(m);
        const st = this._static(m);
        const sk = st.join('|');
        if (!k || k.sk !== sk) { add.push(st.concat(dyn)); G.known.set(m.nid, { dyn, t: now, sk }); continue; }
        const o = k.dyn;
        let ch = now - k.t > REFRESH || Math.abs(o[0] - dyn[0]) >= 2 || Math.abs(o[1] - dyn[1]) >= 2;
        for (let i = 2; !ch && i < dyn.length; i++) if (i !== 5 && i !== 9 && o[i] !== dyn[i]) ch = true; // action / cast progress advance locally
        if (!ch) continue;
        k.dyn = dyn; k.t = now;
        const row = [m.nid, ...dyn];
        while (row.length > 4 && !row[row.length - 1]) row.pop();
        up.push(row);
      }
      for (const nid of G.known.keys()) if (!seen.has(nid)) { del.push(nid); G.known.delete(nid); }
      if (add.length || up.length || del.length) this.s._sendTo(pl.key, { t: 'ents', ht, add, up, del });
    }
  }

  // digest helper: what this guest should see right now
  interestRows(pid) {
    const G = this.guests.get(pid);
    if (!G) return [];
    const out = [];
    for (const nid of G.known.keys()) {
      const m = this.byNid(nid);
      if (m) out.push([nid, m.species, m.dead ? 1 : 0, +m.x.toFixed(2), +m.y.toFixed(2)]);
    }
    return out;
  }

  debug() {
    const g = {};
    for (const [pid, G] of this.guests) g[pid] = [...G.known.keys()];
    return { role: 'host', guests: g, mobs: this.game.entities.filter((e) => e.isMob && !e.proxy).length };
  }
}

// ---------- guest ----------
export class EntityClient {
  constructor(game, session) {
    this.game = game;
    this.s = session;
    this.map = new Map();   // nid -> proxy
    this.clock = new ClockSync();
    game.net.entsApi = this;
  }

  byNid(nid) { return this.map.get(nid) || null; }

  clear() {
    const E = this.game.entities;
    for (const e of this.map.values()) { const i = E.indexOf(e); if (i >= 0) E.splice(i, 1); this._untarget(e); }
    this.map.clear();
  }

  _untarget(e) {
    const p = this.game.player;
    if (p.target === e) { p.target = null; p.autoAttack = false; this.game.events.emit('target', { target: null }); }
  }

  onEnts(m) {
    const ht = num(m.ht);
    if (ht) this.clock.sample(ht);
    if (Array.isArray(m.add)) for (const r of m.add) if (Array.isArray(r)) this._add(r, ht);
    if (Array.isArray(m.up)) for (const r of m.up) if (Array.isArray(r)) { const e = this.map.get(r[0]); if (e) this._dyn(e, r.slice(1), ht); }
    if (Array.isArray(m.del)) for (const nid of m.del) this._del(nid);
  }

  _add(r, ht) {
    const nid = str(r[0], 16);
    if (!nid) return;
    const species = str(r[2], 24) || 'wolf';
    const sp = SPECIES[species] || SPECIES.wolf;
    let e = this.map.get(nid);
    if (!e) {
      e = { isEntity: true, isMob: true, proxy: true, nid, id: parseInt(nid.slice(1), 36) || 0, x: num(r[17]) / 100, y: num(r[18]) / 100,
        facing: 's', moving: false, moveT: 0, action: null, flash: 0, dead: false, deadT: 0, state: 'idle', threat: null, _buf: [], dots: [] };
      this.map.set(nid, e);
      this.game.entities.push(e); // proxy list (net/entities.js owns guest creatures)
    }
    Object.assign(e, {
      kind: r[1] === 'p' ? 'pawn' : 'animal', species, name: str(r[3], 40) || sp.name, level: num(r[4], 1) | 0, elite: !!r[5],
      temper: str(r[6], 12) || sp.temper, faction: r[7] || undefined, scale: num(r[8], 1), maxHp: num(r[9], 1), variant: num(r[10]) | 0,
      look: r[11] && typeof r[11] === 'object' ? r[11] : undefined, weapon: str(r[12], 32) || null, offhand: str(r[13], 32) || null,
      armor: { body: str(r[14], 32) || null, head: str(r[15], 32) || null }, camp: str(r[16], 16) || undefined, r: sp.r || 0.3,
    });
    this._dyn(e, r.slice(17), ht, true);
  }

  _dyn(e, d, ht, fresh = false) {
    const x = num(d[0]) / 100, y = num(d[1]) / 100, bits = num(d[2]) | 0;
    const B = e._buf, prev = B[B.length - 1];
    if (fresh && !B.length) { e.x = x; e.y = y; }
    if (prev && Math.hypot(x - prev.x, y - prev.y) > 6) { B.length = 0; e.x = x; e.y = y; }
    if (!prev || ht > prev.t) { B.push({ t: ht, x, y }); if (B.length > 12) B.shift(); }
    e.facing = FACES[bits & 3];
    e.netMoving = !!(bits & 4);
    const dead = !!(bits & 8);
    if (dead && !e.dead) { e.deadT = 0; e.action = null; e.cast = null; this._untarget(e); }
    e.dead = dead;
    e.blocking = !!(bits & 16);
    e.stunT = bits & 32 ? 1 : 0;
    e.dazeT = bits & 1024 ? 1 : 0;
    e.fearT = bits & 2048 ? 1 : 0;
    e.dots = DOTS.filter((id, i) => bits & (128 << i)).map((id) => ({ id }));
    e.hp = num(d[3], e.hp ?? e.maxHp);
    const chase = !!(bits & 64), tgt = d[11] || 0;
    const p = this.game.player;
    const wasMine = e.state === 'chase' && e.threat === p;
    e.state = dead ? 'dead' : chase ? 'chase' : 'idle';
    e.threat = chase && tgt === this.s.pid ? p : chase ? { remote: true, pid: tgt } : null;
    if (chase && e.threat === p && !wasMine) this.game.audio?.play('growl', { x: e.x, y: e.y, volume: e.kind === 'pawn' ? 0.5 : 1 });
    const seq = num(d[7]) | 0;
    if (d[4] && seq !== e._actSeq) {
      e._actSeq = seq;
      e.action = { type: str(d[4], 16), t: num(d[5]) / 100, dur: Math.max(0.05, num(d[6], 50) / 100), hold: num(d[6]) === 0 };
      if (!fresh && (e.action.type === 'attack' || e.action.type === 'shoot')) this.game.audio?.play('swing', { x: e.x, y: e.y, volume: 0.5 });
    } else if (!d[4]) e.action = null;
    e.cast = d[8] ? { name: str(d[8], 24), t: num(d[9]) / 100, dur: Math.max(0.05, num(d[10], 100) / 100) } : null;
  }

  _del(nid) {
    const e = this.map.get(nid);
    if (!e) return;
    this.map.delete(nid);
    const E = this.game.entities, i = E.indexOf(e);
    if (i >= 0) E.splice(i, 1);
    this._untarget(e);
  }

  // interpolation in host time + local animation progress
  tick(dt) {
    const now = performance.now() / 1000;
    const rt = now - this.clock.off - INTERP;
    const p = this.game.player;
    let fighting = false;
    for (const e of this.map.values()) {
      const B = e._buf;
      if (B.length) {
        let a = B[0], b = B[B.length - 1];
        for (let i = B.length - 1; i > 0; i--) if (B[i - 1].t <= rt) { a = B[i - 1]; b = B[i]; break; }
        let x, y;
        if (rt <= a.t) { x = a.x; y = a.y; } else if (rt >= b.t) { x = b.x; y = b.y; } else {
          const k = (rt - a.t) / Math.max(1e-3, b.t - a.t);
          x = a.x + (b.x - a.x) * k; y = a.y + (b.y - a.y) * k;
        }
        const d = Math.hypot(x - e.x, y - e.y);
        if (d > 6) { e.x = x; e.y = y; } else { e.x = x; e.y = y; stepGait(e, Math.min(d, 1)); }
        e.moving = !e.dead && (e.netMoving || d > 0.005);
      }
      if (e.action && !e.action.hold) { e.action.t += dt / (e.action.dur || 0.5); if (e.action.t >= 1) e.action = null; }
      if (e.cast) e.cast.t = Math.min(e.cast.dur, e.cast.t + dt);
      if (!e.dead && e.state === 'chase' && e.threat === p) fighting = true;
    }
    if (fighting && !p.dead) enterCombat(p, 1);
  }

  // ---------- cosmetic events from the host ----------
  _resolve(ref) {
    if (typeof ref !== 'string') return null;
    const k = ref.slice(2);
    if (ref[0] === 'm') return this.map.get(k) || null;
    if (ref[0] === 'p') return k === this.s.pid ? this.game.player : this.s.players.get(k)?.ent || null;
    if (ref[0] === 'o') return propById(this.game, k);
    return null;
  }
  onFx(m) {
    if (!Array.isArray(m.l)) return;
    const g = this.game;
    for (const e of m.l) {
      if (!Array.isArray(e)) continue;
      if (e[0] === 'dmg') {
        const target = this._resolve(e[1]);
        if (!target || target === g.player) continue; // the owner shows its own damage
        const src = this._resolve(e[2]);
        const [, , , amount, kind, crit, dtype, ability, blocked, dot, text] = e;
        const ev = { target, src, amount: num(amount), kind: str(kind, 12), crit: !!crit, dtype: str(dtype, 8) || 'phys', ability: str(ability, 24) || undefined, blocked: !!blocked, dot: !!dot, text: str(text, 24) || undefined };
        if (ev.kind === 'hit') {
          target.flash = ev.dot ? Math.max(target.flash || 0, 0.45) : 1;
          if (!ev.dot) {
            if (ev.blocked) { g.juice.chips(target.x, target.y, [0.95, 0.85, 0.6], 6, 0.6); g.audio?.play('mine', { x: target.x, y: target.y, volume: 0.6 }); }
            else {
              g.juice.hit(target.x, target.y, ev.crit, ev.dtype === 'fire' ? [1, 0.55, 0.15] : null);
              if (ev.dtype === 'phys') g.juice.blood(target.x, target.y, ev.crit ? 7 : 4);
              g.audio?.play(ev.crit ? 'crit' : 'hit', { x: target.x, y: target.y });
            }
          }
        } else if (ev.kind === 'stun') g.juice.stun(target);
        g.events.emit('damage', ev);
      } else if (e[0] === 'proj') fireCosmetic(g, str(e[1], 40), e.slice(2));
      else if (e[0] === 'pend') endCosmetic(g, str(e[1], 40), num(e[2]), num(e[3]), !!e[4], !!e[5]);
    }
  }

  debug() {
    return { role: 'guest', proxies: [...this.map.values()].map((e) => ({ nid: e.nid, species: e.species, name: e.name, level: e.level, dead: e.dead, x: +e.x.toFixed(2), y: +e.y.toFixed(2), state: e.state })) };
  }
}
