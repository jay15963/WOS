// Ice giants (giants.js): what every peer must see of a giant's attacks — the ground telegraph of its smash (where it
// lands and when) and its thrown ice rock (the same lobbed flight everywhere). Both are cosmetic on guests; the host
// resolves the hits (giants.js). Ops so they reach every peer in order with the creature stream.

import { defineOp } from '../../net/registry.js';
import { fireLob } from '../projectiles.js';

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// the giants' throws (giants.js GIANT_KINDS proj): ice rock (default), a bone (skeleton giant), a sarcophagus lid (mummy)
const PROJ = new Set(['ice_rock', 'giant_bone', 'giant_slab']);

defineOp('giant.tele', {
  doc: 'A giant winds up a smash: a danger circle on the ground at (x, y), radius r, landing after dur seconds (cosmetic: fx/giantfx.js draws it; k: the debris — ice, bone, sand).',
  args: { x: 'number', y: 'number', r: 'tiles', dur: 's', k: "'smash'|'smash_bone'|'smash_sand'" },
  apply(game, a) {
    const T = game.teles || (game.teles = []);
    T.push({ x: num(a.x), y: num(a.y), r: Math.max(0.3, Math.min(4, num(a.r, 1))), dur: Math.max(0.1, Math.min(4, num(a.dur, 1))), t: 0, k: a.k || 'smash' });
    if (T.length > 24) T.splice(0, T.length - 24);
  },
});

defineOp('giant.rock', {
  doc: 'A giant throws an ice rock (p: or a bone / a sarcophagus lid): a lobbed flight from (x, y) to (lx, ly) in dur s with apex height (tiles); the host copy resolves the hit on landing.',
  args: { id: 'projId', x: 'number', y: 'number', lx: 'number', ly: 'number', dur: 's', apex: 'tiles', p: "'giant_bone'|'giant_slab'? (default ice_rock)" },
  apply(game, a) {
    fireLob(game, { id: String(a.id || ''), proj: PROJ.has(a.p) ? a.p : 'ice_rock', faction: 'walker', cosmetic: !game.net.auth, x: num(a.x), y: num(a.y), lx: num(a.lx), ly: num(a.ly),
      dur: Math.max(0.2, Math.min(4, num(a.dur, 1))), apex: Math.max(0, Math.min(10, num(a.apex, 2))) });
  },
});
