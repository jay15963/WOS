// Desync detector + debug API (docs/SYNC.md §4.3 / §4.4).
// Canonical rows of the shared world (cosmetic fields excluded: shake, flash, alpha, _openT, _*, loot x/y,
// sapling age, fall progress) hashed per part. Every 5 s the host sends {t:'dg', s, parts, ents} right after
// its op flush; the ordered channel guarantees the guest has applied exactly the ops ≤ s, so exact parts
// must match. On a mismatch the guest asks for the rows (dgx → dgr), logs the first differences as a
// netlog 'sync' error, emits game.events 'desync' and requests a resync (≤ 1 per 30 s).
//
// game.net.digest() → { seq, parts, counts } · net.dump(part) → rows · net.diff(a, b) · net.selfTest()

import { netlog } from './netlog.js';
import { checkAtlas } from '../game/artcheck.js';
import { artWarnings } from '../game/artcompat.js';
import { pathRows } from '../game/mut/paths.js';
import { chunkOfI } from '../world/store.js';
import { campStateRows } from '../game/mut/camps.js';

export const EXACT_PARTS = ['nat', 'dyn', 'structs', 'tiles', 'loot', 'crops', 'props', 'corpses', 'paths', 'boats'];
// fields that never take part in a comparison (cosmetic / derived); new runtime fields on shared objects
// must be set in an op applier, serialized in snapshot.js and listed in the rows below, or listed here.
export const COSMETIC_FIELDS = ['shake', 'flash', 'alpha', 'age', 'fall', 'workT', 'light', 'lift', 'vx', 'vy', 'vlift', 'ph', 't', 'rotten'];

const fnv = (s, h = 2166136261) => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };
// hash of a store layer (docs/STREAMING.md): a sparse one by its non-zero tiles; a chunk-backed one (rock, roof) by the
// pages of the chunks holding a mined tile only (`only`: the same set on every peer — the rest is the pristine source)
function fnvLayer(w, L, only = null, skip = null) {
  const dirtyOnly = !!only;
  let h = 2166136261;
  const mix = (v) => { h ^= v & 255; h = Math.imul(h, 16777619) >>> 0; h ^= (v >>> 8) & 255; h = Math.imul(h, 16777619) >>> 0; h ^= (v >>> 16) & 255; h = Math.imul(h, 16777619) >>> 0; };
  for (const c of L.chunks()) {
    if ((dirtyOnly && !only.has(c)) || (skip && skip.has(c))) continue;
    const p = L.pages[c];
    if (dirtyOnly) { mix(c); for (let l = 0; l < p.length; l++) { h ^= p[l]; h = Math.imul(h, 16777619) >>> 0; } continue; }
    for (let l = 0; l < p.length; l++) if (p[l]) { mix(c * 4096 + l); h ^= p[l]; h = Math.imul(h, 16777619) >>> 0; }
  }
  return (h >>> 0).toString(36);
}
const r10 = (v) => Math.round((v || 0) * 10);

// ex: chunks left out (interest: a guest's stale chunks and the ring around them — net/interest.js); the local rows
// there are skipped (natural objects, flora, structures, tiles, ground items, crops)
export function dumpPart(game, part, ex = null) {
  const w = game.world;
  const X = ex && ex.size ? ex : null, OK = (x, y) => !X || !X.has(w.chunkIndex(x, y));
  switch (part) {
    case 'nat': {
      const out = [];
      for (const o of game.touched.values()) {
        if (o.flora || o.building || o.type === 'crop' || !OK(o.x, o.y)) continue;
        if (o.gone) out.push([o.id, 'gone']);
        else if (o.stump || o.prog) out.push([o.id, o.stump ? 1 : 0, r10(o.prog)]);
      }
      return out.sort(cmp);
    }
    case 'dyn': return [...game.flora.dyn.values()].filter((o) => !o.gone && OK(o.x, o.y))
      .map((o) => [o.id, o.type, o.x.toFixed(2), o.y.toFixed(2), o.v | 0, o.stump ? 1 : 0, o.solid > 0 ? 1 : 0, o.born == null ? null : Math.round(o.born)]).sort(cmp);
    case 'structs': return game.build.structures.filter((o) => OK(o.tx + 0.5, o.ty + 0.5)).map((o) => [o.id, o.type, o.tx, o.ty, r10(o.progress), o.mask | 0, o.orient || 0,
      game.build.decon.has(o) ? 1 : 0, o.working ? 1 : 0, o.store ? JSON.stringify(o.store.toJSON()) : 0, o.rot | 0, o.paid ? 1 : 0, o.open ? 1 : 0, o.moveOf || 0, o.style || '', o.det || '', o.lv | 0]).sort(cmp); // (lv: levels, agent L)
    case 'tiles': {
      const mt = X ? game.minedTiles.filter((i) => !X.has(chunkOfI(i))) : game.minedTiles;
      const mc = new Set(mt.map((i) => chunkOfI(i)));
      return [['rock', fnvLayer(w, w.rock, mc)], ['solid', fnvLayer(w, w.solid, null, X)], ['mined', [...mt].sort((a, b) => a - b).join(',')],
        ['roof', fnvLayer(w, w.roof, mc)], ['broof', fnvLayer(w, w.broof, null, X)],
        ['tun', w.tunnels ? [...w.tunnels].sort((a, b) => a[0] - b[0]).map((r) => r[0] + ':' + Math.round(r[1] * 100)).join(',') : '']]; // (tunnels: docs/TERRAIN-HEIGHT.md)
    }
    case 'loot': return game.loot.filter((l) => l.qty > 0 && OK(l.x0 ?? l.x, l.y0 ?? l.y)).map((l) => [l.id, l.item, l.qty]).sort(cmp);
    case 'crops': return [...game.farm.crops.values()].filter((c) => OK(c.tx + 0.5, c.ty + 0.5)).map((c) => [`${c.tx},${c.ty}`, c.kind, c.stage]).sort(cmp);
    // camp crates: their shared state (non-default rows, loaded or not: mut/camps.js); training dummies (structures)
    case 'props': return campStateRows(game).map((r) => [r[0], r[1], r[2]]).concat((game.props || []).filter((o) => o.dummy).map((o) => [o.id, o.hp | 0, 0])).sort(cmp);
    case 'corpses': return game.corpses ? [...game.corpses.map.values()].map((c) => [c.id, c.of, c.x.toFixed(2), c.y.toFixed(2), Math.round(c.deathT), c.butchered ? 1 : 0,
      c.owner || 0, c.store ? JSON.stringify(c.store.toJSON()) : 0]).sort(cmp) : [];
    case 'paths': return pathRows(game); // [chunk, hash(world.path), hash(world.pathPlan)] of chunks with paths
    case 'boats': return game.boats ? [...game.boats.map.values()].map((b) => [b.id, b.x.toFixed(2), b.y.toFixed(2), b.h.toFixed(2), b.seats.join('.'), b.pets.map((q) => q.join(':')).join('.')]).sort(cmp) : []; // (game/boats.js)
    case 'env': return [['day', game.env.dayIndex], ['hour', +game.env.hour.toFixed(2)], ['weather', game.env.weather], ['wt', Math.round(game.worldTime)]];
    case 'ents': return game.net.entsApi?.debug?.() || null;
  }
  return null;
}
const cmp = (a, b) => (String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0);

export function computeDigest(game, ex = null) {
  const parts = {}, counts = {};
  const X = ex ? (ex instanceof Set ? ex : new Set(ex)) : null;
  for (const p of EXACT_PARTS) {
    const rows = dumpPart(game, p, X);
    counts[p] = rows.length;
    parts[p] = fnv(JSON.stringify(rows)).toString(36);
  }
  return { seq: game.net.seq, parts, counts };
}

// diff two digests ({parts}) or two row arrays (keyed by row[0])
export function diff(a, b) {
  if (a && b && a.parts && b.parts) {
    const out = [];
    for (const k of new Set([...Object.keys(a.parts), ...Object.keys(b.parts)])) if (a.parts[k] !== b.parts[k]) out.push(k);
    return out;
  }
  const A = new Map((a || []).map((r) => [String(Array.isArray(r) ? r[0] : r), JSON.stringify(r)]));
  const B = new Map((b || []).map((r) => [String(Array.isArray(r) ? r[0] : r), JSON.stringify(r)]));
  const missing = [], extra = [], changed = [];
  for (const [k, v] of A) { if (!B.has(k)) missing.push(k); else if (B.get(k) !== v) changed.push(k); }
  for (const k of B.keys()) if (!A.has(k)) extra.push(k);
  return { missing, extra, changed, count: missing.length + extra.length + changed.length };
}

// debug / test API on game.net (works in solo, host and guest)
export function installNetDebug(game) {
  const net = game.net;
  net.hooks.digest = (ex) => computeDigest(game, ex);
  net.hooks.dump = (part, ex) => dumpPart(game, part, ex ? (ex instanceof Set ? ex : new Set(ex)) : null);
  net.hooks.diff = diff;
  net.hooks.selfTest = () => {
    const chk = game.A.check || checkAtlas(game.A);
    return {
      atlasOk: chk.ok, atlasDigest: chk.digest, placeholders: chk.placeholders, failures: chk.failures,
      missingSprites: chk.missingSprites.concat(chk.missingKinds, chk.lazyMissing || []), speciesFallbacks: chk.speciesFallbacks, lazyDefs: chk.lazyDefs, lazyDigest: chk.lazyDigest, // agent K: lazily painted sprites (registry, not pixels)
      artWarnings: artWarnings(), systemsUntagged: game.systems.filter((s) => !s.sync).map((s) => s.constructor?.name || '?'),
      role: net.role, synced: net.synced, seq: net.seq,
      // agent H: look parts are painted lazily per client (not in the atlas digest); failures must stay empty
      look: game.A.look ? game.A.look.stats() : null,
    };
  };
}

// ---------- host ----------
export class DigestHost {
  constructor(game, session) { this.game = game; this.s = session; this.t = 5; }
  tick(dt) {
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 5;
    const guests = this.s.syncedGuests();
    if (!guests.length) return;
    const net = this.game.net;
    net.flush(); // everything applied so far goes out before the digest (same ordered channel)
    this.s.interest?.update(); // (and the chunk diffs due: the guest hashes after them)
    // each guest: the world without its stale chunks (interest, net/interest.js) — the host names them
    const all = computeDigest(this.game);
    for (const pl of guests) {
      const ex = this.s.interest?.excluded(pl.pid) || null;
      const d = ex ? computeDigest(this.game, ex) : all;
      this.s._sendTo(pl.key, { t: 'dg', s: d.seq, parts: d.parts, counts: d.counts, ex: ex || undefined, ents: this.s.ents?.interestRows(pl.pid) || [], env: dumpPart(this.game, 'env') });
    }
  }
  onRequest(key, m) {
    this.game.net.flush();
    const pid = this.s.keyToPid?.get(key), ex = pid ? this.s.interest?.excluded(pid) : null, X = ex ? new Set(ex) : null;
    const parts = Array.isArray(m.parts) ? m.parts.filter((p) => EXACT_PARTS.includes(p)).slice(0, 8) : [];
    for (const part of parts) this.s._sendTo(key, { t: 'dgr', part, s: this.game.net.seq, rows: dumpPart(this.game, part, X), ex: ex || undefined });
  }
}

// ---------- guest ----------
export class DigestGuest {
  constructor(game, session) { this.game = game; this.s = session; this.recent = []; this.warned = 0; this.entsWarnT = 0; }

  onDigest(m) {
    const net = this.game.net;
    if (!net.synced || !m.parts) return;
    if ((m.s | 0) !== net.seq) return; // still catching up (resync in flight)
    this.ex = Array.isArray(m.ex) ? new Set(m.ex.filter((c) => Number.isInteger(c))) : null; // (the chunks the host left out: interest)
    const mine = computeDigest(this.game, this.ex);
    const bad = EXACT_PARTS.filter((p) => m.parts[p] && mine.parts[p] !== m.parts[p]);
    if (bad.length) this.s.sendHost({ t: 'dgx', parts: bad });
    this._checkEnts(m.ents);
    this._checkEnv(m.env);
  }

  onRows(m) {
    const part = typeof m.part === 'string' ? m.part : '';
    if (!EXACT_PARTS.includes(part) || !Array.isArray(m.rows)) return;
    if ((m.s | 0) !== this.game.net.seq) return;
    const ex = Array.isArray(m.ex) ? new Set(m.ex.filter((c) => Number.isInteger(c))) : null;
    const d = diff(m.rows, dumpPart(this.game, part, ex));
    if (!d.count) return; // fixed itself in between
    const sample = [...d.missing.map((k) => `${k} ausente`), ...d.extra.map((k) => `${k} sobrando`), ...d.changed.map((k) => `${k} diferente`)].slice(0, 20);
    this._desync(part, `Dessincronia em ${part}: ${d.count} diferença(s) (${sample.join(', ')})`, d);
  }

  _desync(part, msg, detail) {
    const net = this.game.net, now = performance.now() / 1000;
    netlog.error('sync', msg);
    net.stats.desyncs++;
    this.game.events.emit('desync', { part, msg, detail });
    this.recent = this.recent.filter((t) => now - t < 300);
    this.recent.push(now);
    if (this.recent.length >= 3 && now - this.warned > 300) {
      this.warned = now;
      this.game.events.emit('toast', { text: 'Problema de sincronização — veja o Diagnóstico', kind: 'warn' });
    }
    net.requestResync('dessincronia em ' + part);
  }

  // creatures: species / life exact, positions within a few tiles (interpolation runs 150 ms behind)
  _checkEnts(rows) {
    if (!Array.isArray(rows) || !this.s.ents) return;
    const bad = [];
    let far = 0;
    for (const r of rows) {
      if (!Array.isArray(r)) continue;
      const e = this.s.ents.byNid(r[0]);
      if (!e) { bad.push(`${r[0]} ausente`); continue; }
      if (e.species !== r[1]) bad.push(`${r[0]} espécie ${e.species}≠${r[1]}`);
      else if (!!e.dead !== !!r[2]) { if (!r[2]) bad.push(`${r[0]} morto só aqui`); }
      else if (!e.dead && Math.hypot(e.x - r[3], e.y - r[4]) > 4) far++;
    }
    if (bad.length) this._desync('ents', `Dessincronia em ents: ${bad.length} diferença(s) (${bad.slice(0, 20).join(', ')})`, bad);
    else if (far && performance.now() / 1000 - this.entsWarnT > 30) { this.entsWarnT = performance.now() / 1000; netlog.warn('sync', `Criaturas atrasadas: ${far} a mais de 4 tiles (rede lenta?)`); }
  }

  _checkEnv(rows) {
    if (!Array.isArray(rows)) return;
    const h = Object.fromEntries(rows), E = this.game.env;
    let dh = Math.abs((h.hour ?? E.hour) - E.hour); if (dh > 12) dh = 24 - dh;
    if (h.day !== E.dayIndex && dh > 0.1) netlog.warn('sync', `Dia diferente do anfitrião (${E.dayIndex} ≠ ${h.day})`);
    if (Math.abs((h.wt ?? 0) - this.game.worldTime) > 3) netlog.warn('sync', `Relógio do mundo diferente (${Math.round(this.game.worldTime)} ≠ ${h.wt})`);
  }
}
