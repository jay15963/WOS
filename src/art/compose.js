// Visual composition & animation: turns game state into sprite instances.
// B = renderer.batches, A = atlas, t = time (s).
// batch.add(s, x, y, sx, sy, r, g, b, a, sway, rot, flash, flip, recv, lift)

const TAU = Math.PI * 2;

// ---------- pawns (humanoids) ----------
// p: { x, y, facing:'s'|'n'|'e'|'w', moving, moveT, action:{type,t}|null, flash, dead, deadT,
//      look:{ skin:[r,g,b], hair:'short', hairColor:[r,g,b], shirt:[r,g,b] }, weapon:'sword'|'axe'|'pickaxe'|null }
export function drawPawn(B, A, p, t) {
  const dir = p.facing || 's';
  const sd = dir === 'w' ? 'e' : dir;
  const flip = dir === 'w' ? -1 : 1;
  const L = p.look;
  const fl = p.flash || 0;
  const body = A.get('pawn_body_' + sd);
  const head = A.get('pawn_head_' + sd);
  const hair = A.has(`hair_${L.hair}_${sd}`) ? A.get(`hair_${L.hair}_${sd}`) : null;

  B.blob.add(A.get('fx_blob'), p.x, p.y, 0.75, 0.75, 1, 1, 1, p.dead ? 0.5 : 0.8);

  if (p.dead) {
    const k = Math.min(1, (p.deadT || 0) * 3);
    const rot = -flip * (Math.PI / 2) * k;
    B.main.add(body, p.x - 0.1 * flip, p.y, 1, 1, L.shirt[0], L.shirt[1], L.shirt[2], 1, 0, rot, fl, flip);
    B.main.add(head, p.x - 0.55 * flip * k, p.y - 0.5 * (1 - k) - 0.12 * k, 1, 1, L.skin[0], L.skin[1], L.skin[2], 1, 0, rot, fl, flip, 0, 0);
    return;
  }

  // walk bob + idle breathing
  const bob = p.moving ? Math.abs(Math.sin(p.moveT * 8.5)) * 0.06 : (Math.sin(t * 2.2 + p.x) * 0.5 + 0.5) * 0.012;
  const sway = p.moving ? Math.sin(p.moveT * 8.5) * 0.05 : 0;
  // action lunge toward facing
  let lx = 0, ly = 0;
  const act = p.action;
  if (act && (act.type === 'attack' || act.type === 'chop' || act.type === 'mine')) {
    const k = Math.sin(Math.min(1, act.t) * Math.PI) * 0.12;
    if (dir === 'e') lx = k; else if (dir === 'w') lx = -k; else if (dir === 's') ly = k * 0.6; else ly = -k * 0.6;
  }
  const x = p.x + lx, y = p.y + ly;
  const bodyLift = bob;
  const headLift = bob + body.h * 0.62;

  const drawWeapon = () => {
    if (!p.weapon) return;
    const ws = A.get(p.weapon === 'pickaxe' ? 'tool_pickaxe' : 'weapon_' + p.weapon);
    let rot = 0, wx = x, wl = bodyLift + 0.28;
    if (sd === 's') { wx = x + 0.28; rot = 0.5; }
    else if (sd === 'n') { wx = x - 0.28; rot = -0.5; }
    else { wx = x + 0.18 * flip; rot = 0.9 * flip; }
    if (act && act.t < 1) {
      const k = act.t;
      const swing = k < 0.35 ? -1.4 * (k / 0.35) : -1.4 + 3.0 * Math.min(1, (k - 0.35) / 0.3);
      rot += swing * (sd === 'n' ? -1 : 1) * (sd === 'e' ? flip : 1);
    }
    B.main.add(ws, wx, y, 1, 1, 1, 1, 1, 1, 0, rot, fl, sd === 'e' ? flip : 1, 0, wl);
  };

  if (sd === 'n') drawWeapon();
  B.main.add(body, x, y, 1, 1, L.shirt[0], L.shirt[1], L.shirt[2], 1, 0, sway * 0.4, fl, flip, 0, bodyLift);
  B.main.add(head, x, y, 1, 1, L.skin[0], L.skin[1], L.skin[2], 1, 0, 0, fl, flip, 0, headLift);
  if (hair) B.main.add(hair, x, y, 1, 1, L.hairColor[0], L.hairColor[1], L.hairColor[2], 1, 0, 0, fl, flip, 0, headLift);
  if (sd !== 'n') drawWeapon();

  B.shadow.add(body, x, y, 1, 1, 1, 1, 1, 0.9, 0, 0, 0, flip, 0, bodyLift);
  B.shadow.add(head, x, y, 1, 1, 1, 1, 1, 0.9, 0, 0, 0, flip, 0, headLift);
}

// ---------- animals ----------
// a: { x, y, species, facing, moving, moveT, action, flash, dead, deadT, scale }
export function drawAnimal(B, A, a, t) {
  const dir = a.facing || 'e';
  const sd = dir === 'w' ? 'e' : dir;
  const flip = dir === 'w' ? -1 : 1;
  const s = A.get(`${a.species}_${sd}`);
  const sc = a.scale || 1;
  B.blob.add(A.get('fx_blob'), a.x, a.y, 0.9 * sc * Math.max(1, s.w * 0.8), 0.8 * sc, 1, 1, 1, 0.7);
  if (a.dead) {
    const k = Math.min(1, (a.deadT || 0) * 3);
    B.main.add(s, a.x, a.y, sc, sc, 0.85, 0.85, 0.85, 1, 0, flip * Math.PI * 0.5 * k, a.flash || 0, flip);
    return;
  }
  const bob = a.moving ? Math.abs(Math.sin(a.moveT * 10)) * 0.05 : 0;
  let lx = 0, ly = 0;
  if (a.action && a.action.type === 'attack') {
    const k = Math.sin(Math.min(1, a.action.t) * Math.PI) * 0.22;
    if (dir === 'e') lx = k; else if (dir === 'w') lx = -k; else if (dir === 's') ly = k; else ly = -k;
  }
  B.main.add(s, a.x + lx, a.y + ly, sc, sc, 1, 1, 1, 1, 0, 0, a.flash || 0, flip, 0, bob);
  B.shadow.add(s, a.x + lx, a.y + ly, sc, sc, 1, 1, 1, 0.9, 0, 0, 0, flip, 0, bob);
}

// ---------- static world objects ----------
// o: { type, v, x, y, s, f, shake, fall, empty, ... }
export function drawStatic(B, A, o, t) {
  const type = o.type;
  if (type.startsWith('tree_')) {
    if (o.stump) {
      B.main.add(A.pick('tree_stump', o.v), o.x, o.y, o.s, o.s, 1, 1, 1, 1, 0, 0, 0, o.f);
      return;
    }
    const s = A.pick(type, o.v);
    let x = o.x, rot = 0, alpha = 1;
    if (o.shake > 0) x += Math.sin(t * 60) * 0.04 * o.shake;
    if (o.fall) { rot = o.f * (Math.PI / 2) * Math.pow(Math.min(1, o.fall), 2); alpha = 1 - Math.max(0, o.fall - 1) * 2; }
    const sc = o.s * (o.age ?? 1);
    B.blob.add(A.get('fx_blob'), o.x, o.y, 1.1 * sc, 1.0 * sc, 1, 1, 1, 0.55 * alpha);
    B.main.add(s, x, o.y, sc, sc, 1, 1, 1, alpha, o.fall ? 0 : 0.035, rot, o.flash || 0, o.f);
    B.shadow.add(s, x, o.y, sc, sc, 1, 1, 1, alpha, o.fall ? 0 : 0.035, rot, 0, o.f);
    return;
  }
  if (type === 'bush' || type === 'berrybush') {
    const name = type === 'berrybush' && o.empty ? 'berrybush_empty' : type;
    const s = A.pick(name, o.v);
    const x = o.x + (o.shake > 0 ? Math.sin(t * 50) * 0.03 * o.shake : 0);
    B.blob.add(A.get('fx_blob'), o.x, o.y, 0.9 * o.s, 0.7 * o.s, 1, 1, 1, 0.5);
    B.main.add(s, x, o.y, o.s, o.s, 1, 1, 1, 1, 0.05, 0, o.flash || 0, o.f, 0.5);
    B.shadow.add(s, x, o.y, o.s, o.s, 1, 1, 1, 0.8, 0.05, 0, 0, o.f);
    return;
  }
  if (type === 'boulder') {
    const s = A.pick('boulder', o.v);
    B.main.add(s, o.x, o.y, o.s, o.s, 1, 1, 1, 1, 0, 0, o.flash || 0, o.f);
    B.shadow.add(s, o.x, o.y, o.s, o.s, 1, 1, 1, 1, 0, 0, 0, o.f);
    return;
  }
  if (A.has(type)) {
    const s = A.get(type);
    B.main.add(s, o.x, o.y, o.s || 1, o.s || 1, 1, 1, 1, 1, 0, 0, o.flash || 0, o.f || 1);
    B.shadow.add(s, o.x, o.y, o.s || 1, o.s || 1, 1, 1, 1, 1, 0, 0, 0, o.f || 1);
  }
}

// ---------- ground decor (grass, flowers...) ----------
const GRASS_TINT = [[1, 1, 1], [0.92, 1.0, 0.86], [1.06, 1.02, 0.9], [0.88, 0.95, 0.8]];
export function drawDecor(B, A, d) {
  const s = d._s || (d._s = A.pick(d.t, d.v));
  const tint = GRASS_TINT[d.v & 3];
  const sway = d.t === 'flower' || d.t === 'mushroom' ? 0.06 : d.t === 'tallgrass' || d.t === 'reed' ? 0.16 : 0.12;
  B.decor.add(s, d.x, d.y, d.s, d.s, tint[0], tint[1], tint[2], 1, sway, 0, 0, d.f, 1);
}

export { TAU };
