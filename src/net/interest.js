// Interest management of the world diffs (docs/STREAMING.md §8, docs/SYNC.md): on a planet, four players can be
// thousands of tiles apart — each guest only gets the world changes near it.
//
// Host side, per synced guest (session player `pl.int`):
//   stale  Set of chunks the guest is NOT up to date on (changes there were withheld, or left out of its snapshot)
// An op is LOCATED when OP_AT knows its place (structures, natural objects, tiles, crops, ground items, fishing bobbers):
// its chunk set. A located op goes to a guest when one of its chunks is near (≤ R_IN chunks, Chebyshev, x across the
// seam) and not stale — or when the guest is its owner (`by`); otherwise the guest gets a skip count instead (the seq
// numbers stay contiguous: net.js onOps) and the op's chunks become stale for it. Ops without a place (the clock,
// creatures, boats, bodies, camp crates, paths, terrain edits, players…) always go to everyone.
// Every frame (after the op flush) the stale chunks that came near a guest are sent as one chunk diff
//   { t: 'cd', s: seq, c: [chunks], d: serializeChunks(…) }   (net/snapshot.js; the guest applies it scoped: applyWorld 'chunk')
// The join / resync snapshot leaves out the far local rows (their chunks start stale). The digest (net/digest.js) of a
// guest skips its stale chunks and the ring around them (a building or a path can reach one chunk over): the host
// sends that list with each digest and both sides hash the same rows.
// Bounded worlds (the classic 256 × 256 map) are all near: nothing is withheld.

import { OPS } from './registry.js';
import { serializeChunks } from './snapshot.js';
import { CW, CH } from '../world/store.js';

export const R_IN = 4;          // chunks: a guest gets everything this near (its loading radius is 3, keep 5)
const MAX_CD = 24;              // chunks in one diff message (the rest the next frame)

// ---------- where an op happens: world points [x, y] (host, before it is applied) ----------
const P = (x, y) => (Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null);
const obj = (game, id) => game.world.objById.get(id) || game.touched?.get(id) || game.flora?.dyn?.get(id) || null;
const objP = (game, id) => { const o = obj(game, id); return o ? (o.building ? P(o.tx + 0.5, o.ty + 0.5) : P(o.x, o.y)) : null; };
const lootP = (game, id) => { for (const l of game.loot) if (l.id === id) return P(l.x0 ?? l.x, l.y0 ?? l.y); return null; };
const each = (list, f) => (Array.isArray(list) ? list.slice(0, 64).map(f) : []);
export const OP_AT = {
  'obj.add': (g, a) => each(a.list, (o) => P(o?.x, o?.y)),
  'obj.remove': (g, a) => each(a.ids, (id) => objP(g, id)),
  'obj.prog': (g, a) => [objP(g, a.id)],
  'tree.fell': (g, a) => [objP(g, a.id)],
  'tree.land': (g, a) => [objP(g, a.id)],
  'tree.stump': (g, a) => [objP(g, a.id)],
  'tree.solid': (g, a) => [objP(g, a.id)],
  'struct.add': (g, a) => each(a.list, (r) => P((r?.[2] ?? NaN) + 0.5, (r?.[3] ?? NaN) + 0.5)),
  'struct.paid': (g, a) => [objP(g, a.id)],
  'struct.progress': (g, a) => [objP(g, a.id)],
  'struct.complete': (g, a) => [objP(g, a.id)],
  'struct.remove': (g, a) => [objP(g, a.id)],
  'struct.dmg': (g, a) => [objP(g, a.id)],
  'siege.dmg': (g, a) => [objP(g, a.id)],
  'siege.step': (g, a) => [objP(g, a.id), P(a.tx + 0.5, a.ty + 0.5)], // (a pushed siege engine: where it was and where it goes)
  'struct.relocate': (g, a) => [objP(g, a.id), objP(g, a.src)],
  'struct.decon': (g, a) => each(a.ids, (id) => objP(g, id)),
  'struct.working': (g, a) => [objP(g, a.id)],
  'struct.style': (g, a) => each(a.list, (r) => objP(g, r?.[0])),
  'door.set': (g, a) => [objP(g, a.id)],
  'chest.set': (g, a) => [objP(g, a.id)],
  'dummy.hit': (g, a) => [objP(g, a.id)],
  'lv.collapse': (g, a) => each(a.ids, (id) => objP(g, id)),
  'roof.collapse': (g, a) => each(a.ids, (id) => objP(g, id)),
  'deck.collapse': (g, a) => each(a.ids, (id) => objP(g, id)),
  'tile.mine': (g, a) => [P(a.tx + 0.5, a.ty + 0.5)],
  'rock.prog': (g, a) => [Number.isInteger(a.i) ? P((a.i & 16383) + 0.5, (a.i >>> 14) + 0.5) : null],
  'crop.add': (g, a) => [P(a.tx + 0.5, a.ty + 0.5)],
  'crop.stage': (g, a) => [P(a.tx + 0.5, a.ty + 0.5)],
  'crop.remove': (g, a) => [P(a.tx + 0.5, a.ty + 0.5)],
  'loot.add': (g, a) => each(a.list, (r) => P(r?.[3], r?.[4])),
  'loot.take': (g, a) => [lootP(g, a.id)],
  'loot.expire': (g, a) => each(a.ids, (id) => lootP(g, id)),
  'fish.bob': (g, a) => [P(a.x, a.y)],
  'fish.end': (g, a) => [P(a.x, a.y)],
};

// the chunks of an op (null: global — it goes to everyone)
export function opChunks(game, name, args) {
  const f = OP_AT[name];
  if (!f || !game.world.wrap || !args) return null;
  let pts;
  try { pts = f(game, args); } catch { return null; }
  const w = game.world, out = [];
  for (const p of pts) {
    if (!p) return null; // (a place we cannot tell: safest is everyone)
    const c = w.chunkIndex(p[0], p[1]);
    if (c >= 0 && !out.includes(c)) out.push(c);
  }
  return out.length ? out : null;
}

// Chebyshev chunk distance between chunk c and a world point (x across the seam)
export function chunkDist(c, x, y) {
  const cx = c % CW, cy = Math.floor(c / CW), px = ((Math.floor(x / 64) % CW) + CW) % CW, py = Math.floor(y / 64);
  let dx = Math.abs(cx - px);
  if (dx > CW / 2) dx = CW - dx;
  return Math.max(dx, Math.abs(cy - py));
}

export class Interest {
  constructor(game, session) {
    this.game = game;
    this.s = session;
    this.stats = { withheld: 0, sent: 0, diffs: 0, diffChunks: 0, diffBytes: 0 };
    game.net.locate = (name, args) => opChunks(game, name, args); // (net.js emit: the place of each op)
  }
  get on() { return !!this.game.world.wrap; }

  // a guest (re)joins: its interest starts at (x, y); the chunks of the rows its snapshot left out are stale
  reset(pl, skipped) {
    pl.int = { stale: new Set(skipped || []) };
  }
  // the snapshot rows a guest at (x, y) gets (keep), the chunks left out going to `skipped`
  keepNear(x, y) {
    const w = this.game.world;
    return (px, py) => chunkDist(w.chunkIndex(px, py), x, y) <= R_IN;
  }
  near(pl, c) { const a = pl.av; return !a || chunkDist(c, a.x, a.y) <= R_IN; }

  // the op batch for one guest: withheld ops become skip counts (consecutive ones merged)
  batchFor(pl, msg) {
    const L = msg.l, C = msg.c;
    if (!this.on || !pl.int || !C) return { t: 'ops', s: msg.s, l: L };
    const st = pl.int.stale;
    let out = null;
    for (let k = 0; k < L.length; k++) {
      const cs = C[k];
      let send = true;
      if (cs) {
        send = (L[k][1] && L[k][1].by === pl.pid) || cs.some((c) => !st.has(c) && this.near(pl, c));
        if (!send) for (const c of cs) st.add(c);
      }
      if (send) { if (out) out.push(L[k]); this.stats.sent++; continue; }
      this.stats.withheld++;
      if (!out) out = L.slice(0, k);
      const last = out[out.length - 1];
      if (typeof last === 'number') out[out.length - 1] = last + 1; else out.push(1);
    }
    return out ? { t: 'ops', s: msg.s, l: out } : { t: 'ops', s: msg.s, l: L };
  }

  // after the flush: the stale chunks that came near each guest, as chunk diffs
  update() {
    if (!this.on) return;
    for (const pl of this.s.syncedGuests()) {
      const I = pl.int;
      if (!I || !I.stale.size || !pl.av) continue;
      const due = [];
      for (const c of I.stale) if (this.near(pl, c)) { due.push(c); if (due.length >= MAX_CD) break; }
      if (!due.length) continue;
      for (const c of due) I.stale.delete(c);
      const d = serializeChunks(this.game, new Set(due));
      const msg = { t: 'cd', s: this.game.net.seq, c: due, d };
      this.s._sendTo(pl.key, msg);
      this.stats.diffs++; this.stats.diffChunks += due.length;
    }
  }

  // the chunks a guest's digest leaves out: its stale chunks and the ring around them (sorted, for the dg message)
  excluded(pid) {
    const pl = this.s.players.get(pid), st = pl?.int?.stale;
    if (!this.on || !st || !st.size) return null;
    const ex = new Set();
    for (const c of st) {
      const cx = c % CW, cy = Math.floor(c / CW);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const y = cy + dy;
        if (y < 0 || y >= CH) continue;
        ex.add(y * CW + (((cx + dx) % CW) + CW) % CW);
      }
    }
    return [...ex].sort((a, b) => a - b);
  }

  debug() {
    const g = {};
    for (const pl of this.s.players.values()) if (pl.int) g[pl.pid] = { stale: [...pl.int.stale].sort((a, b) => a - b) };
    return { ...this.stats, guests: g };
  }
}
