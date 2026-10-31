// Creature facing seen by a turned camera (8 views). The network only carries the 4-letter facing (s / n / e / w);
// each peer derives a facing ANGLE from what it sees — the creature's own motion (the interpolated positions of a
// remote copy move like the original), else what it fights / looks at while standing or attacking — kept only while
// it agrees with the replicated letter (±60°), else the letter itself. The drawn view = that angle minus the camera
// yaw, in steps of 45° with hysteresis (it changes 25° past a boundary, not 22.5°), so neither a turning camera nor a
// turning creature makes it flicker. Cosmetic, per client; `_f*` fields are drawing caches.
//   viewFacing8(o, t, rot) → the nearest cardinal view letter (fallback while 3/4 parts paint) and o._dv = the
//   3/4 view 'se' | 'sw' | 'ne' | 'nw' (null on a cardinal view). game.js restores o.facing after drawing.

const HP = Math.PI / 2, Q = Math.PI / 4, TAU = Math.PI * 2;
const LETTER = { e: 0, s: HP, w: Math.PI, n: -HP };
// view index i ↔ the view angle i·45° (screen x right, y down: 'e' 0°, 's' 90°)
const VIEWS = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'];
const CARD = ['e', 's', 'w', 'n'];
const HYST = (25 / 180) * Math.PI;
const wrap = (a) => { a %= TAU; return a > Math.PI ? a - TAU : a < -Math.PI ? a + TAU : a; };
const angDist = (a, b) => Math.abs(wrap(a - b));
const AGREE = 1.05; // ±60°: the derived angle must agree with the replicated letter

// the world angle the creature faces (radians, atan2 convention: x east, y south)
export function faceAngle(o, t) {
  const L = LETTER[o.facing];
  if (L === undefined) return null;
  const dt = o._fqt == null ? 0 : t - o._fqt;
  o._fqt = t;
  const dx = o.x - (o._fqx ?? o.x), dy = o.y - (o._fqy ?? o.y);
  o._fqx = o.x; o._fqy = o.y;
  if (dt > 0 && dt < 0.3 && dx * dx + dy * dy < 4) {
    const k = 1 - Math.exp(-dt * 10);
    o._fvx = (o._fvx || 0) + (dx / dt - (o._fvx || 0)) * k;
    o._fvy = (o._fvy || 0) + (dy / dt - (o._fvy || 0)) * k;
  } else if (dt !== 0) { o._fvx = 0; o._fvy = 0; } // (a teleport / a long pause)
  let a = null;
  const vx = o._fvx || 0, vy = o._fvy || 0;
  const acting = o.action && o.action.t < 1;
  if (o.moving && !acting && vx * vx + vy * vy > 0.12) a = Math.atan2(vy, vx);
  else {
    const tg = o.target && !o.target.dead ? o.target : o.threat;
    if (tg && Number.isFinite(tg.x) && Number.isFinite(tg.y) && tg !== o) {
      const tx = tg.x - o.x, ty = tg.y - o.y;
      if (tx * tx + ty * ty > 0.01 && tx * tx + ty * ty < 400) a = Math.atan2(ty, tx);
    }
  }
  if (a == null || angDist(a, L) > AGREE) a = o._fa != null && angDist(o._fa, L) <= AGREE ? o._fa : L;
  // a short ease so the angle never jumps (the view steps are 45° anyway)
  if (o._fa != null && dt > 0) a = o._fa + wrap(a - o._fa) * Math.min(1, dt * 14);
  o._fa = a;
  return a;
}

export function viewFacing8(o, t, rot) {
  const wa = faceAngle(o, t);
  if (wa == null) { o._dv = null; return o.facing; }
  const va = wrap(wa - rot);
  // a view is kept until the angle is 25° from its centre (2.5° into the next one)
  let i = o._vi;
  if (i == null || angDist(va, i * Q) > HYST) i = o._vi = ((Math.round(va / Q) % 8) + 8) % 8;
  const v = VIEWS[i];
  if (i % 2 === 0) { o._dv = null; return v; }
  o._dv = v;
  // nearest side (drawn until the 3/4 parts are painted): the cardinal on the angle's side of the diagonal
  const c = wrap(va - i * Q) >= 0 ? (i + 1) % 8 : i - 1;
  return CARD[c / 2];
}
