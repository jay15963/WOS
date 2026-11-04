// Piers (trapiche) and bridges (ponte): structures on the 'deck' layer (content/buildings.js `deck: 'pier' | 'bridge'`),
// walkable over the water. Docs: docs/PLAN-V2.md "Trapiche e ponte", docs/CAMERA-ROTATION.md (the procedural look).
//
// Rules (placement: deckReason, shared by the preview and the host's build.place; work: startReason in build.hit start):
//   - pier: shallow water only (world.water 1), next to the bank (any land tile) or to another pier piece; any shape
//     (branches, platforms). Each piece starts only next to the bank or a finished piece. It never collapses (piles).
//   - bridge: one straight line per bridge (no corners, no crossings, no bridges side by side). A piece on land is an
//     abutment (cabeceira): next to the water, or next to a bridge piece over the water on its line. A piece over the water
//     (shallow or deep) continues a line that reaches an abutment, and a run of water pieces is at most MAX_SPAN long. The
//     work goes piece by piece from a bank (a water piece needs a finished neighbour on its line). Finished water pieces
//     not joined (through finished pieces) to a finished abutment fall into the water (host: mut/decks.js deck.collapse).
//   - small things (lights, chests, seats, decoration: deckFriendly) may stand on a deck tile; they are built after the
//     deck under them and lifted to its top (o._dkh, art/faces/solid.js). A deck with something on it is not removed.
//
// Derived on every peer from the replicated structures (game.build.v), no extra sync:
//   world.deck  Uint8Array: 1 finished pier / 2 finished bridge — the water under it is ground (world.js liquidAt /
//               blocked / speedAt, physics.tileBlocked): no swimming, creatures path across (nav.js).
//   world.rail  Uint8Array | null: railed edges of finished bridges (bits N 1 E 2 S 4 W 8, both tiles of an edge) —
//               thin walls for whoever is on a deck (physics.railHit / railCross, nav.js, levels.js).
//   world.railU Uint8Array | null: the walls at the water level around finished bridges — the abutments' (and islands')
//               sides and their stone faces toward the water, the support bents between two water pieces — for whoever
//               is on the ground or under a deck: swimmers / waders / ice walkers pass under a bridge between its bents,
//               entering through its railed sides (physics.js e._ud). The railings themselves are no walls down there.
//   o._dk       the shape of a deck piece (cosmetic: role, axis, heights, neighbours, piles…) read by art/faces/deck.js,
//               which caches its geometry until o._dk.sig changes.
//   e._dh       how high an entity stands on a deck (cosmetic, eased: game.js lifts its sprite and its depth); 0 under one.

import { Layer } from '../world/store.js'; // sparse deck / railing layers (docs/STREAMING.md)
import { BUILDINGS } from './data.js';
import { CLEARABLE, objectsOnTile, structsOfType } from './mut/structures.js';
import { collides, railHit, deckTrack } from './physics.js';
const DECK_TYPES = Object.keys(BUILDINGS).filter((t) => BUILDINGS[t].deck); // (rebuild: skipped while there is none)

export const PIER_H = 0.2;     // pier deck top over the water (tiles)
export const BRIDGE_H = 0.3;   // bridge deck at the banks
export const LOW_H = 0.03;     // where an abutment ramp meets the ground
export const MAX_SPAN = 8;     // water tiles one bridge may cross
export const RAMP = 0.34;      // a pier's boards reach this far onto the bank
const DIR = [[0, -1, 1], [1, 0, 2], [0, 1, 4], [-1, 0, 8]]; // N E S W (dx, dy, bit)
const OPP = { 1: 4, 2: 8, 4: 1, 8: 2 };

const kindOfType = (t) => BUILDINGS[t]?.deck || null;
export const isDeckType = (t) => !!BUILDINGS[t]?.deck;

// what may stand on a deck tile: small main-layer pieces (lights, chests, seats, decoration) — no walls / fences / doors /
// stairs / multi-tile furniture
export function deckFriendly(type) {
  const d = BUILDINGS[type];
  if (!d || d.layer !== 'main' || d.deck || d.roof || d.connect || d.mount) return false;
  if (d.block === 'tile' || d.block === 'door' || d.block === 'stairs') return false;
  const s = d.size || [1, 1];
  return s[0] === 1 && s[1] === 1;
}

// ---------- placement ----------
const landAt = (w, x, y) => w.inBounds(x, y) && !w.water.get(w.idx(x, y)) && !w.rock.get(w.idx(x, y));
// a terrain cliff tile (world/height.js): nobody walks onto it, so no deck goes on it or starts from it
const steep = (w, x, y) => w.hasHeight && w.inBounds(x, y) && w.isCliff(x, y);
const STEEP = 'Barranco íngreme demais: procure uma margem mais baixa';
const wetAt = (w, x, y) => w.inBounds(x, y) && w.water.get(w.idx(x, y)) > 0;
// kind of the deck piece on (x, y): built / planned, or accepted earlier in the same placement (batch: tile → type)
function kindAt(game, x, y, batch) {
  const w = game.world;
  if (!w.inBounds(x, y)) return null;
  const i = w.idx(x, y), o = game.build.grid.deck.get(i);
  if (o) return kindOfType(o.type);
  const t = batch ? batch.get(i) : null;
  return t ? kindOfType(t) : null;
}
const bridgeAt = (game, x, y, batch) => kindAt(game, x, y, batch) === 'bridge';

// null = ok; 'exists'; or the reason in pt-BR (same contract as placeReason)
export function deckReason(game, type, tx, ty, lv = 0, batch = null) {
  const w = game.world, kind = kindOfType(type);
  if (lv > 0) return 'Só no térreo (na água ou na margem)';
  if (!w.inside(tx, ty, 1)) return 'Fora do mapa';
  const i = w.idx(tx, ty), G = game.build.grid;
  if (w.rock.get(i)) return 'Rocha no caminho';
  if (steep(w, tx, ty)) return STEEP; // (a cliff tile blocks walking: physics.tileBlocked — the deck would be out of reach)
  if (G.deck.has(i) || (batch && batch.has(i))) return 'exists';
  if (G.main.has(i) || G.floor.has(i) || G.rug.has(i) || w.solid.get(i)) return 'Algo no caminho';
  for (const o of objectsOnTile(game, tx, ty)) {
    if (CLEARABLE.has(o.type)) continue;
    if (o.type === 'crop') return 'Plantação no caminho';
    return o.type.startsWith('tree_') ? (o.stump ? 'Toco no caminho' : 'Árvore no caminho') : o.type === 'boulder' ? 'Pedregulho no caminho' : 'Algo no caminho';
  }
  return kind === 'pier' ? pierReason(game, tx, ty, batch) : bridgeReason(game, tx, ty, batch);
}

function pierReason(game, tx, ty, batch) {
  const w = game.world, wv = w.water.get(w.idx(tx, ty));
  if (!wv) return 'Só em água rasa: comece na beira da margem';
  if (wv === 2) return 'Só em água rasa (aqui é fundo: faça uma ponte)';
  let high = false;
  for (const [dx, dy] of DIR) {
    if (kindAt(game, tx + dx, ty + dy, batch) === 'pier') return null;
    if (landAt(w, tx + dx, ty + dy)) { if (!steep(w, tx + dx, ty + dy)) return null; high = true; }
  }
  return high ? STEEP : 'Precisa começar na margem (ou emendar num trapiche)';
}

// the axes of the bridge pieces around (x, y): 1 = north-south, 2 = east-west (3 = both: a corner / crossing)
function nbAxis(game, x, y, batch) {
  const ns = bridgeAt(game, x, y - 1, batch) || bridgeAt(game, x, y + 1, batch);
  const ew = bridgeAt(game, x - 1, y, batch) || bridgeAt(game, x + 1, y, batch);
  return (ns ? 1 : 0) | (ew ? 2 : 0);
}
const STRAIGHT = 'A ponte é reta: sem curvas, cruzamentos ou pontes lado a lado';

function bridgeReason(game, tx, ty, batch) {
  const w = game.world, wet = wetAt(w, tx, ty);
  const ax = nbAxis(game, tx, ty, batch);
  if (ax === 3) return STRAIGHT;
  // a neighbour that would turn a corner / get a second line through this piece
  for (const [dx, dy] of DIR) {
    if (!bridgeAt(game, tx + dx, ty + dy, batch)) continue;
    const side = dx ? bridgeAt(game, tx + dx, ty - 1, batch) || bridgeAt(game, tx + dx, ty + 1, batch) : bridgeAt(game, tx - 1, ty + dy, batch) || bridgeAt(game, tx + 1, ty + dy, batch);
    if (side) return STRAIGHT;
  }
  if (!wet) {
    // the bank: an abutment next to the water (on its line when it joins a bridge already there)
    if (ax) {
      for (const [dx, dy] of DIR) if (bridgeAt(game, tx + dx, ty + dy, batch) && wetAt(w, tx + dx, ty + dy)) return null;
      return 'A cabeceira vai na margem, colada na ponte sobre a água';
    }
    for (const [dx, dy] of DIR) if (wetAt(w, tx + dx, ty + dy)) return null;
    return 'A ponte começa na margem, encostada na água';
  }
  if (!ax) return 'Precisa começar em terra (na margem)';
  const dx = ax === 2 ? 1 : 0, dy = ax === 1 ? 1 : 0;
  let n = 1, land = false;
  for (const s of [-1, 1]) {
    for (let k = 1; k <= MAX_SPAN + 1; k++) {
      const x = tx + dx * s * k, y = ty + dy * s * k;
      if (!bridgeAt(game, x, y, batch)) break;
      if (!wetAt(w, x, y)) { land = true; break; }
      n++;
    }
  }
  if (!land) return 'Precisa começar em terra (na margem)';
  if (n > MAX_SPAN) return `Ponte de no máximo ${MAX_SPAN} tiles de água`;
  return null;
}

// a drag across the water may start on either end: the pieces that can go now first (the bank, an existing piece), then
// outward — so each one finds its anchor among those before it (the host and the preview pass them as a batch)
export function orderDeckTiles(game, type, tiles) {
  const w = game.world, left = tiles.slice(), out = [], batch = new Map();
  for (let pass = 0; pass < 24 && left.length; pass++) {
    let any = false;
    for (let k = 0; k < left.length; k++) {
      const [x, y] = left[k];
      if (deckReason(game, type, x, y, 0, batch)) continue;
      batch.set(w.idx(x, y), type); out.push(left[k]); left.splice(k--, 1); any = true;
    }
    if (!any) break;
  }
  return out.concat(left);
}

// ---------- derived state ----------
const sideBits = (nb) => (nb & 1 ? 1 : 0) + (nb & 2 ? 1 : 0) + (nb & 4 ? 1 : 0) + (nb & 8 ? 1 : 0);
const lerp = (a, b, t) => a + (b - a) * t;

export class Decks {
  constructor(game) {
    this.game = game;
    this.v = -1;
    this.any = false;      // any deck piece (planned or built)
    this.list = [];        // deck structures (ground level, not move plans)
    this.at = new Map();   // tile → deck structure
    this.ramp = new Map(); // bank tile → bits of the sides with a finished pier piece (its boards come up onto the bank)
    this.had = false;
  }

  sync() { const v = this.game.build.v; if (v !== this.v) { this.v = v; this.rebuild(); } }

  rebuild() {
    const g = this.game, w = g.world, N = w.W * w.H;
    const list = this.list, at = this.at;
    // (no deck piece now nor before: nothing to scan — a city holds ~18 000 pieces and its chunks change the structures
    // every frame while they are made: docs/REINOS.md "Fase 2 — correções e desempenho")
    const was = this.any;
    if (!was && !DECK_TYPES.some((t) => structsOfType(g, t).size)) { list.length = 0; at.clear(); this.ramp.clear(); return; }
    list.length = 0; at.clear(); this.ramp.clear();
    for (const o of g.build.structures) if (!o.lv && !o.moveOf && BUILDINGS[o.type]?.deck) { list.push(o); at.set(w.idx(o.tx, o.ty), o); }
    this.any = list.length > 0;
    const oldRail = w.rail, oldU = w.railU;
    if (!this.any) {
      if (w.deck) w.deck.fill(0);
      w.rail = null; w.railU = null;
      for (const o of g.build.structures) if (o._dkh) o._dkh = 0;
      return;
    }
    if (!w.deck) w.deck = new Layer('deck', Uint8Array, 0, { sparse: true }); else w.deck.clear(); // (sparse store layer)
    for (const o of list) if (!o.blueprint) w.deck.set(w.idx(o.tx, o.ty), kindOfType(o.type) === 'pier' ? 1 : 2);
    // shapes (planned pieces included: the look connects to the plan, the ghost fills the rest)
    const has = (x, y, k) => { if (!w.inBounds(x, y)) return null; const o = at.get(w.idx(x, y)); return o && kindOfType(o.type) === k ? o : null; };
    for (const o of list) if (kindOfType(o.type) === 'pier') describePier(w, o, has, o._dk || (o._dk = {}));
    describeBridges(w, list, has);
    // walking: ramps of finished piers onto the bank, railings of finished bridges (on the deck) and the walls at the
    // water around them (on the ground / under a deck: abutments, bents)
    let rail = null, railU = null;
    const wall = (A, o, dx, dy, b) => { const i = w.idx(o.tx, o.ty); A.set(i, A.get(i) | b); if (w.inBounds(o.tx + dx, o.ty + dy)) { const j = w.idx(o.tx + dx, o.ty + dy); A.set(j, A.get(j) | OPP[b]); } };
    for (const o of list) {
      if (o.blueprint) continue;
      const d = o._dk;
      if (d.k === 'pier') {
        for (const [dx, dy, b] of DIR) if (d.land & b) { const j = w.idx(o.tx + dx, o.ty + dy); this.ramp.set(j, (this.ramp.get(j) || 0) | OPP[b]); }
      } else if (d.rails) {
        rail ||= new Layer('rail', Uint8Array, 0, { sparse: true }); railU ||= new Layer('railU', Uint8Array, 0, { sparse: true });
        for (const [dx, dy, b] of DIR) if (d.rails & b) { wall(rail, o, dx, dy, b); if (!d.wet) wall(railU, o, dx, dy, b); } // (an abutment's sides: stone at every level)
        const ax = d.axis === 2 ? 1 : 0, ay = d.axis === 1 ? 1 : 0, lo = d.axis === 1 ? 1 : 8, hi = d.axis === 1 ? 4 : 2; // (low end N / W, high end S / E)
        if (!d.wet) { if (d.prev === 2) wall(railU, o, -ax, -ay, lo); if (d.next === 2) wall(railU, o, ax, ay, hi); } // (its stone face toward the water)
        else if (d.bent) wall(railU, o, -ax, -ay, lo); // (a support bent at its low edge)
      }
    }
    w.rail = rail; w.railU = railU;
    // small things standing on a deck: lifted to its top (art/faces/solid.js)
    for (const o of g.build.structures) {
      if (o.lv || BUILDINGS[o.type]?.layer !== 'main') continue;
      const h = this.heightAt(o.x, o.cy ?? o.y, true);
      if (h || o._dkh) o._dkh = h;
    }
    if (rail && rail !== oldRail) this._nudge(oldRail, oldU);
  }

  // a railing (or a wall at the water) that appeared over someone: each peer moves its own player, the authority its
  // creatures
  _nudge(old, oldU) {
    const g = this.game, w = g.world;
    for (const e of g.entities) {
      if (e.dead || e.remote || e.proxy || (e.isMob && !g.net.auth) || e.lv > 0) continue;
      const ud = deckTrack(w, e);
      if (!railHit(w, e.x, e.y, e.r || 0.25, ud)) continue;
      if (old && railHit(Object.assign(Object.create(w), { rail: old, railU: oldU }), e.x, e.y, e.r || 0.25, ud)) continue; // (already there before)
      for (let n = 1; n < 40; n++) {
        const a = n * 2.4, d = 0.12 + n * 0.04, x = e.x + Math.cos(a) * d, y = e.y + Math.sin(a) * d;
        if (!collides(w, x, y, e.r || 0.25, null, !!e.passDoors, !!e.canSwim)) { e.x = x; e.y = y; break; }
      }
    }
  }

  // height of the deck top at a world point: built pieces only (walking) unless `planned`; 0 off a deck
  heightAt(x, y, planned = false) {
    if (!this.any) return 0;
    const w = this.game.world, tx = Math.floor(x), ty = Math.floor(y);
    if (!w.inBounds(tx, ty)) return 0;
    const i = w.idx(tx, ty), o = this.at.get(i);
    if (o && (planned || (w.deck && w.deck.get(i)))) return deckHeightIn(o._dk, x - tx, y - ty);
    const rb = this.ramp.get(i);
    if (!rb) return 0;
    const fx = x - tx, fy = y - ty;
    let h = 0;
    if (rb & 1) h = Math.max(h, rampH(fy));
    if (rb & 4) h = Math.max(h, rampH(1 - fy));
    if (rb & 8) h = Math.max(h, rampH(fx));
    if (rb & 2) h = Math.max(h, rampH(1 - fx));
    return h;
  }
  // a finished deck tile at a world point (things dropped there are drawn on its top)
  onDeck(x, y) {
    if (!this.any) return false;
    const w = this.game.world, tx = Math.floor(x), ty = Math.floor(y);
    return w.inBounds(tx, ty) && !!w.deck?.get(w.idx(tx, ty));
  }

  // something built on this deck tile (it cannot be removed while so)
  busy(o) {
    const w = this.game.world, s = this.game.build.grid.main.get(w.idx(o.tx, o.ty));
    return !!s && s !== o;
  }

  // the work on a planned piece can start (null) or why not
  startReason(o) {
    const g = this.game, w = g.world, def = BUILDINGS[o.type];
    if (!def?.deck) {
      // a small thing on a deck tile: the deck under it first
      const i = w.idx(o.tx, o.ty), d = this.at.get(i);
      if (d && d.blueprint) return d.type === 'pier_wood' ? 'Termine o trapiche embaixo primeiro' : 'Termine a ponte embaixo primeiro';
      if (!d && w.water.get(i)) return 'Precisa de um trapiche ou ponte embaixo';
      return null;
    }
    const done = (x, y, k) => { if (!w.inBounds(x, y)) return false; const n = this.at.get(w.idx(x, y)); return !!n && !n.blueprint && kindOfType(n.type) === k; };
    if (def.deck === 'pier') {
      for (const [dx, dy] of DIR) if (landAt(w, o.tx + dx, o.ty + dy) || done(o.tx + dx, o.ty + dy, 'pier')) return null;
      return 'Construa antes a peça ao lado (a partir da margem)';
    }
    if (!w.water.get(w.idx(o.tx, o.ty))) return null; // an abutment on the bank: any time
    const ax = o._dk?.axis || 1, dx = ax === 2 ? 1 : 0, dy = ax === 1 ? 1 : 0;
    if (done(o.tx - dx, o.ty - dy, 'bridge') || done(o.tx + dx, o.ty + dy, 'bridge')) return null;
    return 'Construa antes a peça anterior da ponte (a partir da margem)';
  }

  // finished bridge pieces over the water no longer joined (through finished pieces of their line) to a finished
  // abutment on a bank; `gone`: pieces counted as removed already (a deconstruction being confirmed)
  unsupported(gone = null) {
    const w = this.game.world, ok = new Set(), q = [];
    const alive = (o) => o && !o.blueprint && !(gone && gone.has(o)) && kindOfType(o.type) === 'bridge';
    for (const o of this.list) if (alive(o) && !w.water.get(w.idx(o.tx, o.ty))) { ok.add(o); q.push(o); }
    while (q.length) {
      const o = q.pop(), ax = o._dk?.axis || 1, dx = ax === 2 ? 1 : 0, dy = ax === 1 ? 1 : 0;
      for (const s of [-1, 1]) {
        const x = o.tx + dx * s, y = o.ty + dy * s;
        if (!w.inBounds(x, y)) continue;
        const n = this.at.get(w.idx(x, y));
        if (!alive(n) || ok.has(n) || (n._dk?.axis || 1) !== ax) continue;
        ok.add(n); q.push(n);
      }
    }
    const out = [];
    for (const o of this.list) if (alive(o) && !ok.has(o)) out.push(o);
    return out;
  }
  // what a deconstruction of `gone` would drop into the water (building.js asks before marking)
  lostWithout(gone) { return this.any ? this.unsupported(gone).filter((o) => !gone.has(o)) : []; }
}

const rampH = (d) => (d >= RAMP ? 0 : LOW_H + (PIER_H - LOW_H) * (1 - d / RAMP));
// height of a deck piece's top at (fx, fy) inside its tile
export function deckHeightIn(d, fx, fy) {
  if (!d) return 0;
  if (d.k === 'pier') return PIER_H;
  const u = d.axis === 1 ? fy : fx;
  return u < 0.5 ? lerp(d.h0, d.hm, u * 2) : lerp(d.hm, d.h1, (u - 0.5) * 2);
}

// ---------- shapes ----------
// pier piece: neighbours, banks, the axis its boards cross, the far end (ladder, bollards), its piles
function describePier(w, o, has, d) {
  const x = o.tx, y = o.ty;
  let nb = 0, land = 0;
  for (const [dx, dy, b] of DIR) {
    if (has(x + dx, y + dy, 'pier')) nb |= b;
    else if (landAt(w, x + dx, y + dy)) land |= b;
  }
  // axis (the boards cross it): along the line of pier pieces it continues; else away from the bank
  const axisOf = (m) => ((m & 5) && !(m & 10) ? 1 : (m & 10) && !(m & 5) ? 2 : 0);
  const axis = axisOf(nb) || axisOf(land) || ((nb & 5) === 5 ? 1 : (nb & 10) === 10 ? 2 : land & 5 ? 1 : land ? 2 : 1);
  // far end: one connection (a pier piece or the bank), open water on the opposite side
  let end = 0;
  const one = nb | land;
  if (sideBits(one) === 1) {
    const e = OPP[one];
    const [ex, ey] = e === 1 ? [0, -1] : e === 2 ? [1, 0] : e === 4 ? [0, 1] : [-1, 0];
    if (wetAt(w, x + ex, y + ey) && !has(x + ex, y + ey, 'pier')) end = e;
  }
  // piles on the tile corners, each drawn once (by the first pier piece around it): on the outline a stub over the deck,
  // inside a platform every other corner under the deck, tall bollards at the far end, short ones on the bank side
  let piles = 0;
  for (let c = 0; c < 4; c++) {
    const cx = x + (c & 1), cy = y + (c >> 1);
    const t00 = has(cx - 1, cy - 1, 'pier'), t10 = has(cx, cy - 1, 'pier'), t01 = has(cx - 1, cy, 'pier'), t11 = has(cx, cy, 'pier');
    const owner = t00 || t10 || t01 || t11;
    if (owner !== o) continue;
    const n = (t00 ? 1 : 0) + (t10 ? 1 : 0) + (t01 ? 1 : 0) + (t11 ? 1 : 0);
    // the corner's sides on this tile: c 0 NW (N, W), 1 NE (N, E), 2 SW (S, W), 3 SE (S, E)
    const sides = (c < 2 ? 1 : 4) | (c & 1 ? 2 : 8);
    let kind;
    if (n === 4) kind = (cx + cy) % 2 === 0 ? 1 : 0;
    else if (end & sides) kind = 4;
    else if (land & sides) kind = 2;
    else kind = 3;
    piles |= kind << (c * 3);
  }
  // braces / fascia on the open sides (no pier piece, no bank)
  const open = 15 & ~nb & ~land;
  d.k = 'pier'; d.x = x; d.y = y; d.nb = nb; d.land = land; d.axis = axis; d.end = end; d.piles = piles; d.open = open;
  d.v = ((x * 7 + y * 13) % 3 + 3) % 3;
  d.sig = `p${nb}.${land}.${axis}.${end}.${piles}`;
}

// bridges: each line along its axis, split into runs over the water; heights (the deck of a finished crossing arches a
// little), posts, support bents, railings
function describeBridges(w, list, has) {
  const B = list.filter((o) => kindOfType(o.type) === 'bridge');
  if (!B.length) return;
  const wet = (o) => w.water.get(w.idx(o.tx, o.ty)) > 0;
  // axis: from the neighbours; a lone abutment looks toward the most water around it
  for (const o of B) {
    const x = o.tx, y = o.ty, d = o._dk || (o._dk = {});
    const ns = has(x, y - 1, 'bridge') || has(x, y + 1, 'bridge'), ew = has(x - 1, y, 'bridge') || has(x + 1, y, 'bridge');
    if (ns) d.axis = 1;
    else if (ew) d.axis = 2;
    else {
      let best = 0, ax = 1;
      for (const [dx, dy] of DIR) { let n = 0; for (let k = 1; k <= 3; k++) if (wetAt(w, x + dx * k, y + dy * k)) n++; else break; if (n > best) { best = n; ax = dx ? 2 : 1; } }
      d.axis = ax;
    }
    d.k = 'bridge'; d.x = x; d.y = y; d.wet = wet(o);
  }
  // lines: start at a piece with no neighbour on its low side (north / west)
  for (const o of B) {
    const d = o._dk, dx = d.axis === 2 ? 1 : 0, dy = d.axis === 1 ? 1 : 0;
    const prev = has(o.tx - dx, o.ty - dy, 'bridge');
    if (prev && prev._dk.axis === d.axis) continue;
    const line = [o];
    for (let k = 1; k < 64; k++) { const n = has(o.tx + dx * k, o.ty + dy * k, 'bridge'); if (!n || n._dk.axis !== d.axis) break; line.push(n); }
    shapeLine(w, line, d.axis);
  }
  for (const o of B) {
    const d = o._dk;
    d.sig = `b${d.axis}.${d.wet ? 1 : 0}.${d.h0.toFixed(3)}.${d.hm.toFixed(3)}.${d.h1.toFixed(3)}.${d.prev}.${d.next}.${d.bent}.${d.postHi ? 1 : 0}.${d.ramp}`;
  }
}

function shapeLine(w, line, axis) {
  const m = line.length, wet = line.map((o) => o._dk.wet);
  // runs over the water
  for (let a = 0; a < m; a++) {
    if (!wet[a]) continue;
    let b = a;
    while (b + 1 < m && wet[b + 1]) b++;
    const L = b - a + 1, sL = a > 0 && !wet[a - 1], eL = b < m - 1 && !wet[b + 1], arch = sL && eL;
    const A = arch ? Math.min(0.15, 0.03 * L) : 0;
    const h = (u) => BRIDGE_H + A * Math.sin((Math.PI * u) / L);
    for (let s = 0; s < L; s++) {
      const d = line[a + s]._dk;
      d.h0 = h(s); d.hm = h(s + 0.5); d.h1 = h(s + 1);
      // support bents at inner edges: symmetric on a full crossing, every other tile from the bank on an open one
      d.bent = s > 0 && (arch ? Math.min(s, L - s) % 2 === 0 : s % 2 === 0) ? 1 : 0;
      d.span = L; d.s = s;
    }
    a = b;
  }
  for (let k = 0; k < m; k++) {
    const d = line[k]._dk, pw = k > 0 && wet[k - 1], nw = k < m - 1 && wet[k + 1];
    d.prev = k > 0 ? (wet[k - 1] ? 2 : 1) : 0; // 0 nothing, 1 bank piece, 2 water piece on the low side
    d.next = k < m - 1 ? (wet[k + 1] ? 2 : 1) : 0;
    if (!d.wet) {
      d.bent = 0; d.span = 0; d.s = 0;
      if (pw && nw) { d.h0 = d.hm = d.h1 = BRIDGE_H; d.ramp = 0; } // an island between two runs: a flat stone pier
      else {
        // the ramp climbs toward the water (a lone abutment: toward the most water ahead)
        let up = nw ? 1 : pw ? -1 : 0;
        if (!up) {
          const dx = axis === 2 ? 1 : 0, dy = axis === 1 ? 1 : 0, o = line[k];
          let a = 0, b = 0;
          for (let j = 1; j <= 3; j++) { if (wetAt(w, o.tx + dx * j, o.ty + dy * j)) a++; if (wetAt(w, o.tx - dx * j, o.ty - dy * j)) b++; }
          up = a >= b ? 1 : -1;
        }
        d.ramp = up;
        d.h0 = up > 0 ? LOW_H : BRIDGE_H; d.h1 = up > 0 ? BRIDGE_H : LOW_H; d.hm = (d.h0 + d.h1) / 2;
      }
      d.postHi = false;
    } else {
      d.ramp = 0;
      d.postHi = d.next !== 2; // the last water piece closes its railing (the abutment's parapet meets it there)
    }
    // railings on both long sides (water pieces and abutments); entered only along the line
    d.rails = axis === 1 ? 2 | 8 : 1 | 4;
  }
}

// shapes of the pieces of a placement preview (building.js m.tiles, the valid ones) among the deck pieces already there:
// worked out on scratch copies (the real pieces keep their own _dk) → tile → shape (art/faces/deck.js caches it per key)
export function ghostShapes(game, type, tiles) {
  const w = game.world, out = new Map(), at = new Map(), list = [], ghosts = [];
  for (const o of game.decks?.list || []) { const f = { type: o.type, tx: o.tx, ty: o.ty, blueprint: o.blueprint, _dk: {} }; at.set(w.idx(o.tx, o.ty), f); list.push(f); }
  for (const t of tiles) {
    if (!t.ok) continue;
    const i = w.idx(t.tx, t.ty);
    if (at.has(i)) continue;
    const f = { type, tx: t.tx, ty: t.ty, blueprint: true, _dk: {} };
    at.set(i, f); list.push(f); ghosts.push([i, f]);
  }
  const has = (x, y, k) => { if (!w.inBounds(x, y)) return null; const o = at.get(w.idx(x, y)); return o && kindOfType(o.type) === k ? o : null; };
  for (const o of list) if (kindOfType(o.type) === 'pier') describePier(w, o, has, o._dk);
  describeBridges(w, list, has);
  for (const [i, f] of ghosts) out.set(i, f._dk);
  return out;
}

// ---------- system ----------
// every peer: the deck map follows the structures; entities on a deck stand on its top (cosmetic lift, eased)
export function decksSystem() {
  return {
    sync: 'all', // derived from the shared structures (world.deck / world.rail are gameplay); the lifts are cosmetic
    update(game, dt) {
      const D = game.decks;
      if (!D) return;
      if (game.debug && !game.debug.deckScene) installDeckDebug(game); // (localhost dev helpers)
      D.sync();
      if (!D.any && !D.had) return;
      D.had = D.any;
      const k = Math.min(1, dt * 14), w = game.world;
      for (const e of game.entities) {
        if (e._boat) continue; // (riding a boat: boats.js lifts it)
        // (under a bridge deck — e._ud, kept here for everyone this peer sees: at the water, not on the boards; on a seat:
        // the seat of the lifted model already counts the deck)
        const ud = D.any && deckTrack(w, e);
        const t = !D.any || ud || e.dead || e.lv > 0 || e.z > 0 || (e.pose && e._sobj) ? 0 : D.heightAt(e.x, e.y);
        const c = e._dh || 0;
        if (t === c) continue;
        e._dh = Math.abs(t - c) < 0.003 ? t : c + (t - c) * k;
      }
    },
    // things dropped on a deck: drawn on its top, in the depth-sorted list (loot.js skips them)
    collect(game, list, v) {
      const D = game.decks;
      if (!D || !D.any) return;
      let n = 0;
      for (const it of game.loot) {
        if (it.x < v.x0 - 1 || it.x > v.x1 + 1 || it.y < v.y0 - 1 || it.y > v.y1 + 1 || !D.onDeck(it.x, it.y)) continue;
        const d = LOOT[n] || (LOOT[n] = { it: null, x: 0, y: 0, h: 0, draw: drawLoot });
        n++;
        d.it = it; d.x = it.x; d.y = it.y; d.h = D.heightAt(it.x, it.y);
        list.push(d);
      }
    },
  };
}
const LOOT = [];
let lootSprite = null; // (loot.js itemSprite, set by installDecks: no import cycle through loot.js)
function drawLoot(B, A, t) {
  const it = this.it;
  if (!lootSprite) return;
  const [name, sc] = lootSprite(A, it.item);
  if (!A.has(name)) return;
  const bob = it.lift + (it.lift === 0 ? 0.04 + Math.sin(t * 3 + it.ph) * 0.03 : 0);
  B.main.add(A.get(name), it.x, it.y, 0.9 * sc, 0.9 * sc, 1, 1, 1, 1, 0, 0, 0, 1, 0, bob + this.h);
}

export function installDecks(game, itemSprite) {
  game.decks = new Decks(game);
  lootSprite = itemSprite || null;
  return game.decks;
}

// ---------- dev helpers (localhost: game.debug exists) ----------
// game.debug.deckScene({ plan, span, dry, only: 'bridge' | 'pier' }) — the nearest river crossing (a straight line bank → 2..8 water tiles → bank,
// deepest first) gets a bridge and the nearest shallow bank a pier (4 out, a T at the end), finished (plan: blueprints);
// returns { bridge: [x0, y0, x1, y1], pier: [x, y, dx, dy] }. game.debug.deckAt('bridge' | 'pier' | 'bank', k) puts the
// player there.
export function installDeckDebug(game) {
  const G = game.debug;
  if (!G || G.deckScene) return;
  const S = (G._decks = {});
  const free = (x, y) => { const w = game.world; return w.inBounds(x, y) && !steep(w, x, y) && !w.rock.get(w.idx(x, y)) && !w.solid.get(w.idx(x, y)) && !game.build.grid.main.has(w.idx(x, y)) && !game.build.grid.deck.has(w.idx(x, y)) && !objectsOnTile(game, x, y).some((o) => !CLEARABLE.has(o.type)); };
  G.deckScene = (opts = {}) => {
    const w = game.world, p = game.player, px = Math.floor(p.x), py = Math.floor(p.y), net = game.net;
    if (!net.auth) return 'só o anfitrião';
    let best = null, pier = null;
    for (let r = 0; r < 90 && (!best || !pier); r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = px + dx, y = py + dy;
        if (!free(x, y) || w.water.get(w.idx(x, y))) continue;
        for (const [ex, ey] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
          let n = 0, deep = 0, ok = true;
          while (n < 10 && wetAt(w, x + ex * (n + 1), y + ey * (n + 1))) { n++; const tx = x + ex * n, ty = y + ey * n; if (!free(tx, ty)) ok = false; if (w.water.get(w.idx(tx, ty)) === 2) deep++; }
          const fx = x + ex * (n + 1), fy = y + ey * (n + 1);
          if (!best && ok && n >= (opts.span || 3) && n <= MAX_SPAN && deep >= 1 && free(fx, fy) && !w.water.get(w.idx(fx, fy))) best = [x, y, ex, ey, n];
          if (!pier) {
            let m = 0;
            while (m < 5 && w.inBounds(x + ex * (m + 1), y + ey * (m + 1)) && w.water.get(w.idx(x + ex * (m + 1), y + ey * (m + 1))) === 1 && free(x + ex * (m + 1), y + ey * (m + 1))) m++;
            const sx = -ey, sy = ex, tx = x + ex * 4, ty = y + ey * 4;
            const side = (k) => w.inBounds(tx + sx * k, ty + sy * k) && w.water.get(w.idx(tx + sx * k, ty + sy * k)) === 1 && free(tx + sx * k, ty + sy * k);
            if (m >= 4 && side(1) && side(-1) && !(best && Math.abs(x - best[0]) + Math.abs(y - best[1]) < 6)) pier = [x, y, ex, ey];
          }
        }
      }
    }
    const put = (type, tiles) => {
      if (opts.dry) return; // (only find the sites: a placement preview test)
      const list = tiles.map(([x, y]) => [net.newId('s'), type, x, y, 0, opts.plan ? 0 : 1, Math.round(game.worldTime), 0, opts.plan ? 0 : 1, 0, '', '']);
      net.emit('struct.add', { list, by: net.pid });
    };
    if (best && opts.only !== 'pier') {
      const [x, y, ex, ey, n] = best, t = [];
      for (let k = 0; k <= n + 1; k++) t.push([x + ex * k, y + ey * k]);
      put('bridge_wood', t);
      S.bridge = t;
    }
    if (pier && opts.only !== 'bridge') {
      const [x, y, ex, ey] = pier, t = [];
      for (let k = 1; k <= 4; k++) t.push([x + ex * k, y + ey * k]);
      t.push([x + ex * 4 - ey, y + ey * 4 + ex], [x + ex * 4 + ey, y + ey * 4 - ex]);
      put('pier_wood', t);
      S.pier = t;
    }
    return { bridge: best ? [best[0], best[1], best[0] + best[2] * (best[4] + 1), best[1] + best[3] * (best[4] + 1)] : null, pier };
  };
  G.deckAt = (which = 'bridge', k = 1) => {
    const t = S[which === 'bank' ? 'bridge' : which];
    if (!t) return null;
    const c = which === 'bank' ? [t[0][0] - (t[1][0] - t[0][0]), t[0][1] - (t[1][1] - t[0][1])] : t[Math.min(t.length - 1, k)];
    const p = game.player;
    p.x = c[0] + 0.5; p.y = c[1] + 0.55; game.cam.x = p.x; game.cam.y = p.y - 0.4;
    return c;
  };
}
