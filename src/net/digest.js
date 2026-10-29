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

export const EXACT_PARTS = ['nat', 'dyn', 'structs', 'tiles', 'loot', 'crops', 'props', 'paths'];
// fields that never take part in a comparison (cosmetic / derived); new runtime fields on shared objects
// must be set in an op applier, serialized in snapshot.js and listed in the rows below, or listed here.
export const COSMETIC_FIELDS = ['shake', 'flash', 'alpha', 'age', 'fall', 'workT', 'light', 'lift', 'vx', 'vy', 'vlift', 'ph', 't'];

const fnv = (s, h = 2166136261) => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };
function fnvBytes(a) { let h = 2166136261; for (let i = 0; i < a.length; i++) { h ^= a[i]; h = Math.imul(h, 16777619) >>> 0; } return (h >>> 0).toString(36); }
const r10 = (v) => Math.round((v || 0) * 10);

export function dumpPart(game, part) {
  const w = game.world;
  switch (part) {
    case 'nat': {
      const out = [];
      for (const o of game.touched.values()) {
        if (o.flora || o.building || o.type === 'crop') continue;
        if (o.gone) out.push([o.id, 'gone']);
        else if (o.stump || o.prog) out.push([o.id, o.stump ? 1 : 0, r10(o.prog)]);
      }
      return out.sort(cmp);
    }
    case 'dyn': return [...game.flora.dyn.values()].filter((o) => !o.gone)
      .map((o) => [o.id, o.type, o.x.toFixed(2), o.y.toFixed(2), o.v | 0, o.stump ? 1 : 0, o.solid > 0 ? 1 : 0, o.born == null ? null : Math.round(o.born)]).sort(cmp);
    case 'structs': return game.build.structures.map((o) => [o.id, o.type, o.tx, o.ty, r10(o.progress), o.mask | 0, o.orient || 0,
      game.build.decon.has(o) ? 1 : 0, o.working ? 1 : 0, o.store ? JSON.stringify(o.store.toJSON()) : 0, o.rot | 0, o.paid ? 1 : 0, o.open ? 1 : 0, o.moveOf || 0]).sort(cmp);
    case 'tiles': return [['rock', fnvBytes(w.rock)], ['solid', fnvBytes(w.solid)], ['mined', [...game.minedTiles].sort((a, b) => a - b).join(',')]];
    case 'loot': return game.loot.filter((l) => l.qty > 0).map((l) => [l.id, l.item, l.qty]).sort(cmp);
    case 'crops': return [...game.farm.crops.values()].map((c) => [`${c.tx},${c.ty}`, c.kind, c.stage]).sort(cmp);
    case 'props': return (game.props || []).map((o) => [o.id, o.hp | 0, o.broken ? 1 : 0]).sort(cmp);
    case 'paths': return pathRows(game); // [chunk, hash(world.path), hash(world.pathPlan)] of chunks with paths
    case 'env': return [['day', game.env.dayIndex], ['hour', +game.env.hour.toFixed(2)], ['weather', game.env.weather], ['wt', Math.round(game.worldTime)]];
    case 'ents': return game.net.entsApi?.debug?.() || null;
  }
  return null;
}
const cmp = (a, b) => (String(a[0]) < String(b[0]) ? -1 : String(a[0]) > String(b[0]) ? 1 : 0);

export function computeDigest(game) {
  const parts = {}, counts = {};
  for (const p of EXACT_PARTS) {
    const rows = dumpPart(game, p);
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
  net.hooks.digest = () => computeDigest(game);
  net.hooks.dump = (part) => dumpPart(game, part);
  net.hooks.diff = diff;
  net.hooks.selfTest = () => {
    const chk = game.A.check || checkAtlas(game.A);
    return {
      atlasOk: chk.ok, atlasDigest: chk.digest, placeholders: chk.placeholders, failures: chk.failures,
      missingSprites: chk.missingSprites.concat(chk.missingKinds), speciesFallbacks: chk.speciesFallbacks,
      artWarnings: artWarnings(), systemsUntagged: game.systems.filter((s) => !s.sync).map((s) => s.constructor?.name || '?'),
      role: net.role, synced: net.synced, seq: net.seq,
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
    const d = computeDigest(this.game);
    for (const pl of guests) this.s._sendTo(pl.key, { t: 'dg', s: d.seq, parts: d.parts, counts: d.counts, ents: this.s.ents?.interestRows(pl.pid) || [], env: dumpPart(this.game, 'env') });
  }
  onRequest(key, m) {
    this.game.net.flush();
    const parts = Array.isArray(m.parts) ? m.parts.filter((p) => EXACT_PARTS.includes(p)).slice(0, 8) : [];
    for (const part of parts) this.s._sendTo(key, { t: 'dgr', part, s: this.game.net.seq, rows: dumpPart(this.game, part) });
  }
}

// ---------- guest ----------
export class DigestGuest {
  constructor(game, session) { this.game = game; this.s = session; this.recent = []; this.warned = 0; this.entsWarnT = 0; }

  onDigest(m) {
    const net = this.game.net;
    if (!net.synced || !m.parts) return;
    if ((m.s | 0) !== net.seq) return; // still catching up (resync in flight)
    const mine = computeDigest(this.game);
    const bad = EXACT_PARTS.filter((p) => m.parts[p] && mine.parts[p] !== m.parts[p]);
    if (bad.length) this.s.sendHost({ t: 'dgx', parts: bad });
    this._checkEnts(m.ents);
    this._checkEnv(m.env);
  }

  onRows(m) {
    const part = typeof m.part === 'string' ? m.part : '';
    if (!EXACT_PARTS.includes(part) || !Array.isArray(m.rows)) return;
    if ((m.s | 0) !== this.game.net.seq) return;
    const d = diff(m.rows, dumpPart(this.game, part));
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
